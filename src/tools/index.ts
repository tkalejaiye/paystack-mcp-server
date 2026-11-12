import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenAPIParser } from '../openapi-parser';
import { PaystackClient } from '../paystack-client';
import { registerGetPaystackOperationTool } from './get-paystack-operation';
import { registerGetPaystackWorkflowTool } from './get-paystack-workflow';
import { registerMakePaystackRequestTool } from './make-paystack-request';
import { Workflow } from '../workflows';

export function registerAllTools(
  server: McpServer,
  openapi: OpenAPIParser,
  paystackClient: PaystackClient,
  workflows: Workflow[] = [],
) {
  registerGetPaystackOperationTool(server, openapi);
  registerMakePaystackRequestTool(server, paystackClient);
  registerGetPaystackWorkflowTool(server, workflows);
}
