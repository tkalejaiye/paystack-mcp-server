import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { AuthProps, escapeHtml, isAllowedUser } from './auth-utils';

export interface GitHubHandlerEnv {
  OAUTH_PROVIDER: OAuthHelpers;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  ALLOWED_GITHUB_USERS: string;
}

function textResponse(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Handles everything that isn't the MCP API or an OAuth protocol endpoint:
 * the /authorize consent screen and the GitHub /callback. Consent and upstream
 * state are bound to the browser by the OAuth provider's helpers.
 */
export const GitHubHandler = {
  async fetch(request: Request, env: GitHubHandlerEnv): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/authorize' && request.method === 'GET') return authorizeGet(request, env);
    if (pathname === '/authorize' && request.method === 'POST') return authorizePost(request, env);
    if (pathname === '/callback' && request.method === 'GET') return callback(request, env);
    if (pathname === '/') {
      return textResponse(200, 'Paystack MCP server. Connect an MCP client to /mcp.');
    }

    return textResponse(404, 'Not found');
  },
};

function rememberOptions(env: GitHubHandlerEnv) {
  return { secret: env.COOKIE_ENCRYPTION_KEY };
}

async function authorizeGet(request: Request, env: GitHubHandlerEnv) {
  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    return textResponse(400, `Invalid authorization request: ${(error as Error).message}`);
  }

  if (await env.OAUTH_PROVIDER.isConsentRemembered(request, authRequest, rememberOptions(env))) {
    return redirectToGitHub(request, env, authRequest, new Headers());
  }

  const consent = await env.OAUTH_PROVIDER.describeConsent(authRequest);
  const { handle, headers } = await env.OAUTH_PROVIDER.beginConsent(authRequest);
  const loopbackWarning = consent.redirectIsLoopback
    ? '<p class="warn">This redirects to an app on your own computer. Any local program could receive the token.</p>'
    : '';

  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize Paystack MCP</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #111; background: #fff; }
  code { word-break: break-all; }
  button { font-size: 1rem; padding: .6rem 1.2rem; border-radius: .4rem; border: 1px solid #011b33; cursor: pointer; }
  .approve { background: #011b33; color: #fff; }
  .deny { background: #fff; color: #011b33; }
  .muted { color: #555; font-size: .9rem; }
  .warn { color: #8a3b00; }
</style>
</head>
<body>
<h1>Authorize access to Paystack</h1>
<p><strong>${escapeHtml(consent.clientName)}</strong>${
      consent.clientDomain ? ` (${escapeHtml(consent.clientDomain)})` : ''
    } wants to use this Paystack MCP server.</p>
<p>Tokens will be sent to <strong>${escapeHtml(consent.redirectHost)}</strong>.</p>
<p class="muted"><code>${escapeHtml(consent.redirectUri)}</code></p>
${loopbackWarning}
<p>Next you'll sign in with GitHub. Only allowlisted GitHub accounts are granted access.</p>
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <button class="approve" type="submit" name="action" value="approve">Approve and continue to GitHub</button>
  <button class="deny" type="submit" name="action" value="deny">Deny</button>
</form>
</body>
</html>`,
    { headers },
  );
}

async function authorizePost(request: Request, env: GitHubHandlerEnv) {
  const form = await request.formData();
  const handle = String(form.get('handle') ?? '');

  try {
    if (form.get('action') === 'deny') {
      const { redirectTo, headers } = await env.OAUTH_PROVIDER.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: withLocation(headers, redirectTo) });
    }

    const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, {
      remember: rememberOptions(env),
    });
    return redirectToGitHub(request, env, approved.request, approved.headers);
  } catch (error) {
    return textResponse(
      400,
      `This consent form is invalid or expired (${(error as Error).message}). Start the connection again from your MCP client.`,
    );
  }
}

async function redirectToGitHub(
  request: Request,
  env: GitHubHandlerEnv,
  authRequest: AuthRequest,
  headers: Headers,
) {
  const upstream = await env.OAUTH_PROVIDER.beginUpstream(authRequest, { headers });

  const githubUrl = new URL('https://github.com/login/oauth/authorize');
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set('redirect_uri', new URL('/callback', request.url).href);
  githubUrl.searchParams.set('state', upstream.state);
  // No scope: the public profile is all we need to read the login

  return new Response(null, {
    status: 302,
    headers: withLocation(upstream.headers, githubUrl.href),
  });
}

function withLocation(headers: Headers, location: string) {
  headers.set('Location', location);
  return headers;
}

async function callback(request: Request, env: GitHubHandlerEnv) {
  let resumed: Awaited<ReturnType<OAuthHelpers['finishUpstream']>>;
  try {
    resumed = await env.OAUTH_PROVIDER.finishUpstream(request);
  } catch (error) {
    return textResponse(
      400,
      `Sign-in state is invalid or expired (${(error as Error).message}). Start the connection again from your MCP client.`,
    );
  }

  const code = new URL(request.url).searchParams.get('code');
  if (!code) return textResponse(400, 'GitHub did not return an authorization code');

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/callback', request.url).href,
    }),
  });
  const token = (await tokenResponse.json()) as { access_token?: string; error?: string };
  if (!token.access_token) {
    return textResponse(400, `GitHub sign-in failed: ${token.error ?? 'no access token returned'}`);
  }

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'paystack-mcp-server',
    },
  });
  if (!userResponse.ok) return textResponse(502, 'Could not read your GitHub profile');
  const user = (await userResponse.json()) as { login: string; name: string | null };

  if (!isAllowedUser(user.login, env.ALLOWED_GITHUB_USERS)) {
    return textResponse(403, `GitHub user "${user.login}" is not allowed to use this server.`);
  }

  const props: AuthProps = { login: user.login, name: user.name };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: resumed.request,
    userId: user.login,
    metadata: { label: user.name ?? user.login },
    scope: resumed.request.scope,
    props,
  });

  return new Response(null, { status: 302, headers: withLocation(resumed.headers, redirectTo) });
}
