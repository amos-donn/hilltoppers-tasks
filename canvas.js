// Canvas helpers. No DOM access here, so Node can unit test this file directly.

// Canvas reports todo items with a type; only some of them need a visible chip.
const KIND_BY_TYPE = {
  grading: 'Grade',
  context_link: 'Link'
};

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
  // The Canvas address is an origin: paste a link copied from a course page
  // and only the site survives.
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '');
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

// Turns the /users/self/todo_items payload into flat display rows.
export function parseTodo(payload, courses) {
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
    const key = `${url ?? ''}|${title}|${dueAt ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      title,
      url,
      dueAt,
      kind: kindFor(entry, resource),
      course: Number.isFinite(courseId) ? names.get(courseId) ?? null : null
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
