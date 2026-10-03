// Canvas helpers. No DOM access here, so Node can unit test this file directly.

// Canvas reports todo items with a type; only some of them need a visible chip.
const KIND_BY_TYPE = {
  grading: 'Grade',
  context_link: 'Link'
};

// Deep links people paste from the address bar (/courses/…, /login, …) must
// be stripped to the site, but a subpath install (school.edu/canvas) must
// survive: the API lives under it.
const CANVAS_APP_SEGMENTS = new Set([
  'account', 'accounts', 'admin', 'analytics', 'api', 'assignments', 'auth',
  'calendar', 'conversations', 'course', 'courses', 'dashboard',
  'discussion_topics', 'files', 'gradebook', 'groups', 'inbox', 'login',
  'modules', 'pages', 'profile', 'quizzes', 'settings', 'users'
]);

export function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let value = raw.trim();
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return null;
  } else {
    value = `https://${value}`;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const keepPath = segments.length && !CANVAS_APP_SEGMENTS.has(segments[0].toLowerCase())
    ? `/${segments.join('/')}`
    : '';
  return `${url.origin}${keepPath}`.replace(/\/+$/, '');
}

export function buildUrl(base, path, params = {}) {
  const url = new URL(`${base.replace(/\/+$/, '')}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.href;
}

// Without a relay the browser talks to Canvas directly, which Canvas only
// allows when its admin enabled CORS. With a relay the target rides in ?url=.
export function endpointFor(target, relay) {
  if (!relay) return target;
  return `${relay.replace(/\/+$/, '')}?url=${encodeURIComponent(target)}`;
}

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

// Ask the host what it is, with no token: a real Canvas answers
// /users/self/profile with 401 + JSON, while a non-Canvas host answers 404
// (or some page) in HTML, and a 403 HTML means a firewall in front of Canvas
// is refusing us. Only meaningful through a relay — without one the browser
// cannot read a cross-origin response at all.
export async function probeCanvas(base, { relay, signal, fetchImpl = fetch } = {}) {
  const target = buildUrl(base, '/api/v1/users/self/profile', {});
  try {
    const response = await fetchImpl(endpointFor(target, relay), {
      headers: { Accept: 'application/json' },
      signal
    });
    const type = response.headers.get('Content-Type') || '';
    if (!/json/i.test(type)) {
      if (response.status === 404) return 'not-canvas';
      if (response.status === 403) return 'blocked';
      return 'unknown';
    }
    return 'canvas';
  } catch {
    return 'unknown';
  }
}

// People paste "Bearer …", quoted values, or a token that wrapped across
// lines; Canvas wants one clean token string.
export function normalizeToken(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/^bearer\s+/i, '');
  return value.replace(/\s+/g, '');
}

// Canvas (or a firewall in front of it) usually explains itself in the
// response body; without this, a 403 could be a token problem, a rate limit or
// a Cloudflare block and look identical.
async function errorDetail(response) {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return '';
  }
  if (!text.trim()) return '';
  const head = text.slice(0, 600);
  if (/rate limit/i.test(head)) return 'rate limit — wait a minute and try again';
  if (/^\s*<|<!doctype/i.test(head)) {
    if (/just a moment|attention required|cf-/i.test(head)) {
      return 'a firewall page (Cloudflare), not Canvas — your school may be blocking these requests';
    }
    return 'an HTML page, not Canvas data';
  }
  try {
    const parsed = JSON.parse(text);
    const messages = Array.isArray(parsed?.errors)
      ? parsed.errors.map(entry => entry?.message).filter(message => typeof message === 'string' && message.trim())
      : [];
    const message = messages.join('; ') || (typeof parsed?.error === 'string' ? parsed.error : '');
    if (message.trim()) return message.trim().slice(0, 200);
  } catch {
    /* fall through to the raw text below */
  }
  return head.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export async function fetchJson(target, { token, relay, signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(endpointFor(target, relay), {
    headers: authHeaders(token),
    signal,
    redirect: 'follow'
  });
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    error.detail = await errorDetail(response);
    throw error;
  }
  try {
    return await response.json();
  } catch {
    const error = new Error('Response was not JSON');
    error.status = response.status;
    throw error;
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function toTime(value) {
  if (typeof value !== 'string' || !value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function resourceFor(item) {
  for (const key of ['assignment', 'quiz', 'discussion_topic', 'wiki_page', 'conversation']) {
    const value = item[key];
    if (value && typeof value === 'object') return value;
  }
  return item;
}

function kindFor(item, resource) {
  if (item.quiz) return 'Quiz';
  if (item.discussion_topic) return 'Discussion';
  if (item.type === 'grading' && Number.isFinite(item.needs_grading_count)) {
    return `Grade · ${item.needs_grading_count}`;
  }
  return KIND_BY_TYPE[item.type] ?? null;
}

// The to-do payload never says whether an item was already handed in, so ask
// Canvas which past-due assignments still have NO submission at all. An
// overdue item that is *not* on this list has a submission — handed in on
// paper and graded, turned in online, or excused — and must not show as
// overdue. Returns a Set of assignment ids, or null when we cannot tell
// (request failed, or a full page that might be cut off): callers then fail
// open and show the list exactly as Canvas gave it.
export async function fetchMissingIds(base, { token, relay, signal, fetchImpl = fetch } = {}) {
  const target = buildUrl(base, '/api/v1/users/self/missing_submissions', { per_page: 100 });
  let payload;
  try {
    payload = await fetchJson(target, { token, relay, signal, fetchImpl });
  } catch {
    return null;
  }
  if (!Array.isArray(payload)) return null;
  const ids = new Set();
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const id = Number(entry.id);
    if (Number.isFinite(id)) ids.add(id);
  }
  // A completely full page may have been cut off; hiding items off an
  // incomplete list would erase real work, so treat it as unknown too.
  return ids.size >= 100 ? null : ids;
}

// A grade ends the story: the to-do payload never carries one, so ask Canvas
// for the calling user's submissions for exactly the assignments still on
// the list — one request per course. Returns the set of assignment ids that
// carry a grade: graded state, excused, or any recorded score/grade — paper
// homework the teacher has graded counts even when Canvas still calls the
// submission unsubmitted and overdue. A course that fails to answer simply
// contributes nothing: its rows stay visible.
export async function fetchGradedIds(base, rows, { token, relay, signal, fetchImpl = fetch } = {}) {
  const byCourse = new Map();
  for (const row of rows) {
    if (!Number.isFinite(row?.courseId) || !Number.isFinite(row?.assignmentId)) continue;
    if (!byCourse.has(row.courseId)) byCourse.set(row.courseId, new Set());
    byCourse.get(row.courseId).add(row.assignmentId);
  }
  const graded = new Set();
  for (const [courseId, ids] of byCourse) {
    const url = new URL(buildUrl(base, `/api/v1/courses/${courseId}/students/submissions`, { per_page: 100 }));
    for (const id of ids) url.searchParams.append('assignment_ids[]', String(id));
    let payload;
    try {
      payload = await fetchJson(url.href, { token, relay, signal, fetchImpl });
    } catch {
      continue;
    }
    if (!Array.isArray(payload)) continue;
    for (const submission of payload) {
      if (!submission || typeof submission !== 'object' || !hasGrade(submission)) continue;
      const id = Number(submission.assignment_id);
      if (Number.isFinite(id)) graded.add(id);
    }
  }
  return graded;
}

function hasGrade(submission) {
  if (submission.excused === true) return true;
  if (submission.workflow_state === 'graded') return true;
  if (typeof submission.grade === 'string' && submission.grade.trim() !== '') return true;
  return submission.score != null;
}

// Turns the /users/self/todo_items payload into flat display rows.
// `missing` is the Set from fetchMissingIds: overdue "submitting" items
// outside it already have a submission and are dropped.
export function parseTodo(payload, courses, { missing = null, now = Date.now() } = {}) {
  if (!Array.isArray(payload)) return [];
  const names = courses instanceof Map ? courses : parseCourses(courses);
  const seen = new Set();
  const rows = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const resource = resourceFor(entry);
    const title = firstString(resource.name, resource.title) || firstString(entry.title) || 'To-do item';
    const url = safeUrl(entry.html_url) || safeUrl(resource.html_url);
    const dueAt = toTime(entry.due_at) ?? toTime(resource.due_at) ?? toTime(resource.post_at);
    const courseId = Number(entry.course_id ?? resource.course_id ?? NaN);
    // Past due and absent from the missing list means a submission exists
    // (graded paper homework, submitted work, excused) — hide it. Only
    // "submitting" items with a known assignment id qualify; future-due
    // items are never on the missing list, so they are left alone.
    const assignmentId = Number(entry.assignment?.id ?? entry.quiz?.assignment_id ?? NaN);
    if (
      missing instanceof Set &&
      entry.type === 'submitting' &&
      dueAt != null &&
      dueAt < now &&
      Number.isFinite(assignmentId) &&
      !missing.has(assignmentId)
    ) {
      continue;
    }
    const key = `${url ?? ''}|${title}|${dueAt ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      title,
      url,
      dueAt,
      kind: kindFor(entry, resource),
      course: Number.isFinite(courseId) ? names.get(courseId) ?? null : null,
      // Kept on the row so callers can ask Canvas about this exact item
      // (submission state, grades) without re-parsing the payload.
      courseId: Number.isFinite(courseId) ? courseId : NaN,
      assignmentId
    });
  }
  return rows;
}

