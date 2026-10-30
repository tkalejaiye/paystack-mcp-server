// Cloudflare Workers entry point: a remote (Streamable HTTP) MCP server behind
// OAuth, with GitHub as the upstream identity provider. Fork-only; the stdio
// entry in src/index.ts is unaffected.
import OAuthProvider, { type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { PaystackClient } from '../paystack-client';
import { registerPaystackCapabilities, SERVER_INFO, SERVER_INSTRUCTIONS } from '../server';
import { AuthProps, isAllowedUser } from './auth-utils';
import { GitHubHandler } from './github-handler';

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  MCP_OBJECT: DurableObjectNamespace<PaystackMCP>;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  ALLOWED_GITHUB_USERS: string;
  PUBLIC_URL: string;
  PAYSTACK_SECRET_KEY: string;
}

function resolveSecretKey(env: Env): string {
  const key = env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set');
  if (!key.startsWith('sk_test_'))
    throw new Error('PAYSTACK_SECRET_KEY must begin with "sk_test_"');
  return key;
}

export class PaystackMCP extends McpAgent<Env, unknown, AuthProps> {
  server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  async init() {
    await registerPaystackCapabilities(this.server, new PaystackClient(resolveSecretKey(this.env)));
  }
}

const mcpHandler = PaystackMCP.serve('/mcp', { binding: 'MCP_OBJECT' });

// Re-check the allowlist on every request, so removing a user takes effect
// immediately rather than when their token expires.
const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props?: AuthProps }) {
    if (!isAllowedUser(ctx.props?.login, env.ALLOWED_GITHUB_USERS)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      resolveSecretKey(env);
    } catch (error) {
      return new Response(`Server misconfigured: ${(error as Error).message}`, { status: 500 });
    }
    return mcpHandler.fetch(request, env, ctx);
  },
};

// The provider needs this deployment's canonical /mcp URL, which only the env knows
let provider: OAuthProvider<Env> | undefined;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    provider ??= new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: apiHandler as never,
      defaultHandler: GitHubHandler as never,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/token',
      clientRegistrationEndpoint: '/register',
      resourceMetadata: {
        resource: new URL('/mcp', env.PUBLIC_URL).href,
        resource_name: 'Paystack MCP',
      },
    });
    return provider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
