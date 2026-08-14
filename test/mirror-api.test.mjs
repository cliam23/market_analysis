import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

async function withScratchProject(fn) {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'mirror-api-'));
  try {
    await mkdir(path.join(dir, 'public', 'data', 'mirror'), { recursive: true });
    process.chdir(dir);
    await fn(dir);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('resolveUniverse defaults to sp500_top150 and accepts sp500_top50', async () => {
  const { resolveUniverse } = await import(`../scripts/lib/read-mirror.mjs?t=${Date.now()}`);
  assert.equal(resolveUniverse({ query: {} }), 'sp500_top150');
  assert.equal(resolveUniverse({ query: { universe: 'sp500_top50' } }), 'sp500_top50');
  assert.equal(resolveUniverse({ query: { universe: 'not_a_real_universe' } }), 'sp500_top150');
});

test('readMirror unwraps the snapshot envelope and adds mirror metadata', async () => {
  await withScratchProject(async (dir) => {
    const ts = Date.now() - 60_000;
    await writeFile(
      path.join(dir, 'public', 'data', 'mirror', 'dashboard-summary.json'),
      JSON.stringify({ _snapshotTs: ts, _snapshotData: { success: true, regime: 'normal' } })
    );
    const { readMirror } = await import(`../scripts/lib/read-mirror.mjs?t=${Date.now()}`);
    const data = readMirror('dashboard-summary.json');
    assert.equal(data.success, true);
    assert.equal(data.regime, 'normal');
    assert.equal(data.publicMirror, true);
    assert.equal(new Date(data.mirroredAt).getTime(), ts);
    assert.ok(data.mirrorAgeMs >= 60_000);
  });
});

test('readMirror returns null when the file is missing', async () => {
  await withScratchProject(async () => {
    const { readMirror } = await import(`../scripts/lib/read-mirror.mjs?t=${Date.now()}`);
    assert.equal(readMirror('does-not-exist.json'), null);
  });
});

test('api/dashboard/summary.js serves the mirrored payload', async () => {
  await withScratchProject(async (dir) => {
    await writeFile(
      path.join(dir, 'public', 'data', 'mirror', 'dashboard-summary.json'),
      JSON.stringify({ _snapshotTs: Date.now(), _snapshotData: { success: true, regime: 'bear' } })
    );
    const { default: handler } = await import(`../api/dashboard/summary.js?t=${Date.now()}`);
    const res = mockRes();
    handler({ query: {} }, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.regime, 'bear');
    assert.equal(res._body.publicMirror, true);
  });
});

test('api/dashboard/summary.js returns 503 when no mirror exists yet', async () => {
  await withScratchProject(async () => {
    const { default: handler } = await import(`../api/dashboard/summary.js?t=${Date.now()}`);
    const res = mockRes();
    handler({ query: {} }, res);
    assert.equal(res._status, 503);
    assert.equal(res._body.success, false);
  });
});

test('api/paper-trade/portfolio.js picks the file for the requested universe', async () => {
  await withScratchProject(async (dir) => {
    await writeFile(
      path.join(dir, 'public', 'data', 'mirror', 'paper-trade-portfolio-sp500_top50.json'),
      JSON.stringify({ _snapshotTs: Date.now(), _snapshotData: { success: true, portfolio: { config: { universe: 'sp500_top50' } } } })
    );
    const { default: handler } = await import(`../api/paper-trade/portfolio.js?t=${Date.now()}`);
    const res = mockRes();
    handler({ query: { universe: 'sp500_top50' } }, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.portfolio.config.universe, 'sp500_top50');
  });
});

test('api/backtest/[universeId].js serves a matching mirrored backtest', async () => {
  await withScratchProject(async (dir) => {
    await writeFile(
      path.join(dir, 'public', 'data', 'mirror', 'backtest-sp500_top50-3y-rlon.json'),
      JSON.stringify({
        _snapshotTs: Date.now(),
        _snapshotData: { success: true, performance: { totalReturn: 0.42 }, dailyValues: [{ date: '2023-01-01', portfolio: 10000 }] }
      })
    );
    const { default: handler } = await import(`../api/backtest/[universeId].js?t=${Date.now()}`);
    const res = mockRes();
    handler(
      {
        query: {
          universeId: 'sp500_top50',
          period: '3y',
          rebalanceFreq: 'quarterly',
          topN: '15',
          strategy: 'full_composite',
          rlAgent: 'true',
          rlMode: 'eval',
          fresh: 'true',
          _t: '123'
        }
      },
      res
    );
    assert.equal(res._status, 200);
    assert.equal(res._body.performance.totalReturn, 0.42);
    assert.equal(res._body.publicMirror, true);
  });
});

test('api/backtest/[universeId].js returns 404 with guidance for an unmirrored combo', async () => {
  await withScratchProject(async () => {
    const { default: handler } = await import(`../api/backtest/[universeId].js?t=${Date.now()}`);
    const res = mockRes();
    handler(
      {
        query: {
          universeId: 'sp500_top50',
          period: '1y', // not in the mirrored matrix (only 3y/5y)
          rebalanceFreq: 'quarterly',
          topN: '15',
          strategy: 'full_composite',
          rlAgent: 'true'
        }
      },
      res
    );
    assert.equal(res._status, 404);
    assert.equal(res._body.success, false);
    assert.match(res._body.error, /S&P Top 50/);
  });
});

test('api/backtest/[universeId].js returns 503 when the matched mirror file is missing', async () => {
  await withScratchProject(async () => {
    const { default: handler } = await import(`../api/backtest/[universeId].js?t=${Date.now()}`);
    const res = mockRes();
    handler(
      {
        query: {
          universeId: 'sp500_top150',
          period: '5y',
          rebalanceFreq: 'quarterly',
          topN: '15',
          strategy: 'full_composite',
          rlAgent: 'false'
        }
      },
      res
    );
    assert.equal(res._status, 503);
  });
});
