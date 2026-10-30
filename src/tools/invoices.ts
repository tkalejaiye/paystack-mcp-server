import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { PaystackClient } from '../paystack-client';

// Convenience tools for Paystack payment requests (invoices). They sit alongside
// the generic make_paystack_request tool and use the same client, so any request
// policy applied to the client (e.g. a live-mode allowlist) applies here too.

const CURRENCIES = ['NGN', 'GHS', 'ZAR', 'KES', 'USD'] as const;

/** Convert a major-unit amount (e.g. naira) to the subunit Paystack expects (e.g. kobo). */
export function toSubunit(amount: number): number {
  const subunit = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Math.abs(amount * 100 - subunit) > 1e-6) {
    throw new Error(`Amount ${amount} must be a number with at most 2 decimal places`);
  }
  if (subunit <= 0) {
    throw new Error(`Amount ${amount} must be greater than zero`);
  }
  return subunit;
}

export function fromSubunit(subunit: number | undefined | null): number | undefined {
  return typeof subunit === 'number' ? subunit / 100 : undefined;
}

const codeSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'Must be a payment request code (PRQ_...) or numeric ID')
  .describe('Payment request code (e.g. PRQ_1weqqsn2wwzgft8) or numeric ID');

const dateSchema = z
  .string()
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) && !Number.isNaN(Date.parse(value)),
    'Must be an ISO 8601 date, e.g. 2026-12-31 or 2026-12-31T17:00:00Z',
  );

function textResult(value: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
    ...(isError && { isError: true }),
  };
}

function errorResult(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = (error as any)?.statusCode;
  return textResult(
    `Unable to ${action}${statusCode ? ` (HTTP ${statusCode})` : ''}: ${message}`,
    true,
  );
}

/** Summarise a payment request with amounts in major units alongside the raw kobo values. */
function summarise(invoice: any) {
  if (!invoice || typeof invoice !== 'object') return invoice;
  return {
    id: invoice.id,
    request_code: invoice.request_code,
    status: invoice.status,
    paid: invoice.paid,
    paid_at: invoice.paid_at,
    currency: invoice.currency,
    amount: fromSubunit(invoice.amount),
    amount_subunit: invoice.amount,
    due_date: invoice.due_date,
    description: invoice.description,
    invoice_number: invoice.invoice_number,
    customer: invoice.customer
      ? {
          email: invoice.customer.email,
          customer_code: invoice.customer.customer_code,
          name:
            [invoice.customer.first_name, invoice.customer.last_name].filter(Boolean).join(' ') ||
            undefined,
        }
      : undefined,
    line_items: Array.isArray(invoice.line_items)
      ? invoice.line_items.map((item: any) => ({ ...item, amount: fromSubunit(item.amount) }))
      : undefined,
    pdf_url: invoice.pdf_url,
    created_at: invoice.created_at ?? invoice.createdAt,
  };
}

/**
 * Resolve a customer identifier to something /paymentrequest accepts.
 * Codes and IDs pass through; an email is looked up and created if it doesn't exist.
 */
export async function resolveCustomer(
  client: PaystackClient,
  customer: string,
  details: { first_name?: string; last_name?: string } = {},
): Promise<{ customer: string; created: boolean }> {
  const value = customer.trim();
  if (/^CUS_[A-Za-z0-9]+$/.test(value) || /^\d+$/.test(value)) {
    return { customer: value, created: false };
  }
  if (!/^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(value)) {
    throw new Error(`"${customer}" is not a customer email, customer code (CUS_...) or ID`);
  }

  const existing = await client.makeRequest<any>('GET', `/customer/${encodeURIComponent(value)}`);
  if (existing.status && existing.data?.customer_code) {
    return { customer: existing.data.customer_code, created: false };
  }

  const created = await client.makeRequest<any>('POST', '/customer', { email: value, ...details });
  if (!created.status || !created.data?.customer_code) {
    throw new Error(`Could not create customer ${value}: ${created.message}`);
  }
  return { customer: created.data.customer_code, created: true };
}

