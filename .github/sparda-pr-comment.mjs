#!/usr/bin/env node
// .github/sparda-pr-comment.mjs — post/update ONE sticky PR comment.
//
// Used by the SPARDA GitHub Action in `mode: review`. It finds the bot's previous
// comment by a hidden marker and edits it in place, so a pull request carries a
// single comment that updates on every push — never a wall of duplicates. This is
// the growth loop: every PR shows the whole team the behavior diff, for free.
//
// Dependency-free (node:fs + the global fetch on Node >=18). Reads its config from
// the GitHub Actions environment. It NEVER fails the job: a comment that can't be
// posted (missing token, fork PR with a read-only token, API hiccup) must not turn
// a green review red — the gate is a separate, opt-in concern.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '<!-- sparda-review -->';

// The marker is an HTML comment: invisible in the rendered comment, but a stable
// anchor we can find on the next run.
export function withMarker(body, marker = MARKER) {
  return `${marker}\n${body}`;
}

// Decide whether to create a new comment or edit the bot's previous one. Pure.
export function chooseCommentAction(comments, marker = MARKER) {
  const mine = comments.find(
    (c) => typeof c.body === 'string' && c.body.includes(marker),
  );
  return mine ? { action: 'update', id: mine.id } : { action: 'create' };
}

async function gh(cfg, url, { method = 'GET', body } = {}) {
  const res = await fetch(`${cfg.apiUrl}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'sparda-review',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${url} → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function listComments(cfg, pr) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(
      cfg,
      `/repos/${cfg.repo}/issues/${pr}/comments?per_page=100&page=${page}`,
    );
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// Create-or-update the single sticky comment. `cfg` = { token, repo, apiUrl, marker }.
export async function postSticky(cfg, pr, body) {
  const full = withMarker(body, cfg.marker);
  const choice = chooseCommentAction(await listComments(cfg, pr), cfg.marker);
  if (choice.action === 'update') {
    await gh(cfg, `/repos/${cfg.repo}/issues/comments/${choice.id}`, {
      method: 'PATCH',
      body: { body: full },
    });
    return { action: 'update', id: choice.id };
  }
  const created = await gh(cfg, `/repos/${cfg.repo}/issues/${pr}/comments`, {
    method: 'POST',
    body: { body: full },
  });
  return { action: 'create', id: created.id };
}

function prNumber() {
  if (process.env.SPARDA_PR_NUMBER) return Number(process.env.SPARDA_PR_NUMBER);
  try {
    const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    return ev.pull_request?.number ?? ev.number ?? null;
  } catch {
    return null;
  }
}

function main() {
  const cfg = {
    token: process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
    marker: MARKER,
  };
  const bodyFile = process.env.SPARDA_REVIEW_BODY_FILE;
  const done = (msg) => {
    console.error(`[sparda] pr-comment: ${msg}`);
    process.exit(0); // never fail the job over a comment
  };
  if (!cfg.token || !cfg.repo || !bodyFile) {
    return done(
      'missing GITHUB_TOKEN / GITHUB_REPOSITORY / SPARDA_REVIEW_BODY_FILE — skipping',
    );
  }
  const pr = prNumber();
  if (!pr) return done('not a pull_request event — skipping');
  const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8').trim() : '';
  if (!body || !body.includes('SPARDA'))
    return done('empty/invalid review body — skipping');
  postSticky(cfg, pr, body)
    .then((r) => done(`${r.action}d comment ${r.id}`))
    .catch((e) => done(e.message));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
