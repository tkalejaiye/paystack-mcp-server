/** Props attached to every access token issued by the OAuth provider. */
export interface AuthProps extends Record<string, unknown> {
  login: string;
  name: string | null;
}

/** Parse a comma/space separated list of GitHub usernames. Empty → nobody allowed. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[\s,]+/)
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedUser(login: string | undefined, rawAllowlist: string | undefined) {
  return !!login && parseAllowlist(rawAllowlist).has(login.toLowerCase());
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
