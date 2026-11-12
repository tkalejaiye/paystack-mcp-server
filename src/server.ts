import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenAPIV3 } from 'openapi-types';
import { OpenAPIParser } from './openapi-parser';
import { PaystackClient } from './paystack-client';
import { registerAllTools } from './tools';
import { registerAllResources } from './resources';
import { loadSkillContent } from './skill-loader';
// Generated from src/data at build time by scripts/bundle-data.mjs
import openapiSpec from './generated/paystack-openapi.json';
import bundledSkillContent from './generated/paystack-skill.json';

export const SERVER_INFO = {
  name: 'paystack',
  version: '0.0.1',
};

export const SERVER_INSTRUCTIONS = `You are connected to the Paystack MCP Server, which provides access to the full Paystack API.

## Source Priority
1. Use this server's tools and resources as the primary source of truth for API details:
   - "paystack_operation_list" resource: browse all available API operations
   - "get_paystack_operation" tool: get endpoint details (method, path, parameters, request body)
   - "read_paystack_data" tool: execute read-only (GET) API requests
   - "make_paystack_request" tool: execute API requests that create, change or delete data (POST, PUT, PATCH, DELETE)
2. For integration guides, best practices, and deeper context, refer to Paystack documentation at https://paystack.com/docs/llms.txt
3. For code snippets in JS/TS or cURL, refer to the "paystack_skill" resource
4. If information is not available from the above sources, say so clearly — do not invent Paystack-specific details

## Critical Accuracy Rules
- All amounts must be in the smallest currency unit: kobo (NGN), pesewas (GHS), cents (ZAR/KES/USD). XOF has no subunit but amounts must still be multiplied by 100.
- API requests require authentication: secret keys (server-side) or public keys (client-side only for Popup/Mobile SDKs)
- This server only accepts test keys (sk_test_*). Never use live keys.
- Prefer to use Webhooks for event-driven flows based on your paystack-skills file. 
- Always verify transactions server-side before delivering value
- Validate webhook signatures using your secret key before processing events

## Workflow
Always call "get_paystack_operation" to get endpoint details before calling "read_paystack_data" or "make_paystack_request". Do not guess endpoint paths, methods, or parameter names.
`;

/**
 * Register all Paystack tools and resources on an existing MCP server.
 * This is transport-agnostic so it can back the stdio server or a remote one.
 */
export async function registerPaystackCapabilities(
  server: McpServer,
  paystackClient: PaystackClient,
) {
  const openapi = new OpenAPIParser(openapiSpec as unknown as OpenAPIV3.Document);
  openapi.parse();

  const skillContent = await loadSkillContent(bundledSkillContent);

  registerAllTools(server, openapi, paystackClient);
  registerAllResources(server, openapi, skillContent);
}

export async function createServer(paystackClient: PaystackClient) {
  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
  });

  await registerPaystackCapabilities(server, paystackClient);

  return server;
}
