import { PaystackClient } from '../paystack-client';
import { PaystackResponse } from '../types';
import { LIVE_ALLOWLIST, LiveAllowlistEntry } from './live-allowlist';

export type PaystackMode = 'test' | 'live';

export interface PaystackModeEnv {
  PAYSTACK_MODE?: string;
  PAYSTACK_SECRET_KEY?: string;
}

const KEY_PREFIX: Record<PaystackMode, string> = { test: 'sk_test_', live: 'sk_live_' };

/**
 * Resolve the mode and secret key from the Worker env. Live mode is opt-in:
 * anything other than an explicit PAYSTACK_MODE=live is test mode, and each
 * mode only accepts its own key type. Errors never include the key itself.
 */
export function resolvePaystackConfig(env: PaystackModeEnv): {
  mode: PaystackMode;
  secretKey: string;
} {
  const rawMode = (env.PAYSTACK_MODE ?? 'test').trim().toLowerCase() || 'test';
  if (rawMode !== 'test' && rawMode !== 'live') {
    throw new Error(`PAYSTACK_MODE must be "test" or "live", got "${rawMode}"`);
  }
  const mode: PaystackMode = rawMode;

  const secretKey = env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY is not set');
  if (!secretKey.startsWith(KEY_PREFIX[mode])) {
    throw new Error(
      `PAYSTACK_MODE is "${mode}" so PAYSTACK_SECRET_KEY must begin with "${KEY_PREFIX[mode]}"`,
    );
  }
  if (secretKey.length < 30) throw new Error('PAYSTACK_SECRET_KEY appears to be too short');

  return { mode, secretKey };
}

function describeEntry(entry: LiveAllowlistEntry) {
  return `${entry.methods.join('|')} ${entry.path}${entry.match === 'prefix' ? '[/*]' : ''}`;
}

/**
 * Throw unless method + path is on the live-mode allowlist. The path is
 * resolved the same way fetch will resolve it (dot segments, encoded dots,
 * backslashes, query strings), so it can't be smuggled past the check.
 */
export function assertLiveRequestAllowed(
  method: string,
  endpoint: string,
  allowlist: LiveAllowlistEntry[] = LIVE_ALLOWLIST,
) {
  const upperMethod = method.toUpperCase();
  let pathname: string;
  try {
    pathname = new URL(`https://api.paystack.co${endpoint}`).pathname;
  } catch {
    pathname = '';
  }
  // Treat a trailing slash as the same resource ('/balance/' → '/balance')
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  // Encoded slashes, backslashes and dots could be decoded into a different path upstream
  const allowed =
    endpoint.startsWith('/') &&
    !/%2f|%5c|%2e/i.test(endpoint) &&
    allowlist.some(
      (entry) =>
        (entry.methods as string[]).includes(upperMethod) &&
        (normalized === entry.path ||
          (entry.match === 'prefix' && normalized.startsWith(`${entry.path}/`))),
    );

  if (!allowed) {
    throw new Error(
      `Blocked in live mode: ${upperMethod} ${normalized || endpoint} is not on the live-mode allowlist. ` +
        `Allowed: ${allowlist.map(describeEntry).join(', ')}. ` +
        'To change this, edit src/worker/live-allowlist.ts and redeploy.',
    );
  }
}

/** A PaystackClient that refuses anything outside the live-mode allowlist. */
export class LiveModePaystackClient extends PaystackClient {
  async makeRequest<T>(method: string, endpoint: string, data?: any): Promise<PaystackResponse<T>> {
    assertLiveRequestAllowed(method, endpoint);
    return super.makeRequest<T>(method, endpoint, data);
  }
}

export function createModePaystackClient(env: PaystackModeEnv) {
  const { mode, secretKey } = resolvePaystackConfig(env);
  return {
    mode,
    client: mode === 'live' ? new LiveModePaystackClient(secretKey) : new PaystackClient(secretKey),
  };
}

const TEST_KEY_RULE = '- This server only accepts test keys (sk_test_*). Never use live keys.';
const LIVE_MODE_RULE =
  '- This deployment is in LIVE mode: requests affect real customers and real money. Only payment ' +
  'request (invoice), customer, read-only transaction and balance endpoints are permitted; anything ' +
  'else is rejected. Confirm the customer, amount and currency with the user before creating or ' +
  'sending an invoice.';

/** The core server instructions, adjusted for the deployment's mode. */
export function instructionsForMode(instructions: string, mode: PaystackMode): string {
  if (mode === 'test') return instructions;
  return instructions.includes(TEST_KEY_RULE)
    ? instructions.replace(TEST_KEY_RULE, LIVE_MODE_RULE)
    : `${instructions}\n${LIVE_MODE_RULE}\n`;
}
