import assert from 'node:assert';
import { isAllowedUser, parseAllowlist } from '../src/worker/auth-utils.js';
import { GitHubHandler, GitHubHandlerEnv } from '../src/worker/github-handler.js';

const ORIGIN = 'https://paystack-mcp.example.workers.dev';
const AUTH_REQUEST = {
  responseType: 'code',
  clientId: 'client-1',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  scope: [],
  state: 'client-state',
};

/**
 * A stand-in for the OAuth provider helpers. The real ones bind consent and
 * upstream state to the browser; here we only model "valid handle/state or not".
 */
function createEnv(options: { remembered?: boolean } = {}) {
  const completed: any[] = [];
  const env = {
    OAUTH_PROVIDER: {
      parseAuthRequest: async () => AUTH_REQUEST,
      isConsentRemembered: async () => !!options.remembered,
      describeConsent: async () => ({
        clientId: 'client-1',
        clientName: 'Claude <script>',
        redirectUri: AUTH_REQUEST.redirectUri,
        redirectHost: 'claude.ai',
        redirectIsLoopback: false,
        scope: [],
      }),
      beginConsent: async () => ({ handle: 'consent-handle', headers: new Headers() }),
      approveConsent: async (_request: Request, handle: string) => {
        if (handle !== 'consent-handle') throw new Error('unbound handle');
        return { request: AUTH_REQUEST, headers: new Headers() };
      },
      denyConsent: async () => ({
        request: AUTH_REQUEST,
        redirectTo: `${AUTH_REQUEST.redirectUri}?error=access_denied`,
        headers: new Headers(),
      }),
      beginUpstream: async (_request: unknown, opts: { headers?: Headers } = {}) => ({
        state: 'upstream-state',
        headers: opts.headers ?? new Headers(),
      }),
      finishUpstream: async (request: Request) => {
        if (new URL(request.url).searchParams.get('state') !== 'upstream-state') {
          throw new Error('unbound state');
        }
        return { request: AUTH_REQUEST, data: undefined, headers: new Headers() };
      },
      completeAuthorization: async (opts: any) => {
        completed.push(opts);
        return { redirectTo: `${AUTH_REQUEST.redirectUri}?code=abc` };
      },
    },
    GITHUB_CLIENT_ID: 'gh-client',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    COOKIE_ENCRYPTION_KEY: 'x'.repeat(32),
    ALLOWED_GITHUB_USERS: 'tkalejaiye',
  } as unknown as GitHubHandlerEnv;
  return { env, completed };
}

function mockGitHub(login: string) {
  global.fetch = async (input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://github.com/login/oauth/access_token') {
      return new Response(JSON.stringify({ access_token: 'gho_test' }));
    }
    if (url === 'https://api.github.com/user') {
      return new Response(JSON.stringify({ login, name: 'Test User' }));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function postForm(fields: Record<string, string>) {
  return new Request(`${ORIGIN}/authorize`, {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

describe('Worker auth', () => {
  describe('allowlist', () => {
    it('should parse comma or space separated logins case-insensitively', () => {
      assert.deepStrictEqual([...parseAllowlist(' Alice, bob  carol ')], ['alice', 'bob', 'carol']);
      assert.ok(isAllowedUser('ALICE', 'alice'));
    });

    it('should reject everyone when the allowlist is empty or unset', () => {
      assert.strictEqual(isAllowedUser('alice', ''), false);
      assert.strictEqual(isAllowedUser('alice', undefined), false);
      assert.strictEqual(isAllowedUser(undefined, 'alice'), false);
    });
  });

  describe('GitHubHandler', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should show an escaped consent page for a new client', async () => {
      const { env } = createEnv();
      const response = await GitHubHandler.fetch(new Request(`${ORIGIN}/authorize`), env);
      const html = await response.text();

      assert.strictEqual(response.status, 200);
      assert.ok(html.includes('Claude &lt;script&gt;'));
      assert.ok(!html.includes('Claude <script>'));
      assert.ok(html.includes('value="consent-handle"'));
    });

    it('should go straight to GitHub when consent is remembered', async () => {
      const { env } = createEnv({ remembered: true });
      const response = await GitHubHandler.fetch(new Request(`${ORIGIN}/authorize`), env);

      assert.strictEqual(response.status, 302);
      const location = new URL(response.headers.get('Location')!);
      assert.strictEqual(
        location.origin + location.pathname,
        'https://github.com/login/oauth/authorize',
      );
      assert.strictEqual(location.searchParams.get('state'), 'upstream-state');
      assert.strictEqual(location.searchParams.get('redirect_uri'), `${ORIGIN}/callback`);
      assert.strictEqual(location.searchParams.get('scope'), null);
    });

    it('should redirect to GitHub after approval', async () => {
      const { env } = createEnv();
      const response = await GitHubHandler.fetch(
        postForm({ handle: 'consent-handle', action: 'approve' }),
        env,
      );
      assert.strictEqual(response.status, 302);
      assert.ok(
        response.headers.get('Location')!.startsWith('https://github.com/login/oauth/authorize'),
      );
    });

    it('should reject a consent form with an invalid handle', async () => {
      const { env } = createEnv();
      const response = await GitHubHandler.fetch(
        postForm({ handle: 'forged', action: 'approve' }),
        env,
      );
      assert.strictEqual(response.status, 400);
    });

    it('should send the client an access_denied redirect when denied', async () => {
      const { env } = createEnv();
      const response = await GitHubHandler.fetch(
        postForm({ handle: 'consent-handle', action: 'deny' }),
        env,
      );
      assert.strictEqual(response.status, 302);
      assert.ok(response.headers.get('Location')!.includes('error=access_denied'));
    });

    it('should complete authorization for an allowlisted GitHub user', async () => {
      const { env, completed } = createEnv();
      mockGitHub('TKalejaiye');

      const response = await GitHubHandler.fetch(
        new Request(`${ORIGIN}/callback?code=xyz&state=upstream-state`),
        env,
      );

      assert.strictEqual(response.status, 302);
      assert.strictEqual(response.headers.get('Location'), `${AUTH_REQUEST.redirectUri}?code=abc`);
      assert.strictEqual(completed.length, 1);
      assert.deepStrictEqual(completed[0].props, { login: 'TKalejaiye', name: 'Test User' });
      assert.strictEqual(completed[0].userId, 'TKalejaiye');
    });

    it('should reject a GitHub user who is not on the allowlist', async () => {
      const { env, completed } = createEnv();
      mockGitHub('someone-else');

      const response = await GitHubHandler.fetch(
        new Request(`${ORIGIN}/callback?code=xyz&state=upstream-state`),
        env,
      );

      assert.strictEqual(response.status, 403);
      assert.ok((await response.text()).includes('not allowed'));
      assert.strictEqual(completed.length, 0);
    });

    it('should reject a callback with an invalid state without calling GitHub', async () => {
      const { env, completed } = createEnv();
      let fetched = false;
      global.fetch = async () => {
        fetched = true;
        return new Response('{}');
      };

      const response = await GitHubHandler.fetch(
        new Request(`${ORIGIN}/callback?code=xyz&state=forged`),
        env,
      );

      assert.strictEqual(response.status, 400);
      assert.strictEqual(fetched, false);
      assert.strictEqual(completed.length, 0);
    });
  });
});
