import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  normalizeToken,
  buildUrl,
  endpointFor,
  fetchJson,
  probeCanvas,
  parseTodo,
  parseCourses,
  sortTasks,
  formatDue
} from './canvas.js';

test('normalizeBaseUrl accepts bare domains and strips paths and queries', () => {
  assert.equal(normalizeBaseUrl('school.instructure.com/'), 'https://school.instructure.com');
  assert.equal(normalizeBaseUrl('https://canvas.example.edu/courses/1?x=2#y'), 'https://canvas.example.edu');
  assert.equal(normalizeBaseUrl('  https://canvas.example.edu  '), 'https://canvas.example.edu');
});

test('normalizeBaseUrl rejects unusable addresses', () => {
  assert.equal(normalizeBaseUrl(''), null);
  assert.equal(normalizeBaseUrl('   '), null);
  assert.equal(normalizeBaseUrl('ftp://canvas.example.edu'), null);
  assert.equal(normalizeBaseUrl('not a url ::'), null);
});

test('normalizeBaseUrl keeps a subpath install but strips Canvas deep links', () => {
  assert.equal(normalizeBaseUrl('https://school.edu/canvas'), 'https://school.edu/canvas');
  assert.equal(normalizeBaseUrl('https://school.edu/canvas/'), 'https://school.edu/canvas');
  assert.equal(normalizeBaseUrl('https://x.instructure.com/courses/5/assignments/9'), 'https://x.instructure.com');
  assert.equal(normalizeBaseUrl('https://x.instructure.com/login?session=1'), 'https://x.instructure.com');
});

test('buildUrl puts the API under a subpath install', () => {
  assert.equal(
    buildUrl('https://school.edu/canvas', '/api/v1/users/self/todo', { per_page: 50 }),
    'https://school.edu/canvas/api/v1/users/self/todo?per_page=50'
  );
});

test('probeCanvas tells a real Canvas apart from a plain website', async () => {
  const reply = (status, type) =>
    async () => new Response('<page></page>', { status, headers: { 'content-type': type } });
  const via = handler => ({ relay: 'https://relay.example', fetchImpl: handler });

  assert.equal(await probeCanvas('https://canvas.example.edu', via(reply(401, 'application/json; charset=utf-8'))), 'canvas');
  assert.equal(await probeCanvas('https://wrong.example', via(reply(404, 'text/html; charset=UTF-8'))), 'not-canvas');
  assert.equal(await probeCanvas('https://canvas.example.edu', via(reply(404, 'application/json'))), 'canvas');
  assert.equal(await probeCanvas('https://odd.example', via(reply(200, 'text/html'))), 'unknown');
  assert.equal(await probeCanvas('https://x.example', via(async () => { throw new Error('net down'); })), 'unknown');
});

test('normalizeToken cleans up how people paste tokens', () => {
  assert.equal(normalizeToken('  abc123  '), 'abc123');
  assert.equal(normalizeToken('Bearer abc123'), 'abc123');
  assert.equal(normalizeToken('bearer  abc123'), 'abc123');
  assert.equal(normalizeToken('"abc123"'), 'abc123');
  assert.equal(normalizeToken('abc123\nwrapped'), 'abc123wrapped');
  assert.equal(normalizeToken(''), '');
  assert.equal(normalizeToken(undefined), '');
});

test('buildUrl puts query parameters on the Canvas path', () => {
  const url = buildUrl('https://canvas.example.edu', '/api/v1/users/self/todo_items', { per_page: 50 });
  assert.equal(url, 'https://canvas.example.edu/api/v1/users/self/todo_items?per_page=50');
});

test('endpointFor only wraps the target when a relay is configured', () => {
  const target = 'https://canvas.example.edu/api/v1/users/self/todo_items';
  assert.equal(endpointFor(target, ''), target);
  assert.equal(endpointFor(target, undefined), target);
  assert.equal(
    endpointFor(target, 'https://relay.example.workers.dev/'),
    `https://relay.example.workers.dev?url=${encodeURIComponent(target)}`
  );
});

test('fetchJson sends the bearer token and unwraps JSON through the relay', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const target = 'https://canvas.example.edu/api/v1/users/self/todo';
  const data = await fetchJson(target, { token: 'abc123', relay: 'https://relay.example', fetchImpl });
  assert.deepEqual(data, []);
  assert.equal(seen.url, `https://relay.example?url=${encodeURIComponent(target)}`);
  assert.equal(seen.init.headers.Authorization, 'Bearer abc123');
});

test('fetchJson reports the HTTP status when Canvas says no', async () => {
  const fetchImpl = async () => new Response('', { status: 401 });
  await assert.rejects(
    fetchJson('https://canvas.example.edu/api/v1/users/self', { token: 'bad', fetchImpl }),
    error => error.status === 401
  );
});

