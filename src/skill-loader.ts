const DEFAULT_SKILL_URL =
  'https://raw.githubusercontent.com/PaystackOSS/paystack-mcp-server/main/src/data/paystack-skill.md';

const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache, shared by every server created in this process (or Worker isolate)
let cache: { content: string; fetchedAt: number } | undefined;
let lastFailureAt = 0;

export function resetSkillCache() {
  cache = undefined;
  lastFailureAt = 0;
}

export async function loadSkillContent(bundledContent: string): Promise<string> {
  const url = process.env.PAYSTACK_SKILL_URL || DEFAULT_SKILL_URL;
  const now = Date.now();

  if (cache && now - cache.fetchedAt < MAX_AGE_MS) {
    return cache.content;
  }

  // Avoid paying the fetch timeout on every server start while the remote is unreachable
  if (now - lastFailureAt >= RETRY_AFTER_FAILURE_MS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const text = await res.text();
        if (text.includes('name: paystack')) {
          cache = { content: text, fetchedAt: now };
          return text;
        }
      }
    } catch {
      // Fetch failed or timed out — fall through
    }
    lastFailureAt = now;
  }

  // Fallback: stale cache → bundled content
  return cache?.content ?? bundledContent;
}
