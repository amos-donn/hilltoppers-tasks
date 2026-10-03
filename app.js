// Canvas to-do — a Hilltoppers topping. Wires the page to Canvas and to the
// extension's topping bridge; all Canvas parsing lives in canvas.js.

import {
  normalizeBaseUrl,
  normalizeToken,
  buildUrl,
  fetchJson,
  probeCanvas,
  parseTodo,
  parseCourses,
  sortTasks,
  formatDue
} from './canvas.js';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const embedded = parent !== window;
document.documentElement.classList.toggle('embedded', embedded);

// Topping bridge: the extension sends `context`, we answer `ready`. resize.js
// reports height when the extension asks for content height mode.
const channel = 'hilltoppers-topping-v1';
const session = params.get('session');
const expectedHost = params.get('host');
window.addEventListener('message', event => {
  if (!embedded || event.source !== parent || event.origin !== expectedHost) return;
  const data = event.data;
  if (!data || data.channel !== channel || data.session !== session || data.type !== 'context') return;
  parent.postMessage({ channel, session, type: 'ready' }, event.origin);
});

const SETTINGS_KEY = 'hilltoppers-tasks:settings:v1';
const REFRESH_INTERVAL = 5 * 60_000;
// Current Canvas documents /users/self/todo (it answers 401 without a token);
// /todo_items 404s there but older school installs may still use it, so try both.
const TODO_PATHS = ['/api/v1/users/self/todo', '/api/v1/users/self/todo_items'];

let settings = readSettings();
let tasks = [];
let notice = '';
let loadedAt = 0;
let loading = false;
let setupOpen = false;
let generation = 0;
let controller = null;

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      canvas: typeof parsed.canvas === 'string' ? parsed.canvas : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      relay: typeof parsed.relay === 'string' ? parsed.relay : ''
    };
  } catch {
    // Storage can be unavailable inside an embedded topping; settings then
    // live only for this page view.
    return { canvas: '', token: '', relay: '' };
  }
}

function writeSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