export function parseCourses(payload) {
  const map = new Map();
  if (!Array.isArray(payload)) return map;
  for (const course of payload) {
    if (!course || typeof course !== 'object' || course.id == null) continue;
    const name = firstString(course.nickname, course.name);
    if (name) map.set(Number(course.id), name);
  }
  return map;
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const dueA = a.dueAt ?? Number.POSITIVE_INFINITY;
    const dueB = b.dueAt ?? Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    return a.title.localeCompare(b.title);
  });
}

const DAY_MS = 86_400_000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatDue(dueAt, now = new Date()) {
  if (dueAt == null) return { label: 'No due date', state: 'none' };
  const date = new Date(dueAt);
  if (!Number.isFinite(date.getTime())) return { label: 'No due date', state: 'none' };
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayShift = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  const sameDay = (a, b) => startOfDay(a) === startOfDay(b);
  if (date.getTime() < now.getTime()) {
    if (sameDay(date, now)) return { label: `Overdue · ${time}`, state: 'overdue' };
    return {
      label: `Overdue · ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
      state: 'overdue'
    };
  }
  if (dayShift === 0) return { label: `Today · ${time}`, state: 'today' };
  if (dayShift === 1) return { label: `Tomorrow · ${time}`, state: 'soon' };
  if (dayShift < 7) return { label: `${date.toLocaleDateString([], { weekday: 'short' })} · ${time}`, state: 'soon' };
  return {
    label: `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`,
    state: 'later'
  };
}
