import assert from 'node:assert';
import { redactSensitiveData } from '../src/logger.js';
import { PaystackClient } from '../src/paystack-client.js';
import { SERVER_INSTRUCTIONS } from '../src/server.js';
import {
  assertLiveRequestAllowed,
  createModePaystackClient,
  instructionsForMode,
  LiveModePaystackClient,
  resolvePaystackConfig,
} from '../src/worker/paystack-mode.js';

// Built at runtime so secret scanners don't mistake fixtures for real keys
const TEST_KEY = ['sk', 'test', 'x'.repeat(40)].join('_');
const LIVE_KEY = ['sk', 'live', 'x'.repeat(40)].join('_');

function mockFetch() {
  const calls: string[] = [];
  global.fetch = async (input: any, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(input)}`);
    return {
      status: 200,
      text: async () => '{"status":true,"message":"ok","data":{}}',
    } as Response;
  };
  return calls;
}

describe('Key modes', () => {
  describe('resolvePaystackConfig', () => {
    it('should default to test mode', () => {
      assert.deepStrictEqual(resolvePaystackConfig({ PAYSTACK_SECRET_KEY: TEST_KEY }), {
        mode: 'test',
        secretKey: TEST_KEY,
      });
      assert.strictEqual(
        resolvePaystackConfig({ PAYSTACK_MODE: '', PAYSTACK_SECRET_KEY: TEST_KEY }).mode,
        'test',
      );
    });

    it('should reject a live key in test mode', () => {
      assert.throws(
        () => resolvePaystackConfig({ PAYSTACK_SECRET_KEY: LIVE_KEY }),
        /must begin with "sk_test_"/,
      );
    });

    it('should accept only a live key in live mode', () => {
      assert.strictEqual(
        resolvePaystackConfig({ PAYSTACK_MODE: 'live', PAYSTACK_SECRET_KEY: LIVE_KEY }).mode,
        'live',
      );
      assert.throws(
        () => resolvePaystackConfig({ PAYSTACK_MODE: 'live', PAYSTACK_SECRET_KEY: TEST_KEY }),
        /must begin with "sk_live_"/,
      );
    });

    it('should reject unknown modes and missing keys without echoing the key', () => {
      assert.throws(
        () => resolvePaystackConfig({ PAYSTACK_MODE: 'prod', PAYSTACK_SECRET_KEY: LIVE_KEY }),
        (error: Error) =>
          /must be "test" or "live"/.test(error.message) && !error.message.includes(LIVE_KEY),
      );
      assert.throws(() => resolvePaystackConfig({}), /not set/);
    });

    it('should only enforce the allowlist in live mode', () => {
      assert.ok(
        createModePaystackClient({ PAYSTACK_MODE: 'live', PAYSTACK_SECRET_KEY: LIVE_KEY })
          .client instanceof LiveModePaystackClient,
      );
      assert.ok(
        !(
          createModePaystackClient({ PAYSTACK_SECRET_KEY: TEST_KEY }).client instanceof
          LiveModePaystackClient
        ),
      );
    });
  });

  describe('live-mode allowlist', () => {
    const allowed: Array<[string, string]> = [
      ['POST', '/paymentrequest'],
      ['GET', '/paymentrequest?status=pending&perPage=5'],
      ['PUT', '/paymentrequest/PRQ_123'],
      ['POST', '/paymentrequest/notify/PRQ_123'],
      ['GET', '/paymentrequest/verify/PRQ_123'],
      ['get', '/customer/someone%40example.com'],
      ['POST', '/customer'],
      ['PUT', '/customer/CUS_123'],
      ['GET', '/transaction'],
      ['GET', '/transaction/verify/ref_123'],
      ['GET', '/balance'],
      ['GET', '/balance/'],
    ];
    for (const [method, path] of allowed) {
      it(`should allow ${method} ${path}`, () => {
        assert.doesNotThrow(() => assertLiveRequestAllowed(method, path));
      });
    }

    const blocked: Array<[string, string]> = [
      ['POST', '/transfer'],
      ['POST', '/transfer/bulk'],
      ['POST', '/refund'],
      ['POST', '/charge'],
      ['POST', '/transaction/initialize'],
      ['POST', '/transaction/charge_authorization'],
      ['PUT', '/subaccount/ACCT_123'],
      ['GET', '/balance/ledger'],
      ['DELETE', '/paymentrequest/PRQ_123'],
      ['DELETE', '/customer/CUS_123'],
      ['GET', '/customers'],
      ['GET', '/paymentrequests'],
      // Path tricks that fetch would normalise onto a blocked endpoint
      ['POST', '/paymentrequest/../transfer'],
      ['POST', '/paymentrequest/%2e%2e/transfer'],
      ['POST', '/paymentrequest/..%2Ftransfer'],
      ['POST', '/paymentrequest/..%2ftransfer/..'],
      ['POST', '/paymentrequest/%5C..%5Ctransfer'],
      ['POST', '/customer\\..\\transfer'],
      ['POST', 'paymentrequest'],
      ['POST', '@evil.example/paymentrequest'],
    ];
    for (const [method, path] of blocked) {
      it(`should block ${method} ${path}`, () => {
        assert.throws(() => assertLiveRequestAllowed(method, path), /Blocked in live mode/);
      });
    }

    it('should explain what is allowed and where to change it', () => {
      assert.throws(
        () => assertLiveRequestAllowed('POST', '/transfer'),
        (error: Error) =>
          error.message.includes('POST /transfer') &&
          error.message.includes('/paymentrequest') &&
          error.message.includes('src/worker/live-allowlist.ts'),
      );
    });

    it('should block before any network request is made', async () => {
      const originalFetch = global.fetch;
      const calls = mockFetch();
      try {
        const client = new LiveModePaystackClient(LIVE_KEY);
        await assert.rejects(client.makeRequest('POST', '/transfer', { amount: 1 }), /Blocked/);
        assert.strictEqual(calls.length, 0);

        await client.makeRequest('GET', '/balance');
        assert.deepStrictEqual(calls, ['GET https://api.paystack.co/balance']);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('PaystackClient endpoint validation', () => {
    it('should refuse endpoints that could send the key to another host', async () => {
      const originalFetch = global.fetch;
      const calls = mockFetch();
      try {
        const client = new PaystackClient(TEST_KEY);
        await assert.rejects(client.makeRequest('GET', '@evil.example/x'), /must start with "\/"/);
        await assert.rejects(client.makeRequest('GET', '.evil.example/x'), /must start with "\/"/);
        assert.strictEqual(calls.length, 0);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('instructions', () => {
    it('should keep the test-key rule in test mode and replace it in live mode', () => {
      assert.strictEqual(instructionsForMode(SERVER_INSTRUCTIONS, 'test'), SERVER_INSTRUCTIONS);
      const live = instructionsForMode(SERVER_INSTRUCTIONS, 'live');
      assert.ok(live.includes('LIVE mode'));
      assert.ok(!live.includes('Never use live keys'));
    });
  });

  describe('log redaction', () => {
    it('should redact test and live secret keys inside strings', () => {
      const redacted = redactSensitiveData({
        message: `failed with ${LIVE_KEY} and ${TEST_KEY}`,
      });
      assert.strictEqual(
        redacted.message,
        'failed with [REDACTED_SECRET_KEY] and [REDACTED_SECRET_KEY]',
      );
    });
  });
});