const configured = () => Boolean(settings.canvas && settings.token);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function render() {
  const isConfigured = configured();
  $('#panel').hidden = !isConfigured;
  $('#setup').hidden = isConfigured && !setupOpen;
  $('#setup-cancel').hidden = !isConfigured;
  $('#forget').hidden = !isConfigured;

  const noticeNode = $('#notice');
  noticeNode.hidden = !notice || !isConfigured;
  noticeNode.textContent = notice;

  const list = $('#tasks');
  list.replaceChildren();
  const empty = $('#empty');

  if (isConfigured && tasks.length) {
    const now = new Date();
    for (const task of tasks) {
      const due = formatDue(task.dueAt, now);
      const row = el('li', 'task');
      row.dataset.state = due.state;
      const link = el('a', '');
      if (task.url) {
        link.href = task.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      const dueLine = el('span', 'task-due', due.label);
      if (task.kind) dueLine.append(el('span', 'chip', task.kind));
      link.append(dueLine, el('span', 'task-title', task.title));
      if (task.course) link.append(el('span', 'task-course', task.course));
      row.append(link);
      list.append(row);
    }
  }
  empty.hidden = !(isConfigured && !notice && loadedAt && !tasks.length);

  $('#count').hidden = !tasks.length;
  $('#count').textContent = String(tasks.length);
  $('#updated').textContent = loadedAt ? updatedLabel() : '';
  $('#refresh').disabled = loading;
  $('#refresh').classList.toggle('spinning', loading);
}

function updatedLabel() {
  const seconds = Math.round((Date.now() - loadedAt) / 1000);
  if (seconds < 45) return 'Updated just now';
  if (seconds < 3600) return `Updated ${Math.round(seconds / 60)} min ago`;
  return `Updated ${new Date(loadedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function explain(error) {
  if (error && error.plain) return error.message;
  const status = error && error.status;
  // The body says who refused and why: token, rate limit, a firewall page.
  const suffix = error && error.detail ? ` Canvas says: “${error.detail}”.` : '';
  if (status === 401) {
    return `Canvas said 401: it did not accept the access token. Tokens can expire — make a fresh one in Canvas → Account → Settings → Access Tokens and paste only the token itself.${suffix}`;
  }
  if (status === 403) {
    return `Canvas said 403: this request was refused.${suffix}`;
  }
  if (status === 400) {
    return `The relay said 400. Check that the relay address is the one from your own deploy.${suffix}`;
  }
  if (status === 404) {
    return `Canvas said 404: no to-do endpoint answered there. Check the Canvas site address in Settings.${suffix}`;
  }
  if (status === 502) {
    return `The relay could not reach that Canvas address. Check the Canvas site address in Settings.${suffix}`;
  }
  if (status >= 500) {
    return `Canvas had a problem on its side (HTTP ${status}). Try again in a moment.${suffix}`;
  }
  if (error && error.name === 'AbortError') return 'Canvas took too long to answer. Try again.';
  if (!settings.relay) {
    return 'Canvas blocks calls made straight from websites, so the relay is needed. Deploy it once (README, step 2) and paste its address in Settings.';
  }
  return 'Could not reach Canvas. Check your connection and the relay address, then try again.';
}

function plain(message) {
  const error = new Error(message);
  error.plain = true;
  return error;
}

async function refresh() {
  if (!configured()) return;
  const base = normalizeBaseUrl(settings.canvas);
  if (!base) {
    notice = 'Enter a Canvas address like https://school.instructure.com in Settings.';
    render();
    return;
  }
  const relay = settings.relay ? normalizeBaseUrl(settings.relay) : '';
  if (settings.relay && !relay) {
    notice = 'The relay address does not look like a web address. Check it in Settings.';
    render();
    return;
  }

  const id = ++generation;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const timeout = setTimeout(() => controller.abort(), 20_000);
  loading = true;
  render();

  try {
    const courses = await fetchJson(
      buildUrl(base, '/api/v1/users/self/courses', { per_page: '100' }),
      { token: settings.token, relay, signal }
    ).catch(() => []);
    if (id !== generation) return;
    let payload = null;
    let lastError = null;
    for (const path of TODO_PATHS) {
      try {
        const data = await fetchJson(buildUrl(base, path, { per_page: '50' }), {
          token: settings.token,
          relay,
          signal
        });
        if (Array.isArray(data)) {
          payload = data;
          break;
        }
        lastError = plain('Canvas did not return a to-do list — double-check the Canvas site address in Settings.');
      } catch (error) {
        // Only a missing endpoint is worth trying on the next path; a 403
        // fails identically everywhere, so stop and let the probe below
        // explain it. Token failures fail the same way on every path.
        if (error && (error.status === 404 || error.status === 403)) {
          lastError = error;
          if (error.status === 403) break;
          continue;
        }
        throw error;
      }
    }
    if (id !== generation) return;
    if (!payload) {
      // Every to-do path failed with an HTML error page. A real Canvas never
      // does that (it answers 401 + JSON without a token), so ask the host
      // what it actually is.
      if (lastError && (lastError.status === 404 || lastError.status === 403) && relay) {
        const verdict = await probeCanvas(base, { relay, signal });
        if (id !== generation) return;
        if (verdict === 'not-canvas') {
          throw plain('That address does not answer like a Canvas site. In Settings, paste the address you actually log into Canvas with — usually https://school.instructure.com — with nothing after the domain (no /courses/…). If your school hosts Canvas under a path like school.edu/canvas, keep that path.');
        }
        if (verdict === 'blocked') {
          throw plain('A firewall in front of that Canvas refused this request (403) — usually a CDN or security layer blocking non-browser traffic. Reload and try again; if it still fails, ask whoever administers your school Canvas to allow API requests.');
        }
      }
      throw lastError || plain('Canvas did not return a to-do list.');
    }
    tasks = sortTasks(parseTodo(payload, parseCourses(courses)));
    notice = '';
    loadedAt = Date.now();
  } catch (error) {
    // A newer refresh already took over; it owns the screen.
    if (id !== generation) return;
    notice = explain(error);
  } finally {
    clearTimeout(timeout);
    if (id === generation) {
      loading = false;
      render();
    }
  }
}

function openSetup() {
  setupOpen = true;
  $('#canvas-url').value = settings.canvas;
  $('#token').value = settings.token;
  $('#relay').value = settings.relay;
  $('#form-error').hidden = true;
  render();
}

$('#refresh').addEventListener('click', () => void refresh());
$('#settings-btn').addEventListener('click', openSetup);
$('#setup-cancel').addEventListener('click', () => {
  setupOpen = false;
  render();
});

$('#forget').addEventListener('click', () => {
  settings = { canvas: '', token: '', relay: '' };
  tasks = [];
  loadedAt = 0;
  notice = '';
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    /* Nothing to clear if storage is unavailable. */
  }
  setupOpen = false;
  openSetup();
});

$('#setup-form').addEventListener('submit', event => {
  event.preventDefault();
  const errorNode = $('#form-error');
  const canvas = normalizeBaseUrl($('#canvas-url').value);
  if (!canvas) {
    errorNode.textContent = 'Enter a Canvas address like https://school.instructure.com';
    errorNode.hidden = false;
    return;
  }
  const token = normalizeToken($('#token').value);
  if (!token) {
    errorNode.textContent = 'Paste the access token from Canvas.';
    errorNode.hidden = false;
    return;
  }
  const rawRelay = $('#relay').value.trim();
  const relay = rawRelay ? normalizeBaseUrl(rawRelay) : '';
  if (rawRelay && !relay) {
    errorNode.textContent = 'The relay address must be a full https address.';
    errorNode.hidden = false;
    return;
  }
  settings = { canvas, token, relay };
  const kept = writeSettings();
  setupOpen = false;
  notice = kept ? '' : 'This browser will not keep your settings after the page closes.';
  tasks = [];
  loadedAt = 0;
  render();
  void refresh();
});

if (configured()) {
  render();
  void refresh();
} else {
  setupOpen = true;
  render();
}

// Keep the list live: refresh every five minutes while visible, and shortly
// after coming back to a tab that has gone stale.
setInterval(() => {
  $('#updated').textContent = loadedAt ? updatedLabel() : '';
  if (configured() && document.visibilityState === 'visible' && Date.now() - loadedAt > REFRESH_INTERVAL) {
    void refresh();
  }
}, 30_000);

document.addEventListener('visibilitychange', () => {
  if (configured() && document.visibilityState === 'visible' && Date.now() - loadedAt > 60_000) {
    void refresh();
  }
});
