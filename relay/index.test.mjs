import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateTarget } from './src/index.js';

const TARGET = 'https://canvas.example.edu/api/v1/users/self/todo_items';

function request(path = '/', init = {}) {
  return new Request(`https://relay.example.workers.dev${path}`, init);
}

test('validateTarget accepts Canvas API URLs only', () => {
  const valid = validateTarget(TARGET);
  assert.equal(valid.error, undefined);
  assert.equal(valid.target.href, TARGET);
  assert.ok(validateTarget(null).error);
  assert.ok(validateTarget('http://canvas.example.edu/api/v1/users/self').error);
  assert.ok(validateTarget('https://canvas.example.edu/users/1').error);
  assert.ok(validateTarget('https://user:pass@canvas.example.edu/api/v1/users/self').error);
  assert.ok(validateTarget('https://canvas.example.edu:8080/api/v1/users/self').error);
  // Path traversal is normalised away by URL, so this lands outside /api/v1/.
  assert.ok(validateTarget('https://evil.example/api/v1/../secrets').error);
});

test('answers preflight OPTIONS with CORS headers', async () => {
  const response = await worker.fetch(request('/', { method: 'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
});

test('refuses methods other than GET and HEAD', async () => {
  const response = await worker.fetch(request('/', { method: 'POST' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
});

test('refuses requests without a target or with a bad target', async () => {
  const missing = await worker.fetch(request('/'));
  assert.equal(missing.status, 400);
  const badPath = await worker.fetch(request(`/?url=${encodeURIComponent('https://canvas.example.edu/profile')}`));
  assert.equal(badPath.status, 400);
  const insecure = await worker.fetch(request(`/?url=${encodeURIComponent('http://canvas.example.edu/api/v1/users/self')}`));
  assert.equal(insecure.status, 400);
});

test('forwards the Authorization header and returns Canvas JSON with CORS', async () => {
  const originalFetch = globalThis.fetch;
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify([{ type: 'submitting' }]), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'canvas_session=secret'
      }
    });
  };
  try {
    const response = await worker.fetch(
      request(`/?url=${encodeURIComponent(TARGET)}`, { headers: { Authorization: 'Bearer student-token' } })
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(seen.url, TARGET);
    assert.equal(seen.init.headers.get('Authorization'), 'Bearer student-token');
    assert.deepEqual(await response.json(), [{ type: 'submitting' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('passes Canvas error statuses through instead of hiding them', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"errors":[{"message":"invalid token"}]}', {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
  try {
    const response = await worker.fetch(
      request(`/?url=${encodeURIComponent(TARGET)}`, { headers: { Authorization: 'Bearer bad' } })
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports a relay-side failure when Canvas is unreachable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    const response = await worker.fetch(request(`/?url=${encodeURIComponent(TARGET)}`));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