test('fetchJson keeps Canvas’s own words from the failed response body', async () => {
  const withBody = (body, status) => async () =>
    new Response(body, { status, headers: { 'content-type': 'text/html' } });

  await assert.rejects(
    fetchJson('https://canvas.example.edu/api/v1/users/self/todo', {
      token: 't',
      fetchImpl: withBody(JSON.stringify({ errors: [{ message: 'API access is disabled' }] }), 403)
    }),
    error => error.status === 403 && error.detail === 'API access is disabled'
  );

  await assert.rejects(
    fetchJson('https://canvas.example.edu/api/v1/users/self/todo', {
      token: 't',
      fetchImpl: withBody('Rate limit exceeded', 403)
    }),
    error => error.detail.includes('rate limit')
  );

  await assert.rejects(
    fetchJson('https://canvas.example.edu/api/v1/users/self/todo', {
      token: 't',
      fetchImpl: withBody('<!DOCTYPE html><title>Attention Required! | Cloudflare</title>', 403)
    }),
    error => error.detail.includes('firewall page')
  );

  await assert.rejects(
    fetchJson('https://canvas.example.edu/api/v1/users/self/todo_items', {
      token: 't',
      fetchImpl: withBody('<!DOCTYPE html><html><body>Not found</body></html>', 404)
    }),
    error => error.status === 404 && error.detail.includes('HTML page, not Canvas')
  );
});

const todoPayload = [
  {
    type: 'submitting',
    assignment: { id: 1, name: 'Essay 3', due_at: '2026-10-05T23:59:00Z', html_url: 'https://s.canvas/courses/1/assignments/1' },
    html_url: 'https://s.canvas/courses/1/assignments/1?query=1',
    context_type: 'course',
    course_id: 10
  },
  {
    type: 'submitting',
    quiz: { id: 2, name: 'Unit quiz', due_at: '2026-10-06T12:00:00Z' },
    html_url: 'https://s.canvas/courses/2/quizzes/2',
    course_id: 20
  },
  {
    type: 'grading',
    assignment: { id: 3, name: 'Lab report', due_at: null },
    needs_grading_count: 3,
    html_url: 'https://s.canvas/courses/3/assignments/3',
    course_id: 30
  },
  null,
  'nonsense'
];

test('parseTodo flattens assignments, quizzes and grading items', () => {
  const courses = parseCourses([
    { id: 10, name: 'English' },
    { id: 20, nickname: 'Calc', name: 'Calculus II' }
  ]);
  const rows = parseTodo(todoPayload, courses);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, 'Essay 3');
  assert.equal(rows[0].course, 'English');
  assert.equal(rows[0].kind, null);
  assert.ok(Number.isFinite(rows[0].dueAt));
  assert.equal(rows[1].title, 'Unit quiz');
  assert.equal(rows[1].kind, 'Quiz');
  assert.equal(rows[1].course, 'Calc');
  assert.equal(rows[2].kind, 'Grade · 3');
  assert.equal(rows[2].dueAt, null);
  assert.equal(rows[2].course, null);
});

test('parseTodo ignores junk and drops exact duplicates', () => {
  const rows = parseTodo([...todoPayload, todoPayload[0]]);
  assert.equal(rows.length, 3);
  assert.deepEqual(parseTodo({ not: 'a list' }), []);
});

test('sortTasks orders by due date with undated items last', () => {
  const sorted = sortTasks([
    { title: 'No date', dueAt: null },
    { title: 'Later', dueAt: 300 },
    { title: 'Sooner', dueAt: 100 },
    { title: 'Also later', dueAt: 300 }
  ]);
  assert.deepEqual(sorted.map(task => task.title), ['Sooner', 'Also later', 'Later', 'No date']);
});

test('formatDue names today, tomorrow and overdue in plain words', () => {
  const now = new Date(2026, 9, 3, 12, 0, 0); // Sat Oct 3 2026, noon local
  const label = due => formatDue(due.getTime(), now);

  const overdueYesterday = label(new Date(2026, 9, 2, 23, 59));
  assert.equal(overdueYesterday.state, 'overdue');
  assert.match(overdueYesterday.label, /^Overdue · Oct 2$/);

  const overdueThisMorning = label(new Date(2026, 9, 3, 9, 0));
  assert.equal(overdueThisMorning.state, 'overdue');
  assert.match(overdueThisMorning.label, /^Overdue ·/);

  const tonight = label(new Date(2026, 9, 3, 23, 59));
  assert.equal(tonight.state, 'today');
  assert.match(tonight.label, /^Today ·/);

  const tomorrow = label(new Date(2026, 9, 4, 23, 59));
  assert.equal(tomorrow.state, 'soon');
  assert.match(tomorrow.label, /^Tomorrow ·/);

  const laterThisWeek = label(new Date(2026, 9, 7, 23, 59));
  assert.equal(laterThisWeek.state, 'soon');
  assert.match(laterThisWeek.label, /^Wed ·/);

  const nextWeek = label(new Date(2026, 9, 15, 23, 59));
  assert.equal(nextWeek.state, 'later');
  assert.match(nextWeek.label, /^Oct 15 ·/);

  const missing = formatDue(null, now);
  assert.deepEqual(missing, { label: 'No due date', state: 'none' });
  assert.deepEqual(formatDue('not-a-date', now), { label: 'No due date', state: 'none' });
});
