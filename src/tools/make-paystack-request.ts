import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { PaystackClient } from '../paystack-client';

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

async function executeRequest(
  paystackClient: PaystackClient,
  method: string,
  path: string,
  data?: Record<string, unknown>,
) {
  try {
    const response = await paystackClient.makeRequest(method, path, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(response, null, 2),
          mimeType: 'application/json',
        },
      ],
    };
  } catch (error) {
    // Follow MCP best practices: return isError flag instead of throwing
    const errorMessage = error instanceof Error ? error.message : String(error);
    const statusCode = (error as any).statusCode;

    let detailedMessage = `Unable to make request: ${errorMessage}`;
    if (statusCode) {
      detailedMessage = `Unable to make request (HTTP ${statusCode}): ${errorMessage}`;
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: detailedMessage,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Reads and writes are separate tools so clients can tell them apart from the
 * annotations alone, e.g. auto-approving lookups but confirming anything that
 * creates, changes or deletes data.
 */
export function registerMakePaystackRequestTool(server: McpServer, paystackClient: PaystackClient) {
  server.registerTool(
    'read_paystack_data',
    {
      description: `Make a read-only (GET) Paystack API request, e.g. to list or fetch
    transactions, customers or invoices. Get the operation details first, including the
    path, path parameters and query parameters. Pass query parameters in "data".`,
      annotations: {
        title: 'Read Paystack data',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        request: z.object({
          path: z.string().describe('Path of the API request, e.g. /transaction'),
          data: z.looseObject({}).optional().describe('Query parameters'),
        }),
      },
    },
    async ({ request }) => executeRequest(paystackClient, 'GET', request.path, request.data),
  );

  server.registerTool(
    'make_paystack_request',
    {
      description: `Make a Paystack API request that creates, changes or deletes data
    (POST, PUT, PATCH or DELETE). Be sure to get all operation details including method,
    path, path parameters and request body before making a call. Use "read_paystack_data"
    for GET requests.`,
      annotations: {
        title: 'Make a Paystack API request',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        request: z.object({
          method: z
            .string()
            .describe(`HTTP method of the API request: ${WRITE_METHODS.join(', ')}`),
          path: z.string().describe('Path of the API request'),
          data: z.looseObject({}).optional().describe('Request body'),
        }),
      },
    },
    async ({ request }) => {
      const method = request.method.trim().toUpperCase();
      if (!(WRITE_METHODS as readonly string[]).includes(method)) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                method === 'GET'
                  ? 'Use the "read_paystack_data" tool for GET requests.'
                  : `Unsupported method "${request.method}". Use one of: ${WRITE_METHODS.join(', ')}.`,
            },
          ],
          isError: true,
        };
      }
      return executeRequest(paystackClient, method, request.path, request.data);
    },
  );
}
