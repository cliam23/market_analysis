import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGet, catchAllSegments } from '../scripts/lib/read-mirror.mjs';

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

test('requireGet allows GET', () => {
  const res = mockRes();
  assert.equal(requireGet({ method: 'GET' }, res), true);
  assert.equal(res._status, null);
});

test('requireGet allows HEAD', () => {
  const res = mockRes();
  assert.equal(requireGet({ method: 'HEAD' }, res), true);
});

test('requireGet treats a missing method as GET (Vercel always sets it; defensive default)', () => {
  const res = mockRes();
  assert.equal(requireGet({}, res), true);
});

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`requireGet rejects ${method} with 405`, () => {
    const res = mockRes();
    assert.equal(requireGet({ method }, res), false);
    assert.equal(res._status, 405);
    assert.equal(res._body.success, false);
    assert.equal(res._headers['Allow'], 'GET, HEAD');
  });
}

// catchAllSegments parses req.url directly rather than trusting
// req.query.<catchAllParam> — that key is empty in production for this
// project's "Other" framework preset (confirmed via curl against the live
// deploy; every local simulator missed it since none knew to reproduce the
// quirk). req.url is a plain Node property Vercel doesn't touch.
test('catchAllSegments splits the path after the prefix', () => {
  assert.deepEqual(catchAllSegments({ url: '/api/rl/status' }, '/api/rl/'), ['status']);
});

test('catchAllSegments strips the query string', () => {
  assert.deepEqual(
    catchAllSegments({ url: '/api/paper-trade/portfolio?universe=sp500_top50' }, '/api/paper-trade/'),
    ['portfolio']
  );
});

test('catchAllSegments keeps multiple segments in order', () => {
  assert.deepEqual(
    catchAllSegments({ url: '/api/diagnostics/factors/sp500_top50?period=3y' }, '/api/diagnostics/'),
    ['factors', 'sp500_top50']
  );
});

test('catchAllSegments returns [] for the bare prefix (trailing slash, no route)', () => {
  assert.deepEqual(catchAllSegments({ url: '/api/rl/' }, '/api/rl/'), []);
});

test("catchAllSegments returns [] when the url doesn't start with prefix", () => {
  assert.deepEqual(catchAllSegments({ url: '/api/other/status' }, '/api/rl/'), []);
});