export function registerInvoiceTools(server: McpServer, paystackClient: PaystackClient) {
  server.registerTool(
    'create_invoice',
    {
      description: `Create a Paystack invoice (payment request) for a customer. Amounts are in
      major currency units (e.g. naira) and are converted to kobo automatically. Provide either
      "amount" or "line_items" (Paystack totals line items itself). If "customer" is an email
      that doesn't exist yet, the customer is created first. By default Paystack emails the
      invoice to the customer.`,
      annotations: {
        title: 'Create invoice',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        customer: z.string().describe('Customer email, customer code (CUS_...) or customer ID'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe('Total amount in major units, e.g. 15000.50 for ₦15,000.50'),
        line_items: z
          .array(
            z.object({
              name: z.string().min(1),
              amount: z.number().positive().describe('Unit price in major units, e.g. naira'),
              quantity: z.number().int().positive().default(1),
            }),
          )
          .optional()
          .describe('Line items; Paystack computes the total from these'),
        tax: z
          .array(
            z.object({
              name: z.string().min(1),
              amount: z.number().positive().describe('Tax amount in major units'),
            }),
          )
          .optional(),
        due_date: dateSchema.optional().describe('Due date, ISO 8601 (e.g. 2026-12-31)'),
        description: z.string().optional(),
        currency: z.enum(CURRENCIES).default('NGN'),
        send_notification: z
          .boolean()
          .default(true)
          .describe('Email the invoice to the customer (default true)'),
        draft: z
          .boolean()
          .default(false)
          .describe('Create as a draft without sending (finalize later)'),
        first_name: z.string().optional().describe('Used only if a new customer is created'),
        last_name: z.string().optional().describe('Used only if a new customer is created'),
      },
    },
    async (input) => {
      try {
        if (input.amount !== undefined && input.line_items?.length) {
          return textResult(
            'Provide either "amount" or "line_items", not both. With line items, Paystack computes the total.',
            true,
          );
        }
        if (input.amount === undefined && !input.line_items?.length) {
          return textResult('Provide "amount" or at least one entry in "line_items".', true);
        }

        const body: Record<string, unknown> = {
          currency: input.currency,
          send_notification: input.send_notification,
          draft: input.draft,
        };
        if (input.amount !== undefined) body.amount = toSubunit(input.amount);
        if (input.line_items?.length) {
          body.line_items = input.line_items.map((item) => ({
            name: item.name,
            amount: toSubunit(item.amount),
            quantity: item.quantity,
          }));
        }
        if (input.tax?.length) {
          body.tax = input.tax.map((tax) => ({ name: tax.name, amount: toSubunit(tax.amount) }));
        }
        if (input.due_date) body.due_date = input.due_date;
        if (input.description) body.description = input.description;

        const { customer, created } = await resolveCustomer(paystackClient, input.customer, {
          first_name: input.first_name,
          last_name: input.last_name,
        });
        body.customer = customer;

        const response = await paystackClient.makeRequest<any>('POST', '/paymentrequest', body);
        if (!response.status) {
          return textResult(`Paystack rejected the invoice: ${response.message}`, true);
        }

        return textResult({
          message: response.message,
          customer_created: created,
          notification_sent: input.send_notification && !input.draft,
          invoice: summarise(response.data),
        });
      } catch (error) {
        return errorResult('create invoice', error);
      }
    },
  );

  server.registerTool(
    'send_invoice_reminder',
    {
      description:
        'Email the customer a reminder for an existing Paystack invoice (payment request).',
      annotations: {
        title: 'Send invoice reminder',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: { code: codeSchema },
    },
    async ({ code }) => {
      try {
        const response = await paystackClient.makeRequest<any>(
          'POST',
          `/paymentrequest/notify/${encodeURIComponent(code)}`,
        );
        if (!response.status) {
          return textResult(`Paystack could not send the reminder: ${response.message}`, true);
        }
        return textResult({ message: response.message, code });
      } catch (error) {
        return errorResult('send invoice reminder', error);
      }
    },
  );

  server.registerTool(
    'get_invoice_status',
    {
      description:
        'Get the current status of a Paystack invoice (payment request): pending, paid, etc.',
      annotations: { title: 'Get invoice status', readOnlyHint: true, openWorldHint: true },
      inputSchema: { code: codeSchema },
    },
    async ({ code }) => {
      try {
        const response = await paystackClient.makeRequest<any>(
          'GET',
          `/paymentrequest/verify/${encodeURIComponent(code)}`,
        );
        if (!response.status) {
          return textResult(`Paystack could not find the invoice: ${response.message}`, true);
        }
        return textResult(summarise(response.data));
      } catch (error) {
        return errorResult('get invoice status', error);
      }
    },
  );

  server.registerTool(
    'list_invoices',
    {
      description:
        'List Paystack invoices (payment requests), newest first, optionally filtered by status, customer or date.',
      annotations: { title: 'List invoices', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        status: z.enum(['draft', 'pending', 'success', 'failed']).optional(),
        customer: z.string().optional().describe('Customer ID to filter by'),
        currency: z.enum(CURRENCIES).optional(),
        from: dateSchema.optional().describe('Start date (ISO 8601)'),
        to: dateSchema.optional().describe('End date (ISO 8601)'),
        perPage: z.number().int().min(1).max(100).default(20),
        page: z.number().int().min(1).default(1),
      },
    },
    async (filters) => {
      try {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(filters)) {
          if (value !== undefined) query.set(key, String(value));
        }
        const response = await paystackClient.makeRequest<any[]>(
          'GET',
          `/paymentrequest?${query.toString()}`,
        );
        if (!response.status) {
          return textResult(`Paystack could not list invoices: ${response.message}`, true);
        }
        return textResult({
          invoices: Array.isArray(response.data) ? response.data.map(summarise) : [],
          meta: response.meta,
        });
      } catch (error) {
        return errorResult('list invoices', error);
      }
    },
  );
}
