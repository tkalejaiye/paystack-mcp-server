import assert from 'node:assert';
import { registerInvoiceTools, toSubunit, fromSubunit } from '../src/tools/invoices.js';
import { PaystackClient } from '../src/paystack-client.js';

// Built at runtime so secret scanners don't mistake fixtures for real keys
const TEST_KEY = ['sk', 'test', 'x'.repeat(40)].join('_');

interface RecordedRequest {
  method: string;
  url: string;
  body?: any;
}

/** Mock fetch with a route table keyed by "METHOD /path" (path without query). */
function mockPaystack(routes: Record<string, any>) {
  const requests: RecordedRequest[] = [];
  global.fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${new URL(url).pathname}`;
    const response = routes[key] ?? { status: false, message: `No mock for ${key}` };
    return { status: 200, text: async () => JSON.stringify(response) } as Response;
  };
  return requests;
}

function registerTools(client: PaystackClient) {
  const handlers: Record<string, any> = {};
  const configs: Record<string, any> = {};
  const server = {
    registerTool: (name: string, config: any, handler: any) => {
      handlers[name] = handler;
      configs[name] = config;
    },
  } as any;
  registerInvoiceTools(server, client);
  return { handlers, configs };
}

const INVOICE = {
  id: 123,
  request_code: 'PRQ_abc123',
  status: 'pending',
  paid: false,
  currency: 'NGN',
  amount: 1500050,
  due_date: '2026-12-31T00:00:00.000Z',
  description: 'Consulting',
  customer: { email: 'ada@example.com', customer_code: 'CUS_ada', first_name: 'Ada' },
  line_items: [{ name: 'Hours', amount: 500000, quantity: 3 }],
};

// Default values the zod schema would fill in before the handler runs
const CREATE_DEFAULTS = { currency: 'NGN', send_notification: true, draft: false };

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe('Invoice tools', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('amount conversion', () => {
    it('should convert naira to kobo exactly', () => {
      assert.strictEqual(toSubunit(15000), 1500000);
      assert.strictEqual(toSubunit(15000.5), 1500050);
      assert.strictEqual(toSubunit(19.99), 1999);
      assert.strictEqual(toSubunit(0.01), 1);
      assert.strictEqual(fromSubunit(1999), 19.99);
    });

    it('should reject sub-kobo precision and non-positive amounts', () => {
      assert.throws(() => toSubunit(10.005), /at most 2 decimal places/);
      assert.throws(() => toSubunit(0), /greater than zero/);
      assert.throws(() => toSubunit(-5), /greater than zero/);
      assert.throws(() => toSubunit(Number.NaN), /at most 2 decimal places/);
    });
  });

  describe('registration', () => {
    it('should register the four invoice tools with sensible annotations', () => {
      const { configs } = registerTools(new PaystackClient(TEST_KEY));
      assert.deepStrictEqual(Object.keys(configs).sort(), [
        'create_invoice',
        'get_invoice_status',
        'list_invoices',
        'send_invoice_reminder',
      ]);
      assert.strictEqual(configs.get_invoice_status.annotations.readOnlyHint, true);
      assert.strictEqual(configs.list_invoices.annotations.readOnlyHint, true);
      assert.strictEqual(configs.create_invoice.annotations.readOnlyHint, false);
    });

    it('should default currency to NGN and send_notification to true', () => {
      const { configs } = registerTools(new PaystackClient(TEST_KEY));
      const schema = configs.create_invoice.inputSchema;
      assert.strictEqual(schema.currency.parse(undefined), 'NGN');
      assert.strictEqual(schema.send_notification.parse(undefined), true);
      assert.throws(() => schema.due_date.parse('31/12/2026'));
      assert.strictEqual(schema.due_date.parse('2026-12-31'), '2026-12-31');
    });
  });

  describe('create_invoice', () => {
    it('should look up an existing customer by email and create the invoice in kobo', async () => {
      const requests = mockPaystack({
        'GET /customer/ada%40example.com': { status: true, data: { customer_code: 'CUS_ada' } },
        'POST /paymentrequest': { status: true, message: 'Payment request created', data: INVOICE },
      });
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      const result = await handlers.create_invoice({
        ...CREATE_DEFAULTS,
        customer: 'ada@example.com',
        amount: 15000.5,
        due_date: '2026-12-31',
        description: 'Consulting',
      });

      assert.strictEqual(result.isError, undefined);
      assert.strictEqual(requests[0].url, 'https://api.paystack.co/customer/ada%40example.com');
      assert.deepStrictEqual(requests[1].body, {
        currency: 'NGN',
        send_notification: true,
        draft: false,
        amount: 1500050,
        due_date: '2026-12-31',
        description: 'Consulting',
        customer: 'CUS_ada',
      });

      const output = parse(result);
      assert.strictEqual(output.customer_created, false);
      assert.strictEqual(output.notification_sent, true);
      assert.strictEqual(output.invoice.request_code, 'PRQ_abc123');
      assert.strictEqual(output.invoice.amount, 15000.5);
      assert.strictEqual(output.invoice.amount_subunit, 1500050);
    });

    it('should create the customer first when the email is new', async () => {
      const requests = mockPaystack({
        'GET /customer/new%40example.com': { status: false, message: 'Customer not found' },
        'POST /customer': { status: true, data: { customer_code: 'CUS_new' } },
        'POST /paymentrequest': { status: true, message: 'ok', data: INVOICE },
      });
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      const result = await handlers.create_invoice({
        ...CREATE_DEFAULTS,
        customer: 'new@example.com',
        amount: 100,
        first_name: 'New',
      });

      assert.deepStrictEqual(requests[1].body, { email: 'new@example.com', first_name: 'New' });
      assert.strictEqual(requests[2].body.customer, 'CUS_new');
      assert.strictEqual(parse(result).customer_created, true);
    });

    it('should pass customer codes through and convert line items and tax', async () => {
      const requests = mockPaystack({
        'POST /paymentrequest': { status: true, message: 'ok', data: INVOICE },
      });
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      await handlers.create_invoice({
        ...CREATE_DEFAULTS,
        send_notification: false,
        customer: 'CUS_ada',
        line_items: [
          { name: 'Hours', amount: 5000, quantity: 3 },
          { name: 'Travel', amount: 1250.75, quantity: 1 },
        ],
        tax: [{ name: 'VAT', amount: 1218.81 }],
      });

      assert.strictEqual(requests.length, 1);
      assert.deepStrictEqual(requests[0].body, {
        currency: 'NGN',
        send_notification: false,
        draft: false,
        customer: 'CUS_ada',
        line_items: [
          { name: 'Hours', amount: 500000, quantity: 3 },
          { name: 'Travel', amount: 125075, quantity: 1 },
        ],
        tax: [{ name: 'VAT', amount: 121881 }],
      });
    });

    it('should require exactly one of amount or line_items', async () => {
      const requests = mockPaystack({});
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      const both = await handlers.create_invoice({
        ...CREATE_DEFAULTS,
        customer: 'CUS_ada',
        amount: 10,
        line_items: [{ name: 'x', amount: 10, quantity: 1 }],
      });
      const neither = await handlers.create_invoice({ ...CREATE_DEFAULTS, customer: 'CUS_ada' });

      assert.strictEqual(both.isError, true);
      assert.strictEqual(neither.isError, true);
      assert.strictEqual(requests.length, 0);
    });

    it('should reject invalid customers and sub-kobo amounts before calling Paystack', async () => {
      const requests = mockPaystack({});
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      const badCustomer = await handlers.create_invoice({
        ...CREATE_DEFAULTS,
        customer: '../transfer',
        amount: 10,
      });
      const badAmount = await handlers.create_invoice({
        ...CREATE_DEFAULTS,
        customer: 'CUS_ada',
        amount: 10.001,
      });

      assert.strictEqual(badCustomer.isError, true);
      assert.strictEqual(badAmount.isError, true);
      assert.ok(badAmount.content[0].text.includes('2 decimal places'));
      assert.strictEqual(requests.length, 0);
    });

    it('should surface Paystack rejections as errors', async () => {
      mockPaystack({
        'POST /paymentrequest': { status: false, message: 'Due date cannot be in the past' },
      });
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      const result = await handlers.create_invoice({
        ...CREATE_DEFAULTS,
        customer: 'CUS_ada',
        amount: 10,
      });
      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('Due date cannot be in the past'));
    });
  });

  describe('send_invoice_reminder', () => {
    it('should POST to the notify endpoint', async () => {
      const requests = mockPaystack({
        'POST /paymentrequest/notify/PRQ_abc123': { status: true, message: 'Notification sent' },
      });
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      const result = await handlers.send_invoice_reminder({ code: 'PRQ_abc123' });
      assert.strictEqual(requests[0].method, 'POST');
      assert.deepStrictEqual(parse(result), { message: 'Notification sent', code: 'PRQ_abc123' });
    });
  });

  describe('get_invoice_status', () => {
    it('should verify the invoice and summarise it in naira', async () => {
      mockPaystack({
        'GET /paymentrequest/verify/PRQ_abc123': {
          status: true,
          data: { ...INVOICE, status: 'success', paid: true, paid_at: '2026-11-01' },
        },
      });
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      const output = parse(await handlers.get_invoice_status({ code: 'PRQ_abc123' }));
      assert.strictEqual(output.status, 'success');
      assert.strictEqual(output.paid, true);
      assert.strictEqual(output.amount, 15000.5);
      assert.deepStrictEqual(output.line_items, [{ name: 'Hours', amount: 5000, quantity: 3 }]);
      assert.deepStrictEqual(output.customer, {
        email: 'ada@example.com',
        customer_code: 'CUS_ada',
        name: 'Ada',
      });
    });

    it('should report a missing invoice as an error', async () => {
      mockPaystack({
        'GET /paymentrequest/verify/PRQ_missing': {
          status: false,
          message: 'Payment request not found',
        },
      });
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));
      const result = await handlers.get_invoice_status({ code: 'PRQ_missing' });
      assert.strictEqual(result.isError, true);
    });
  });

  describe('list_invoices', () => {
    it('should pass filters as query parameters', async () => {
      const requests = mockPaystack({
        'GET /paymentrequest': { status: true, data: [INVOICE], meta: { total: 1 } },
      });
      const { handlers } = registerTools(new PaystackClient(TEST_KEY));

      const output = parse(
        await handlers.list_invoices({ status: 'pending', perPage: 5, page: 1 }),
      );
      const url = new URL(requests[0].url);
      assert.strictEqual(url.pathname, '/paymentrequest');
      assert.strictEqual(url.searchParams.get('status'), 'pending');
      assert.strictEqual(url.searchParams.get('perPage'), '5');
      assert.strictEqual(output.invoices[0].amount, 15000.5);
      assert.deepStrictEqual(output.meta, { total: 1 });
    });
  });
});

describe('PaystackClient GET query parameters', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should send GET data as query parameters instead of dropping it', async () => {
    const requests = mockPaystack({ 'GET /transaction': { status: true, data: [] } });
    await new PaystackClient(TEST_KEY).makeRequest('GET', '/transaction', {
      perPage: 5,
      status: 'success',
      skipped: undefined,
    });
    assert.strictEqual(
      requests[0].url,
      'https://api.paystack.co/transaction?perPage=5&status=success',
    );
    assert.strictEqual(requests[0].body, undefined);
  });

  it('should append to an existing query string', async () => {
    const requests = mockPaystack({ 'GET /transaction': { status: true, data: [] } });
    await new PaystackClient(TEST_KEY).makeRequest('GET', '/transaction?page=2', { perPage: 5 });
    assert.strictEqual(requests[0].url, 'https://api.paystack.co/transaction?page=2&perPage=5');
  });
});
