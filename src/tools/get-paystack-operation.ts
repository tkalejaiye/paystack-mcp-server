import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { OpenAPIParser } from '../openapi-parser';

const AMOUNT_NOTE =
  'Amount fields are in the smallest currency unit: kobo (NGN), pesewas (GHS), cents ' +
  '(ZAR, KES, USD). Multiply the major-unit amount by 100, e.g. NGN 1,500.50 is 150050. ' +
  'XOF has no subunit but must still be multiplied by 100.';

/** Usage notes the spec doesn't state consistently, derived from an operation's fields. */
export function operationNotes(fieldNames: string[]): string[] {
  const hasAmount = fieldNames.some((name) => /(^|_)amount$/i.test(name));
  return hasAmount ? [AMOUNT_NOTE] : [];
}

export function registerGetPaystackOperationTool(server: McpServer, openapi: OpenAPIParser) {
  const operations = openapi.getOperations();

  server.registerTool(
    'get_paystack_operation',
    {
      description: `Get Paystack API operation details by operation ID. Available
      operations are:
      ${Object.keys(operations)
        .map((operation) => operation)
        .join(', ')}`,
      annotations: {
        title: 'Get endpoint details by operation ID',
        readOnlyHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        operation_id: z.string().describe('The operation ID of the Paystack API endpoint'),
      },
    },
    async ({ operation_id }) => {
      try {
        const operation = openapi.getOperationById(operation_id.trim());

        if (!operation) {
          return {
            content: [
              {
                type: 'text',
                text: `Operation with ID ${operation_id} not found.`,
              },
            ],
            isError: true,
          };
        }

        const notes = operationNotes(openapi.getOperationFieldNames(operation_id.trim()));
        const details = notes.length > 0 ? { ...operation, notes } : operation;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(details, null, 2),
              mimeType: 'application/json',
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error retrieving operation: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
