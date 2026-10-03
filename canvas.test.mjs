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
  fetchMissingIds,
  fetchGradedIds,
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
  assert.equal(await probeCanvas('https://waf.example', via(reply(403, 'text/html; charset=UTF-8'))), 'blocked');
  assert.equal(await probeCanvas('https://canvas.example.edu', via(reply(403, 'application/json'))), 'canvas');
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
    quiz: { id: 2, assignment_id: 20, name: 'Unit quiz', due_at: '2026-10-06T12:00:00Z' },
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
  // Rows carry their ids so callers can ask Canvas about each item.
  assert.equal(rows[0].courseId, 10);
  assert.equal(rows[0].assignmentId, 1);
  assert.equal(rows[1].assignmentId, 20);
});

test('parseTodo ignores junk and drops exact duplicates', () => {
  const rows = parseTodo([...todoPayload, todoPayload[0]]);
  assert.equal(rows.length, 3);
  assert.deepEqual(parseTodo({ not: 'a list' }), []);
});

const jsonResponse = body =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('fetchMissingIds asks Canvas for past-due assignments without a submission', async () => {
  let seenUrl;
  const ids = await fetchMissingIds('https://s.canvas', {
    token: 't',
    fetchImpl: async url => {
      seenUrl = String(url);
      return jsonResponse([{ id: 5 }, { id: 9 }, null, 'junk']);
    }
  });
  assert.ok(seenUrl.includes('/api/v1/users/self/missing_submissions'));
  assert.ok(seenUrl.includes('per_page=100'));
  assert.deepEqual([...ids], [5, 9]);
});

test('fetchMissingIds fails open instead of guessing', async () => {
  // A failed request means "unknown", never an empty list.
  assert.equal(
    await fetchMissingIds('https://s.canvas', { fetchImpl: async () => { throw new Error('down'); } }),
    null
  );
  assert.equal(
    await fetchMissingIds('https://s.canvas', { fetchImpl: async () => new Response('nope', { status: 500 }) }),
    null
  );
  assert.equal(
    await fetchMissingIds('https://s.canvas', { fetchImpl: async () => jsonResponse({ not: 'a list' }) }),
    null
  );
  // A full page may be truncated — also unknown.
  const full = Array.from({ length: 100 }, (_, index) => ({ id: index }));
  assert.equal(await fetchMissingIds('https://s.canvas', { fetchImpl: async () => jsonResponse(full) }), null);
});

test('parseTodo hides overdue items that already have a submission', () => {
  const now = new Date('2026-10-03T12:00:00Z').getTime();
  const past = '2026-09-08T23:59:00Z';
  const future = '2026-12-01T23:59:00Z';
  const item = (id, name, due_at, extra = {}) => ({
    type: 'submitting',
    assignment: { id, name, due_at },
    html_url: `https://s.canvas/courses/10/assignments/${id}`,
    course_id: 10,
    ...extra
  });
  const payload = [
    item(1, 'Graded on paper', past), // has a submission → hide
    item(2, 'Still missing', past), // in the missing list → keep
    item(3, 'Due later', future), // not past due yet → keep
    item(4, 'Also has a submission', past),
    { ...item(4, 'Needs grading', past), type: 'grading' }, // grading items are untouched
    { // no assignment id → we cannot tell → keep
      type: 'submitting',
      discussion_topic: { id: 8, name: 'Discussion post', due_at: past },
      html_url: 'https://s.canvas/courses/10/discussion_topics/8',
      course_id: 10
    }
  ];

  const titles = options => parseTodo(payload, [], { now, ...options }).map(row => row.title);
  // Without the missing list nothing changes.
  assert.deepEqual(titles({}), [
    'Graded on paper', 'Still missing', 'Due later',
    'Also has a submission', 'Needs grading', 'Discussion post'
  ]);
  // With it, only overdue items that still lack a submission survive.
  assert.deepEqual(titles({ missing: new Set([2]) }), [
    'Still missing', 'Due later', 'Needs grading', 'Discussion post'
  ]);
  // An empty missing list means every overdue assignment has a submission.
  assert.deepEqual(titles({ missing: new Set() }), [
    'Due later', 'Needs grading', 'Discussion post'
  ]);
});

