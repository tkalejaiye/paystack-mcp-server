// Cloudflare Workers entry point: a remote (Streamable HTTP) MCP server behind
// OAuth, with GitHub as the upstream identity provider. Fork-only; the stdio
// entry in src/index.ts is unaffected.
import OAuthProvider, { type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { registerPaystackCapabilities, SERVER_INFO, SERVER_INSTRUCTIONS } from '../server';
import { AuthProps, isAllowedUser } from './auth-utils';
import { GitHubHandler } from './github-handler';
import {
  createModePaystackClient,
  instructionsForMode,
  resolvePaystackConfig,
} from './paystack-mode';

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  MCP_OBJECT: DurableObjectNamespace<PaystackMCP>;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  ALLOWED_GITHUB_USERS: string;
  PUBLIC_URL: string;
  /** "test" (default) or "live" */
  PAYSTACK_MODE?: string;
  PAYSTACK_SECRET_KEY: string;
}

export class PaystackMCP extends McpAgent<Env, unknown, AuthProps> {
  server = new McpServer(SERVER_INFO, {
    // apiHandler has already validated the config before any request reaches this object
    instructions: instructionsForMode(SERVER_INSTRUCTIONS, resolvePaystackConfig(this.env).mode),
  });

  async init() {
    // Live mode gets a client that enforces src/worker/live-allowlist.ts on every tool
    const { client } = createModePaystackClient(this.env);
    await registerPaystackCapabilities(this.server, client);
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
      resolvePaystackConfig(env);
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
