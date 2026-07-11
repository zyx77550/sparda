// pr-comment.test.js — the sticky PR-comment poster used by the SPARDA review
// Action. The network wiring is thin; the logic that matters is "find the bot's
// previous comment by its marker and edit it, else create one" — so a PR gets ONE
// comment that updates, never a wall of duplicates. Tested pure + with a fetch mock.
import { describe, it, expect, afterEach } from 'vitest';
import {
  MARKER,
  withMarker,
  chooseCommentAction,
  postSticky,
} from '../.github/sparda-pr-comment.mjs';

describe('pr-comment: pure decision logic', () => {
  it('withMarker prepends the hidden anchor', () => {
    expect(withMarker('hello')).toBe(`${MARKER}\nhello`);
  });

  it('creates when no prior bot comment exists', () => {
    const choice = chooseCommentAction([
      { id: 1, body: 'a human comment' },
      { id: 2, body: 'LGTM' },
    ]);
    expect(choice).toEqual({ action: 'create' });
  });

  it('updates the bot comment identified by the marker', () => {
    const choice = chooseCommentAction([
      { id: 1, body: 'a human comment' },
      { id: 7, body: `${MARKER}\n## old review` },
    ]);
    expect(choice).toEqual({ action: 'update', id: 7 });
  });
});

describe('pr-comment: postSticky over a mocked GitHub API', () => {
  const orig = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = orig;
  });

  // records calls and replays a scripted list of existing comments
  function mockGitHub(existing) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body });
      const ok = (data) => ({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => '',
      });
      if ((init.method ?? 'GET') === 'GET') return ok(existing);
      return ok({ id: 999 }); // POST/PATCH return the comment
    };
    return calls;
  }

  const cfg = {
    token: 't',
    repo: 'o/r',
    apiUrl: 'https://api.github.com',
    marker: MARKER,
  };

  it('POSTs a new comment (with the marker) when none exists', async () => {
    const calls = mockGitHub([]);
    const res = await postSticky(cfg, 42, '## 🔍 SPARDA review');
    expect(res.action).toBe('create');
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toBe('https://api.github.com/repos/o/r/issues/42/comments');
    expect(JSON.parse(post.body).body).toContain(MARKER);
    expect(JSON.parse(post.body).body).toContain('SPARDA review');
  });

  it('PATCHes the existing sticky comment in place', async () => {
    const calls = mockGitHub([{ id: 55, body: `${MARKER}\nold` }]);
    const res = await postSticky(cfg, 42, '## new body');
    expect(res).toEqual({ action: 'update', id: 55 });
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch.url).toBe('https://api.github.com/repos/o/r/issues/comments/55');
    expect(JSON.parse(patch.body).body).toContain('new body');
  });
});