test('parseTodo matches quizzes by their assignment id when hiding graded work', () => {
  const now = new Date('2026-10-03T12:00:00Z').getTime();
  const rows = parseTodo([
    {
      type: 'submitting',
      quiz: { id: 7, assignment_id: 70, name: 'Unit quiz', due_at: '2026-09-01T23:59:00Z' },
      html_url: 'https://s.canvas/courses/10/quizzes/7',
      course_id: 10
    }
  ], [], { now, missing: new Set() });
  assert.deepEqual(rows, []);
  const stillMissing = parseTodo([
    {
      type: 'submitting',
      quiz: { id: 7, assignment_id: 70, name: 'Unit quiz', due_at: '2026-09-01T23:59:00Z' },
      html_url: 'https://s.canvas/courses/10/quizzes/7',
      course_id: 10
    }
  ], [], { now, missing: new Set([70]) });
  assert.equal(stillMissing.length, 1);
});

test('fetchGradedIds hides anything carrying a grade, one request per course', async () => {
  const requests = [];
  const fetchImpl = async url => {
    const href = String(url);
    requests.push(href);
    if (href.includes('/courses/10/')) {
      return jsonResponse([
        { assignment_id: 1, workflow_state: 'graded', grade: 'B', score: 12 },
        { assignment_id: 2, workflow_state: 'unsubmitted', grade: null, score: null },
        { assignment_id: 5, workflow_state: 'unsubmitted', grade: '0', score: 0 }
      ]);
    }
    return jsonResponse([
      { assignment_id: 3, workflow_state: 'unsubmitted', excused: true, grade: null, score: null }
    ]);
  };
  const graded = await fetchGradedIds('https://s.canvas', [
    { courseId: 10, assignmentId: 1 },
    { courseId: 10, assignmentId: 2 },
    { courseId: 10, assignmentId: 5 },
    { courseId: 20, assignmentId: 3 },
    { courseId: NaN, assignmentId: 4 }, // no course → not checkable
    { courseId: 10, assignmentId: NaN } // no assignment → not checkable
  ], { token: 't', fetchImpl });

  assert.deepEqual([...graded].sort(), [1, 3, 5]);
  // One grouped request per course, asking only about the listed items.
  assert.equal(requests.length, 2);
  const courseTen = new URL(requests.find(href => href.includes('/courses/10/')));
  assert.equal(courseTen.pathname, '/api/v1/courses/10/students/submissions');
  assert.deepEqual(courseTen.searchParams.getAll('assignment_ids[]'), ['1', '2', '5']);
  assert.ok(requests.some(href => href.includes('/courses/20/students/submissions')));
});

test('fetchGradedIds fails open when a course cannot answer', async () => {
  const fetchImpl = async url => {
    if (String(url).includes('/courses/10/')) throw new Error('down');
    return jsonResponse([{ assignment_id: 3, workflow_state: 'graded' }]);
  };
  const graded = await fetchGradedIds('https://s.canvas', [
    { courseId: 10, assignmentId: 1 },
    { courseId: 20, assignmentId: 3 }
  ], { token: 't', fetchImpl });
  // Course 10 stays unknown → its row is never hidden; course 20 is graded.
  assert.deepEqual([...graded], [3]);
});

test('fetchGradedIds asks nothing when no row is checkable', async () => {
  const graded = await fetchGradedIds('https://s.canvas', [
    { courseId: NaN, assignmentId: 1 },
    { title: 'no ids at all' }
  ], {
    token: 't',
    fetchImpl: async () => { throw new Error('must not be called'); }
  });
  assert.deepEqual([...graded], []);
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
