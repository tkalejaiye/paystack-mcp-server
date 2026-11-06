# Upstream notes

This fork tracks [PaystackOSS/paystack-mcp-server](https://github.com/PaystackOSS/paystack-mcp-server).
Workers-specific code stays in `src/worker/` and `wrangler.toml`, so the core stays easy to diff and the generic improvements can go back upstream as PRs.

Sync with upstream:

```bash
git fetch upstream && git checkout main && git merge upstream/main && git push origin main
```

## Good PR candidates for PaystackOSS

Each one is a self-contained commit; cherry-pick it onto a branch from `upstream/main`.

| Change | Commit subject | Files | Why upstream wants it |
| --- | --- | --- | --- |
| Build-time data bundling | Remove runtime file system access so the core runs on Workers | `scripts/bundle-data.mjs`, `src/openapi-parser.ts`, `src/skill-loader.ts`, `src/server.ts`, `src/stdio-server.ts`, `src/config.ts`, `src/tools/*` | No YAML parsing at startup; drops `@apidevtools/swagger-parser`; no `~/.paystack-mcp` writes; the core runs on any runtime (Workers, Deno, Bun, edge) |
| Client injection | (same commit) | `src/tools/index.ts`, `src/tools/make-paystack-request.ts` | Tools are testable without `process.exit`/dotenv, and embedders can pass their own client |
| Endpoint must stay on `api.paystack.co` | Keep the secret key on api.paystack.co and redact live keys in logs | `src/paystack-client.ts` | **Security:** path `@evil.example/x` currently sends the Bearer key to `evil.example`. A prompt-injected model could exfiltrate the key |
| Redact `sk_live_` in logs | (same commit) | `src/logger.ts` | Defence in depth, even though upstream rejects live keys |
| GET `data` → query string | Send GET request data as query parameters | `src/paystack-client.ts` | Bug: the documented `{ perPage: 5 }` example is silently dropped today |
| Invoice tools | Add invoice convenience tools | `src/tools/invoices.ts`, `src/tools/index.ts`, `src/server.ts`, `test/invoices.spec.ts` | `create_invoice` etc. with exact naira→kobo conversion; works in test mode as-is |
| Invoice tools in README | Docs commit (tools table only) | `README.md` (Available Tools rows) | Keeps the tools table accurate |

Notes for the upstream PRs:

- `.prettierignore` and the `src/generated/**` eslint ignore are part of the bundling change.
- The upstream `.vscode/mcp.json` contains a hardcoded `sk_test_` key. Worth flagging so it can be rotated and removed.

## Fork-only

| Change | Files | Why it stays here |
| --- | --- | --- |
| Workers entry, OAuth, GitHub allowlist | `src/worker/index.ts`, `src/worker/github-handler.ts`, `src/worker/auth-utils.ts`, `wrangler.toml`, `tsconfig.worker.json`, `test/worker-auth.spec.ts` | Hosting- and identity-specific |
| Live mode + allowlist | `src/worker/paystack-mode.ts`, `src/worker/live-allowlist.ts`, `test/live-mode.spec.ts` | Upstream deliberately rejects live keys |
| Workers devDependencies, `.npmrc` (`legacy-peer-deps`) | `package.json`, `package-lock.json`, `.npmrc` | Only needed for the Worker build. Drop these hunks when cherry-picking; the `@modelcontextprotocol/sdk` bump to `1.32.2` is optional upstream |
| `typecheck:worker`, `dev:worker`, `deploy` scripts; `tsconfig.json` excluding `src/worker` | `package.json`, `tsconfig.json` | Worker tooling |
| Remote-server README sections | `README.md` ("Remote server on Cloudflare Workers (fork)", remote troubleshooting rows) | Fork-specific instructions |
| This file | `UPSTREAM.md` | |
