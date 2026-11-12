import assert from 'node:assert';
import { createPaystackClient } from '../src/paystack-client.js';

describe('PaystackClient', () => {
  // Use a test API key for the test client
  const paystackClient = createPaystackClient('sk_test_1234567890abcdef1234567890abcdef12345678');

  describe('makeRequest - Non-JSON Response Handling', () => {
    it('should throw a descriptive error for HTML error responses', async () => {
      // This test validates that non-JSON responses (like HTML error pages)
      // are handled gracefully with proper error messages including status code

      // Mock fetch to return an HTML 502 Bad Gateway response
      const originalFetch = global.fetch;
      global.fetch = async () => {
        return {
          status: 502,
          text: async () => '<html><body><h1>502 Bad Gateway</h1></body></html>',
        } as Response;
      };

      try {
        await paystackClient.makeRequest('GET', '/test-endpoint');
        assert.fail('Expected makeRequest to throw an error');
      } catch (error: any) {
        // Verify error message includes status code and response snippet
        assert.ok(error.message.includes('Received non-JSON response from server'));
        assert.ok(error.message.includes('HTTP 502'));
        assert.ok(error.message.includes('<html>'));

        // Verify statusCode is attached to error
        assert.strictEqual(error.statusCode, 502);

        // Verify full responseText is available for debugging
        assert.ok(error.responseText);
        assert.ok(error.responseText.includes('502 Bad Gateway'));
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should truncate long non-JSON responses to 200 characters', async () => {
      const originalFetch = global.fetch;
      const longHtmlResponse = '<html>' + 'x'.repeat(300) + '</html>';

      global.fetch = async () => {
        return {
          status: 500,
          text: async () => longHtmlResponse,
        } as Response;
      };

      try {
        await paystackClient.makeRequest('GET', '/test-endpoint');
        assert.fail('Expected makeRequest to throw an error');
      } catch (error: any) {
        // Verify the error message contains truncated snippet (200 chars + '...')
        const snippetMatch = error.message.match(/: (.+)$/);
        assert.ok(snippetMatch);
        const snippet = snippetMatch[1];

        // Should end with '...' for truncation
        assert.ok(snippet.endsWith('...'));

        // Should be 203 characters (200 + '...')
        assert.ok(snippet.length <= 203);

        // Full response should still be available
        assert.strictEqual(error.responseText, longHtmlResponse);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should not truncate short non-JSON responses', async () => {
      const originalFetch = global.fetch;
      const shortResponse = 'Gateway Timeout';

      global.fetch = async () => {
        return {
          status: 504,
          text: async () => shortResponse,
        } as Response;
      };

      try {
        await paystackClient.makeRequest('GET', '/test-endpoint');
        assert.fail('Expected makeRequest to throw an error');
      } catch (error: any) {
        // Verify the error message contains full short response
        assert.ok(error.message.includes(shortResponse));
        assert.ok(!error.message.includes('...'));
        assert.strictEqual(error.statusCode, 504);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should successfully parse valid JSON responses', async () => {
      const originalFetch = global.fetch;
      const validJsonResponse = {
        status: true,
        message: 'Success',
        data: { id: 123 },
      };

      global.fetch = async () => {
        return {
          status: 200,
          text: async () => JSON.stringify(validJsonResponse),
        } as Response;
      };

      try {
        const response = await paystackClient.makeRequest('GET', '/test-endpoint');
        assert.strictEqual(response.status, true);
        assert.strictEqual(response.message, 'Success');
        assert.deepStrictEqual(response.data, { id: 123 });
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('makeRequest - GET Query Parameters', () => {
    async function requestedUrl(method: string, endpoint: string, data?: object) {
      const originalFetch = global.fetch;
      let captured: { url: string; body?: BodyInit | null } | undefined;
      global.fetch = async (input: any, init?: RequestInit) => {
        captured = { url: String(input), body: init?.body };
        return { status: 200, text: async () => '{"status":true,"data":[]}' } as Response;
      };
      try {
        await paystackClient.makeRequest(method, endpoint, data);
        return captured!;
      } finally {
        global.fetch = originalFetch;
      }
    }

    it('should send GET data as query parameters', async () => {
      const { url, body } = await requestedUrl('GET', '/transaction', { perPage: 5, page: 2 });
      assert.strictEqual(url, 'https://api.paystack.co/transaction?perPage=5&page=2');
      assert.strictEqual(body, undefined);
    });

    it('should merge with a query string already in the path', async () => {
      const { url } = await requestedUrl('get', '/transaction?status=success', { perPage: 5 });
      assert.strictEqual(url, 'https://api.paystack.co/transaction?status=success&perPage=5');
    });

    it('should encode values and skip null or undefined ones', async () => {
      const { url } = await requestedUrl('GET', '/customer', {
        email: 'ada+test@example.com',
        from: undefined,
        to: null,
      });
      assert.strictEqual(url, 'https://api.paystack.co/customer?email=ada%2Btest%40example.com');
    });

    it('should leave GET requests without data unchanged', async () => {
      const { url } = await requestedUrl('GET', '/balance');
      assert.strictEqual(url, 'https://api.paystack.co/balance');
    });

    it('should keep sending POST data as a JSON body', async () => {
      const { url, body } = await requestedUrl('POST', '/transaction/initialize', { amount: 5000 });
      assert.strictEqual(url, 'https://api.paystack.co/transaction/initialize');
      assert.strictEqual(body, '{"amount":5000}');
    });
  });
});
