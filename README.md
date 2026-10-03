# Canvas to-do · a Hilltoppers topping

Your live Canvas to-do list — the assignments and quizzes Canvas says you need
to submit — in one quiet list. It works as a plain webpage and as a **Topping**
inside the Hilltoppers Chrome extension (the modules you add from the Topping
Bar).

Live site: https://amos-donn.github.io/hilltoppers-tasks/

## How it works

```
  your browser ──► GitHub Pages (this site: index.html, app.js, canvas.js)
       │
       ├── Canvas access token (yours, typed into Settings once)
       │
       └──► relay Worker (this repo, relay/) ──► your Canvas /api/v1/ URLs
```

Canvas sends no CORS headers, so a browser cannot read Canvas API responses
directly — the request is blocked before any data comes back. The relay is a
tiny Cloudflare Worker that forwards your GET to Canvas and hands the JSON back
with the missing CORS headers. It stores nothing, forwards only `GET`/`HEAD` to
`https://…/api/v1/…` paths, passes through only your `Authorization` header
(no cookies), and never logs your token.

## Setup

### 1. GitHub Pages (already on for this repo)

The site is served from the `main` branch at the root. If it ever gets turned
off: **Settings → Pages → Source: Deploy from a branch → `main` / root**.

### 2. Deploy the relay (once)

Needs a free [Cloudflare](https://dash.cloudflare.com) account.

```sh
cd relay
npm install
npx wrangler login
npm run deploy
```

Wrangler prints an address like
`https://hilltoppers-tasks-relay.<your-account>.workers.dev`. Copy it — you
will paste it into the page in step 4.

### 3. Make a Canvas access token (once per token)

1. Sign in to Canvas.
2. **Account (top-left) → Settings → Access Tokens → + New Token**.
3. Give it a name (e.g. "Hilltoppers to-do"), set an expiry you are comfortable
   with, create it, and copy the value **now** — Canvas only shows it once.

### 4. Connect the page

Open the [live site](https://amos-donn.github.io/hilltoppers-tasks/), fill in:

- **Canvas site** — your school's Canvas address, e.g. `https://school.instructure.com`
- **Access token** — from step 3
- **Relay address** — from step 2

Press **Save & load**. Settings stay in this browser only (localStorage); they
are never written into the repository.

## Using it as a Hilltoppers topping

Open the extension popup → **Topping Bar** → publish or preview with this
site's URL. Suggested listing values: icon **checklist**, height mode
**Fit content** (the page includes `resize.js` and wraps everything in
`[data-topping-content]`, so it sizes to its content inside the popup).

Each person who adds the topping enters their own Canvas address, token and
relay in the topping's Settings — one deploy serves everyone.

## Layout

| File | What it is |
|---|---|
| `index.html`, `style.css` | The page and its quiet, compact styling (built for the popup's ~318px iframe and for full-width in a tab) |
| `canvas.js` | Pure Canvas logic: URL building, fetching, parsing `/users/self/todo_items`, sorting, due-date wording |
| `app.js` | Page wiring: settings, refresh cycle, rendering, the extension's topping bridge |
| `resize.js` | Copied verbatim from `toppings/shared/resize.js` in the Hilltoppers repo; reports content height to the extension |
| `relay/` | The Cloudflare Worker CORS relay plus its tests |

## Development

```sh
npm test        # node --test: canvas.js + relay suites
npm run serve   # http://localhost:4173
cd relay && npm test
```

There is no build step: the site is plain HTML/CSS/ES modules, which is what
GitHub Pages serves.

## Privacy

- Your token is stored in this browser and sent only to your Canvas site and
  to the relay you deployed.
- The relay keeps no state, sets no cookies, and accepts only GET/HEAD to
  Canvas `/api/v1/` paths.
- The list you see comes straight from Canvas's own to-do endpoint
  (`/api/v1/users/self/todo`, with `/todo_items` as a fallback for older
  Canvas installs); nothing is cached on a server.
