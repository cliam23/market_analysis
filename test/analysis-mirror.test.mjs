import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analysisMirrorFilename } from '../scripts/lib/analysis-mirror.mjs';

function mockRes() {
  return {
    _status: null,
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

test('analysisMirrorFilename uppercases the ticker', () => {
  assert.equal(analysisMirrorFilename('aapl'), 'analysis-AAPL.json');
  assert.equal(analysisMirrorFilename('MSFT'), 'analysis-MSFT.json');
});

test('api/analysis/[ticker].js serves a mirrored ticker', async () => {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'analysis-api-'));
  try {
    await mkdir(path.join(dir, 'public', 'data', 'mirror'), { recursive: true });
    await writeFile(
      path.join(dir, 'public', 'data', 'mirror', 'analysis-AAPL.json'),
      JSON.stringify({ _snapshotTs: Date.now(), _snapshotData: { success: true, ticker: 'AAPL', score: 82 } })
    );
    process.chdir(dir);
    const { default: handler } = await import(`../api/analysis/[ticker].js?t=${Date.now()}`);

    const res = mockRes();
    handler({ query: { ticker: 'aapl' }, method: 'GET' }, res);

    assert.equal(res._status, 200);
    assert.equal(res._body.ticker, 'AAPL');
    assert.equal(res._body.publicMirror, true);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test('api/analysis/[ticker].js returns a clear 404 for an unmirrored ticker', async () => {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'analysis-api-'));
  try {
    await mkdir(path.join(dir, 'public', 'data', 'mirror'), { recursive: true });
    process.chdir(dir);
    const { default: handler } = await import(`../api/analysis/[ticker].js?t=${Date.now()}`);

    const res = mockRes();
    handler({ query: { ticker: 'ZZZZ' }, method: 'GET' }, res);

    assert.equal(res._status, 404);
    assert.equal(res._body.success, false);
    assert.match(res._body.error, /ZZZZ/);
    assert.match(res._body.error, /S&P 500 Top 150/);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test('api/analysis/[ticker].js rejects non-GET', async () => {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'analysis-api-'));
  try {
    process.chdir(dir);
    const { default: handler } = await import(`../api/analysis/[ticker].js?t=${Date.now()}`);

    const res = mockRes();
    handler({ query: { ticker: 'AAPL' }, method: 'POST' }, res);

    assert.equal(res._status, 405);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});
