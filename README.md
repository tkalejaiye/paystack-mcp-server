# Paystack MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI assistants to interact with the full range of [Paystack APIs](https://paystack.com/docs/api/).

> [!WARNING]
> **Public Preview:** This MCP server is currently in public preview. We're seeking early feedback to improve the next iteration, so use cautiously and report any issues you encounter.

## Quick Start

Install and run via npm (recommended):

```bash
npx @paystack/mcp-server --api-key sk_test_your_key_here
```

Or for local development, clone and build:

```bash
git clone https://github.com/PaystackOSS/paystack-mcp-server.git
cd paystack-mcp-server
npm install
npm run build
```

Then configure your MCP client to use the server (see [Client Integration](#client-integration)).

## Requirements

- Node.js v18+
- npm or yarn
- A Paystack test secret key (starts with `sk_test_`)

## Configuration Options

| Environment Variable       | Purpose                                                |
| -------------------------- | ------------------------------------------------------ | 
| `PAYSTACK_TEST_SECRET_KEY` | Your Paystack test secret key (fallback if no CLI arg) |

You can provide your API key in two ways:
1. **CLI argument (recommended):** `--api-key sk_test_...`
2. **Environment variable:** Set `PAYSTACK_TEST_SECRET_KEY`

> **Security note:** Only test keys (`sk_test_*`) are allowed. The server validates this at startup and will reject live keys.

## Client Integration

The Paystack MCP Server works with any MCP-compatible client. Below is the standard configuration schema used by most clients (Claude Desktop, ChatGPT Desktop, Cursor, Windsurf, etc.).

### Using npm (recommended)

For npm-installed server:

```json
{
  "mcpServers": {
    "paystack": {
      "command": "npx",
      "args": ["@paystack/mcp-server", "--api-key", "sk_test_..."]
    }
  }
}
```

### Using a local build

If you've cloned and built the server locally:

```json
{
  "mcpServers": {
    "paystack": {
      "command": "node",
      "args": ["/path/to/paystack-mcp-server/build/index.js"],
      "env": {
        "PAYSTACK_TEST_SECRET_KEY": "sk_test_..."
      }
    }
  }
}
```

> [!IMPORTANT]
> When setting `command: "node"`, you should ensure you're using Node v18+. If you are using a package manager, you might need to get the path of your Node binary by running this command in your CLI:
>
> ### Linux and MacOS
>
> ```sh
> which node
> ```
>
> ### Windows
>
> ```sh
> where node
> ```
>
> Once you have the path, use it as the value of the MCP Server command in the JSON configuration. e.g., `command: "path/to/installation/bin/node"`

### Where to add this configuration

| Client          | Config file location                              |
| --------------- | ------------------------------------------------- |
| VS Code         | `.vscode/mcp.json`                                |
| Claude Desktop  | `claude_desktop_config.json`                      |
| ChatGPT Desktop | MCP settings in app preferences                   |
| Cursor          | `.cursor/mcp.json` or global MCP settings         |
| Windsurf        | MCP configuration in settings                     |
| Claude Code     | `~/.claude/mcp.json` or project-level `.mcp.json` |

## How It Works

The Paystack MCP Server exposes the **entire Paystack API** to AI assistants by parsing Paystack's OpenAPI specification at runtime. Instead of hardcoding individual endpoints, the server dynamically discovers all available operations and makes them accessible through a small set of tools.

### Available Tools

| Tool                     | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `get_paystack_operation` | Fetch operation details (method, path, parameters) by operation ID |
| `make_paystack_request`  | Execute a Paystack API request                                     |
| `create_invoice`         | Create an invoice (payment request); amounts in naira, sent as kobo |
| `send_invoice_reminder`  | Email the customer a reminder for an existing invoice              |
| `get_invoice_status`     | Check whether an invoice is pending, paid, etc.                    |
| `list_invoices`          | List invoices, filtered by status, customer or date                |

### Available Resources

| Resource                  | URI                          | Description                                              |
| ------------------------- | ---------------------------- | -------------------------------------------------------- |
| `paystack_operation_list` | `paystack://operations/list` | List all available Paystack operations and their details |

### Example

When you ask your AI assistant something like _"Get me the last 5 transactions on my Paystack integration"_, here's what happens behind the scenes:

1. The assistant calls `get_paystack_operation("transaction_list")` to look up the endpoint details
2. It gets back the method (`GET`), path (`/transaction`), and available query parameters
3. It then calls `make_paystack_request` with `{ method: "GET", path: "/transaction", data: { perPage: 5 } }`
4. You get your transactions

### Prompt recommendation

To get the best results when using this MCP server, be specific in your prompts and always include "Paystack" in your requests. The server provides built-in instructions and a knowledge resource (`paystack://skill`) that help the AI assistant find the right documentation, code snippets, and API details.

**Good prompts:**
- "Initialize a Paystack transaction for 50000 NGN"
- "Create a customer with email user@example.com on my Paystack account"
- "How can I send money with the Paystack API?"
- "Show me a cURL example for verifying a Paystack transaction"

**Less effective prompts:**
- "List my transactions" (unclear which service to use)
- "Charge a customer" (missing context about Paystack)

Being explicit ensures the LLM narrows down to the right tool quickly and reduces ambiguity.

## Remote server on Cloudflare Workers (fork)

This fork can also run as a **remote MCP server** on Cloudflare Workers, so you can add it to claude.ai (web and mobile) as a custom connector. The stdio server above is unchanged. Everything Workers-specific lives in `src/worker/` and `wrangler.toml`.

- **Transport:** Streamable HTTP at `/mcp`, via the [Agents SDK](https://developers.cloudflare.com/agents/) (`McpAgent`, one Durable Object per session).
- **Auth:** OAuth 2.1 via [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider), with GitHub as the identity provider. Only GitHub usernames in `ALLOWED_GITHUB_USERS` get access, and that list is re-checked on every request. OAuth state lives in the `OAUTH_KV` namespace.
- **Secrets:** the Paystack key exists only as a Worker secret and is never sent to the MCP client.

### Deploying to Cloudflare

Prerequisites: a Cloudflare account and `npx wrangler login`.

1. Create the KV namespace and put its `id` in `wrangler.toml` (`[[kv_namespaces]]`):

   ```bash
   npx wrangler kv namespace create OAUTH_KV
   ```

2. In `wrangler.toml`, set `ALLOWED_GITHUB_USERS` (comma-separated) and `PUBLIC_URL` to `https://paystack-mcp.<your-subdomain>.workers.dev`. `npx wrangler whoami` and the Workers dashboard show your subdomain.
3. Deploy: `npm run deploy`.
4. Create a GitHub OAuth App at <https://github.com/settings/applications/new>:
   - **Homepage URL:** `https://paystack-mcp.<your-subdomain>.workers.dev`
   - **Authorization callback URL:** `https://paystack-mcp.<your-subdomain>.workers.dev/callback`
   - Then generate a client secret.
5. Set the secrets. Each command prompts for the value, so nothing lands in your shell history:

   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put PAYSTACK_SECRET_KEY      # sk_test_... while PAYSTACK_MODE=test
   openssl rand -hex 32 | npx wrangler secret put COOKIE_ENCRYPTION_KEY
   ```

6. Check it with the MCP Inspector: `npx @modelcontextprotocol/inspector`, then connect with transport **Streamable HTTP** to `https://paystack-mcp.<your-subdomain>.workers.dev/mcp`.

To run the Worker locally, put dummy values (and `PUBLIC_URL=http://localhost:8787`) in `.dev.vars`, which is gitignored, and run `npm run dev:worker`.

### Adding it to claude.ai

1. In claude.ai, open **Settings → Connectors → Add custom connector**.
2. Name it (e.g. "Paystack") and set the URL to `https://paystack-mcp.<your-subdomain>.workers.dev/mcp`.
3. Click **Connect**. Approve the consent screen, then sign in with an allowlisted GitHub account.
4. Enable the connector in a chat, from the tools menu. Connectors added on the web are also available in the Claude mobile apps.

Example: _"Create a Paystack invoice for ada@example.com: 3 hours of consulting at ₦50,000/hour, due 30 November. Send it to her."_

### Switching to live mode

Live mode is opt-in. In live mode the server needs an `sk_live_` key, and **every** tool, including `make_paystack_request`, may only call the method + path pairs in [`src/worker/live-allowlist.ts`](src/worker/live-allowlist.ts):

- `GET|POST|PUT /paymentrequest/*`
- `GET|POST|PUT /customer/*`
- `GET /transaction/*`
- `GET /balance`

Everything else (transfers, refunds, charges, subaccounts, …) is rejected before it reaches Paystack. Review that file before going live.

1. In `wrangler.toml`, set `PAYSTACK_MODE = "live"`.
2. Replace the key (typed at the prompt): `npx wrangler secret put PAYSTACK_SECRET_KEY` → your `sk_live_...` key.
3. Deploy: `npm run deploy`.

Between steps 2 and 3 the server returns `500 Server misconfigured`, because the mode and key don't match. It fails closed and recovers once the deploy lands. To go back to test mode, reverse the steps with an `sk_test_` key.

## Development

### Run locally (without building)

For local development and testing, you can run the TypeScript source directly:

```bash
PAYSTACK_TEST_SECRET_KEY=sk_test_... npm run dev
```

### Run with MCP Inspector

```bash
npm run inspect
```

### Build

```bash
npm run build
```

### Run tests

```bash
npm test
```

## Troubleshooting

| Issue                            | Solution                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| Server exits silently at startup | Check that `PAYSTACK_TEST_SECRET_KEY` is set                       |
| "Invalid key" error              | Key must start with `sk_test_` — live keys are not allowed         |
| Tools not appearing in client    | Ensure the server is running and the client config path is correct |
| Request timeouts                 | Check network connectivity to `api.paystack.co`                    |
| Remote: `403 Forbidden` on `/mcp` | Your GitHub username isn't in `ALLOWED_GITHUB_USERS`              |
| Remote: `500 Server misconfigured` | `PAYSTACK_MODE` and `PAYSTACK_SECRET_KEY` don't match (or a secret is missing) |
| Remote: "Blocked in live mode"   | The endpoint isn't in `src/worker/live-allowlist.ts`               |

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## License

MIT
