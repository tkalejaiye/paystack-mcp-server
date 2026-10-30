import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenAPIParser } from '../openapi-parser';
import { PaystackClient } from '../paystack-client';
import { registerGetPaystackOperationTool } from './get-paystack-operation';
import { registerMakePaystackRequestTool } from './make-paystack-request';

export function registerAllTools(
  server: McpServer,
  openapi: OpenAPIParser,
  paystackClient: PaystackClient,
) {
  registerGetPaystackOperationTool(server, openapi);
  registerMakePaystackRequestTool(server, paystackClient);
}
