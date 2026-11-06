import assert from 'node:assert';
import { loadSkillContent, resetSkillCache } from '../src/skill-loader.js';

const BUNDLED = '---\nname: paystack-skill\n---\nbundled';
const REMOTE = '---\nname: paystack-skill\n---\nremote';

describe('SkillLoader', () => {
  const originalFetch = global.fetch;
  let fetchCalls: number;

  beforeEach(() => {
    resetSkillCache();
    fetchCalls = 0;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return remote content and cache it in memory', async () => {
    global.fetch = async () => {
      fetchCalls++;
      return { ok: true, text: async () => REMOTE } as Response;
    };

    assert.strictEqual(await loadSkillContent(BUNDLED), REMOTE);
    assert.strictEqual(await loadSkillContent(BUNDLED), REMOTE);
    assert.strictEqual(fetchCalls, 1);
  });

  it('should fall back to bundled content when the fetch fails', async () => {
    global.fetch = async () => {
      fetchCalls++;
      throw new Error('network down');
    };

    assert.strictEqual(await loadSkillContent(BUNDLED), BUNDLED);
    // A recent failure should not trigger another fetch straight away
    assert.strictEqual(await loadSkillContent(BUNDLED), BUNDLED);
    assert.strictEqual(fetchCalls, 1);
  });

  it('should ignore remote content that does not look like the skill file', async () => {
    global.fetch = async () => ({ ok: true, text: async () => '<html>' }) as Response;

    assert.strictEqual(await loadSkillContent(BUNDLED), BUNDLED);
  });
});
