import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGet } from '../scripts/lib/read-mirror.mjs';

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
