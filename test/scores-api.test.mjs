import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// api/scores.js resolves its snapshot path from process.cwd() at import time
// (matching how Vercel's Node runtime sets cwd to the project root), so the
// test chdirs into a scratch project layout before importing the handler.
function mockRes() {
  return {
    _status: 200,
    _headers: {},
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    setHeader(k, v) {
      this._headers[k] = v;
    },
    json(body) {
      this._body = body;
      return this;
    }
  };
}

test('GET /api/scores returns the snapshot and sets cache headers', async () => {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'scores-api-'));
  try {
    await mkdir(path.join(dir, 'public', 'data'), { recursive: true });
    await writeFile(
      path.join(dir, 'public', 'data', 'scores-snapshot.json'),
      JSON.stringify({
        generatedAt: new Date(Date.now() - 3600_000).toISOString(),
        universeId: 'sp500_top50',
        regime: 'normal',
        rl: { agentType: 'qlearning' },
        systemStatus: {},
        scanSummary: {},
        topScores: [
          { rank: 1, ticker: 'AAA', name: 'Alpha Corp', sector: 'Technology', price: 100, compositeScore: 80, grade: 'A' },
          { rank: 2, ticker: 'BBB', name: 'Beta Inc', sector: 'Healthcare', price: 50, compositeScore: 60, grade: 'B' }
        ]
      })
    );
    process.chdir(dir);
    const { default: handler } = await import(`../api/scores.js?t=${Date.now()}`);

    const res = mockRes();
    handler({ query: {} }, res);

    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
    assert.equal(res._body.topScores.length, 2);
    assert.ok(res._headers['Cache-Control'].includes('s-maxage'));
    assert.ok(res._body.ageHours >= 0.9 && res._body.ageHours <= 1.1);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/scores?ticker=AAA filters to one row', async () => {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'scores-api-'));
  try {
    await mkdir(path.join(dir, 'public', 'data'), { recursive: true });
    await writeFile(
      path.join(dir, 'public', 'data', 'scores-snapshot.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        universeId: 'sp500_top50',
        regime: 'normal',
        rl: {},
        systemStatus: {},
        scanSummary: {},
        topScores: [
          { rank: 1, ticker: 'AAA', compositeScore: 80 },
          { rank: 2, ticker: 'BBB', compositeScore: 60 }
        ]
      })
    );
    process.chdir(dir);
    const { default: handler } = await import(`../api/scores.js?t=${Date.now()}`);

    const res = mockRes();
    handler({ query: { ticker: 'aaa' } }, res);

    assert.equal(res._body.topScores.length, 1);
    assert.equal(res._body.topScores[0].ticker, 'AAA');
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/scores returns 503 when snapshot is missing', async () => {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'scores-api-'));
  try {
    process.chdir(dir);
    const { default: handler } = await import(`../api/scores.js?t=${Date.now()}`);

    const res = mockRes();
    handler({ query: {} }, res);

    assert.equal(res._status, 503);
    assert.equal(res._body.success, false);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});
