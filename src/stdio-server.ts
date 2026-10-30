import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPaystackClient } from './config';
import { createServer } from './server';

export async function startServer(cliApiKey?: string) {
  const server = await createServer(createPaystackClient(cliApiKey));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Paystack MCP Server running on stdio...');
  return server;
}
