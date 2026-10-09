# Zahir ERP · Update Manager

Web app for managing the Zahir ERP update history (synced from Redmine `pjm.zahironline.com`), the Ready for Testing queue, team how-to guides, and release summaries for WhatsApp/Telegram.

![Version](https://img.shields.io/badge/version-4.61.3-blue) ![Firebase](https://img.shields.io/badge/Firebase-v10-orange) ![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)

Live: [erp-update-list.vercel.app](https://erp-update-list.vercel.app)

---

## ✨ Features

- **Update Plans & Summaries**: manage issue lists and generate ready-to-share summaries (WA / Telegram / Markdown).
- **Sync from Redmine**: pull issues by status, date range, project, and client.
- **Tester Queue (RFT)**: Ready for Testing queue by category, with Telegram alerts (in the browser and via a server-side cron).
- **Issue Status, Active Work, What Next, By Client**: track issues across the Zahir projects.
- **Create Issue**: create Redmine issues from the app.
- **Knowledge Base**: team how-to guides for Zahir ERP, ERP One, and MRP, with screenshots.
- **Team workspace**: shared data via a workspace code (Firestore realtime).
- **Public share links**: `/share/:id`, read-only for SDET.
- **PWA**: installable, with offline fallback.

The in-app **Documentation** page explains every feature for end users.

---

## 🏗️ Structure

```
erp_update_list/
├── index.html / share.html        ← pages
├── css/style.css                  ← styling
├── src/
│   ├── main.js                    ← entry point (init Firebase → startApp)
│   ├── app.js                     ← orchestrator: exposeAppGlobals() + startApp()
│   ├── config.js                  ← APP_VERSION (single source of the version)
│   ├── firebase.js · api.js · icons.js
│   ├── core/                      ← state, helpers, cloud-sync (Firestore), markdown
│   ├── ui/                        ← navigation/routing, modal, confirm, theme,
│   │                                sync-status, batch-selection, list-controls
│   ├── redmine/                   ← client (fetch/cache/error), projects + date range
│   └── features/
│       ├── plans/                 ← plans CRUD/render, issue editor, copy menu
│       ├── tester/                ← RFT queue, categories, notifications
│       └── *.js                   ← summaries, dashboard, redmine-sync, backup,
│                                    account, settings, issue-status, new-issues,
│                                    active-work, what-next, auto-refresh,
│                                    telegram-briefing, create-issue, share, pwa, issue-notes,
│                                    notes, global-search, clients, docs, kb,
                                    kb-structure
├── api/                           ← Vercel serverless functions
│   ├── _lib/auth.js               ← guard: Google sign-in + email allowlist
│   ├── _lib/firebase-admin.js     ← firebase-admin bootstrap
│   ├── redmine.js · redmine-projects.js · redmine-issue.js
│   ├── telegram.js                ← send message (chat allowlist)
│   └── cron-rft-telegram.js       ← RFT → Telegram cron
├── sw.js                          ← service worker (version stamped at build)
├── scripts/check-modules.mjs      ← import/export check between modules
├── scripts/build-static.mjs       ← build → dist/
├── firestore.rules                ← Firestore rules (see FIRESTORE_RULES.md)
└── vercel.json
```

Files in `api/_lib/` are not routes (Vercel ignores paths starting with `_`).

### Module rules (read before adding features)

1. **Functions called from HTML** (`onclick="..."`) must be registered in `exposeAppGlobals()` in `src/app.js`, because ES modules are not global.
2. **Imports are read-only.** A module's `let` variable (e.g. `currentView` in `ui/navigation.js`) can only be reassigned inside that module. If another module needs to change it, add a setter function to the owning module.
3. **Don't run top-level code that reads another module's `const`.** Modules import each other in cycles, so the value may not be ready when the file loads. Put that code inside a function.
4. Run `npm run check` after moving or adding functions. The Vercel build runs it too, so a broken import fails the deploy instead of breaking the live app.

---

## 🔐 Security model

| Layer | Rule |
| --- | --- |
| `/api/redmine*`, `/api/telegram` | Require `Authorization: Bearer <Firebase ID token>` from a **Google** account (not guest) with a verified email listed in `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`. If both are empty, everything is refused (fail-closed). |
| `/api/telegram` | The bot can only send to chats in `TELEGRAM_CHAT_ID` / `TELEGRAM_ALLOWED_CHAT_IDS`. |
| `/api/cron-rft-telegram` | `CRON_SECRET` (Bearer header; `?secret=` still works but ends up in logs). State is stored via firebase-admin. |
| `/api/cron-sites` | `CRON_SECRET`. Checks Client Versions sites with firebase-admin and posts to Telegram. |
| Firestore | `system/*` is closed to clients; `shares` and `workspaces` can't be listed; KB screenshots must be images under 1 MB. |
| CORS | No `Access-Control-Allow-Origin: *`: the API is only called same-origin. |

**Guest** mode can still use Plans/Summaries/Knowledge Base (Firestore), but Redmine and Telegram features need an allowed Google sign-in.

`REDMINE_API_KEY` belongs to a single Redmine account, so every action (including Create Issue) is recorded under that account. Consider a dedicated bot account with minimal permissions.

---

## ⚙️ Environment variables (Vercel → Settings → Environment Variables)

| Variable | Required | Used by | Notes |
| --- | --- | --- | --- |
| `REDMINE_API_KEY` | ✅ | all Redmine routes + cron | Redmine → My Account → API access key |
| `ALLOWED_EMAILS` | ✅* | API guard | Comma-separated, e.g. `you@gmail.com,teammate@gmail.com` |
| `ALLOWED_EMAIL_DOMAINS` | ✅* | API guard | Comma-separated, e.g. `company.com` |
| `TELEGRAM_BOT_TOKEN` | ✅ | telegram + cron | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | ✅ | telegram + cron | Default chat/group |
| `TELEGRAM_ALLOWED_CHAT_IDS` | – | telegram | Extra chats that may be used from the app's Settings |
| `CRON_SECRET` | ✅ | cron | Long random string (`openssl rand -hex 32`) |
| `SITES_TELEGRAM_CHAT_ID` | – | cron-sites | Chat for version / down alerts (default `TELEGRAM_CHAT_ID`) |
| `SITES_TELEGRAM` | – | cron-sites | `off` to stop those alerts |
| `SITES_CRON_STALE_HOURS` | – | cron-sites | Re-check sites older than this (default 12) |
| `SITES_CRON_BUDGET_MS` | – | cron-sites | Time per round (default 50000; the function may run 60 s) |
| `CLOUDINARY_CLOUD_NAME` | for KB images | Cloudinary → Dashboard → Cloud name |
| `CLOUDINARY_API_KEY` | for KB images | Cloudinary → Settings → API Keys |
| `CLOUDINARY_API_SECRET` | for KB images | same page; keep secret |
| `CLOUDINARY_FOLDER` | – | default `erp-update-list/kb` |
| `FIREBASE_SERVICE_ACCOUNT` | ✅ | cron (+ token verification) | Service account JSON, on one line |

\* at least one of `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`.

**Service account:** Firebase Console → Project settings → Service accounts → *Generate new private key*. Paste the whole JSON into `FIREBASE_SERVICE_ACCOUNT`. Never commit the JSON file (it is in `.gitignore`).

After changing an env var → **Redeploy**.

---

## 🚀 Firebase setup (once)

1. Authentication → Sign-in method → enable **Google** (and **Anonymous** if guest mode is still used).
2. Authentication → Settings → Authorized domains → add the Vercel domain + `localhost`.
3. Firestore → Rules → paste the contents of `firestore.rules` → **Publish**. Do this again whenever `firestore.rules` changes (most recently for the Knowledge Base in v4.42.0).

---

## 🧑‍💻 Development

```bash
npm install
npx vercel dev        # app + /api/* locally (needs env vars, see `vercel env pull`)
```

`npm run dev` (Vite) is only for UI iteration; `/api/*` routes don't run there.

Production build (used by Vercel):

```bash
npm run check         # import/export check between modules
npm run build         # check + build → dist/
```

### Releasing a new version

1. Change `APP_VERSION` in `src/config.js` (and `version` in `package.json`), and add a line to **What's New** in `index.html`.
2. The build stamps the version into `sw.js` (`CACHE_NAME`) and adds `?v=` to the CSS link, so users get the new CSS/JS without a hard refresh.
3. Recommended: work on a separate branch → check the **Vercel Preview URL** → then merge into `main`.

---

## ⏰ Cron: RFT → Telegram

`vercel.json` runs `/api/cron-rft-telegram` once a day at 02:00 UTC / 09:00 WIB (Hobby plan limit). For every 15 minutes, use [cron-job.org](https://cron-job.org) with a **custom header**:

```
GET https://erp-update-list.vercel.app/api/cron-rft-telegram
Authorization: Bearer <CRON_SECRET>
```

Manual test:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://erp-update-list.vercel.app/api/cron-rft-telegram
```

The first run only **seeds** a baseline (no spam); later runs only send new RFT IDs. If the Firestore state can't be read, the cron stops with an error instead of re-seeding or spamming.

## ⏰ Cron: Client Versions check → Telegram

`vercel.json` runs `/api/cron-sites` once a day at 20:00 UTC / 03:00 WIB. Each round checks the sites that are failing first, then those not checked for `SITES_CRON_STALE_HOURS`, for up to `SITES_CRON_BUDGET_MS`; when sites are left it starts the next round itself (max 20 rounds). One Telegram message per round lists **not reachable** sites (2 failed checks in a row, sent once), sites **back up**, and **version changes**. For down alerts during the day, call it from cron-job.org every 30–60 min with the same `Authorization: Bearer <CRON_SECRET>` header:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://erp-update-list.vercel.app/api/cron-sites
```

The answer tells how many sites were checked / left and what was sent.

---

## 🐛 Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Sign-in required" / "Not available in guest mode" | Sign in with Google in Settings. |
| "Account … is not allowed" | Add the email to `ALLOWED_EMAILS` → redeploy. |
| "Server access list not configured" | `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS` not set. |
| "Chat ID not allowed" | Match the Chat ID in the app's Settings with `TELEGRAM_CHAT_ID`, or add it to `TELEGRAM_ALLOWED_CHAT_IDS`. |
| Knowledge Base: permission error | Publish the latest `firestore.rules`. |
| Cron: "Could not read cron state" | `FIREBASE_SERVICE_ACCOUNT` missing or invalid. |
| Cron: "Unauthorized" | Secret doesn't match `CRON_SECRET` (values are hidden in Vercel; generate a new one if unsure). |
| Redmine 401/403 | `REDMINE_API_KEY` wrong/expired or lacks permission. |
| App stuck on "Syncing" | Domain missing from Firebase Authorized domains. |
| Vercel blocks a deployment | The commit author isn't linked to the Vercel account; run `git commit --amend --reset-author --no-edit` before pushing. |

---

## 📝 Changelog (short)

- **v4.61.3**: client name keeps the full cell width (wraps instead of "S…"); "N open issues" (only when > 0) and "⚠ Nd apart" moved to a small badge row under the address.
- **v4.61.2**: no "from … · ago" line under the front-end version; the last change is in the badge tooltip (history unchanged).
- **v4.61.1**: site ↔ Redmine client matching: name set in Edit = exact; else site name exact, then the single Redmine client whose normalized name contains it (or vice versa, ≥5 chars); test servers only via Edit. By Client shows a dashed hint when the open client has no linked site.
- **v4.61.0**: Server-side Client Versions check `api/cron-sites.js` (Vercel Cron daily + optional external scheduler): all workspaces via `collectionGroup('sites')`, failing sites first then stale ones, same fields as the app (`buildPatch`), `failCount` / `downSince` / `downNotifiedAt`, `checkedBy: 'server'`; Telegram message with not-reachable (after 2 failures, once), back-up and version changes; self-continues in rounds. App: "● down since …" status, **Down** filter, "(server)" marker. Client Versions ↔ By Client: each site links to a Redmine client (Edit → "Redmine client name", default = same name ignoring PT/CV/case); rows show "N open issues" (opens By Client), details show the link, CSV has the columns; By Client shows the client's FE / V2 / V3 above its issues.
- **v4.60.3**: details read "API V2: 2.26.10.061632 | Released 6 Oct 2026".
- **v4.60.2**: API V2 / V3 answers: `release_date` is returned as `backend.vN.releaseDate` and stored as `v2Release` / `v3Release` (read from the stored raw answer for older checks); details show "version · released 6 Oct 2026" instead of the raw JSON, Compare and the badge tooltip show the release date too.
- **v4.60.1**: Client Versions lists `isTest` sites in their own block on top ("Test servers · reference for the tester version", by name), independent of sort and version filters (search still applies); clients follow under "Clients".
- **v4.60.0**: Client Versions **Compare** panel (`#sitesCompare`, outside the list so background redraws don't close an open picker): 2–4 sites, first = reference; per part the version, build date and "N h / N days older|newer" (from the build stamps), a one-line verdict per site, Copy as text, "Check these now", "Set as reference". Defaults to the first test server + a site on the most common front-end version (≈ production); selection kept in `localStorage` (`erp_sites_compare_v1`). Also reachable from a client's details.
- **v4.59.3**: Client Versions rows are clickable as a whole (`siteRowClick`): only the name text was a button, so clicks next to it (on the empty part of the name cell) did nothing. Links, action buttons and the details box keep their own behaviour; Enter on the focused name still toggles.
- **v4.59.2**: Client Versions redraw no longer depends on `requestAnimationFrame` alone (the browser pauses it when the window is covered, during screen sharing / picture-in-picture, or in a background tab, so clicks changed state but the list never redrew). User actions (name click, filters, sort, search) now call `renderNow()` directly; background updates are batched with rAF backed by a 120 ms timer; the pointer hold auto-expires after 1.5 s.
- **v4.59.1**: Client Versions holds table redraws while a pointer button is pressed inside the list (released on pointerup, after the click handler), so clicks on names / ↻ / edit are no longer lost while checks keep redrawing the rows.
- **v4.59.0**: Client Versions — (1) every real change of FE / V2 / V3 found by a check is appended to the site's `history` (`{at, part, from, to}`, last 50); "Recent changes" panel (30 days) and per-client history in the details; (2) changes are collected for 4 s and announced once: toast, plus Telegram via `/api/telegram` when *Settings → Notify Telegram when a client's Zahir ERP version changes* is on (per browser, uses the saved Chat ID); (3) rollout cards: latest version per part and % of clients on it; (4) "Parts out of step" when the build stamps (`major.yy.mm.ddhhmm`, V3 `yy.mm.ddhhmm`) of a site's parts are more than 14 days apart; (5) `isTest` flag (Edit → Test / internal server) keeps dev sites out of Latest / rollout / Behind latest, newer builds there show blue. CSV gains "Parts out of step", "Test server", "Last change".
- **v4.58.2**: Client Versions filter bar: Latest FE / Latest V2 / Latest V3 chips (highest value of each part + client count, filterable); Behind latest and the sidebar count now mean behind on any of front-end, API V2 or API V3.
- **v4.58.1**: Client Versions table: Front-end, API V2 and API V3 get equal widths, version badges never truncate, the table scrolls sideways below ~860px of width instead of squeezing.
- **v4.58.0**: Client Versions reads backend versions too: `api/erp-version.js` fetches `<origin>/api/v2/versions/dev` and `<origin>/api/v3/version` in parallel with the front-end scan (also when the login page fails) and returns `backend: { v2: {version, raw, error}, v3: … }`. The body may be JSON (version-like key, nested, or `{major,minor,patch}`) or plain text; an HTML answer counts as "not available". Stored per site as `v2/v3`, `v2Raw/v3Raw`, `v2Error/v3Error`, `v2Prev/v3Prev` (last known value kept when a check fails). Table gets API V2 / API V3 columns (highest green, older amber), details show the raw answer, search and CSV include them.
- **v4.57.2**: Client Versions filter bar no longer has one chip per version: fixed chips All / Latest (with the version) / Behind latest / Couldn't read, and a "Specific version…" dropdown (newest first, with client counts).
- **v4.57.1**: `api/erp-version.js` explains network failures instead of Node's bare "fetch failed" (DNS, refused, reset, timeout / probably geo-blocked, TLS handshake, certificate code). Hosts whose certificate chain can't be verified (missing intermediate, self-signed, expired — common on self-hosted servers; browsers repair missing intermediates themselves) are re-read with `node:https` without chain verification, still GET-only and pinned to an address that passed the public-address check; the result carries `tlsNote`, shown in the site details.
- **v4.57.0**: Client Versions accepts any public https address, not only `*.zahirerp.com` (`ERP_VERSION_HOSTS` is gone). Guard rails in `api/erp-version.js`: default https port only, no IP literals or local names, every host incl. redirects must resolve (DNS) to public addresses only (private, loopback, link-local/metadata, CGNAT, multicast blocked), and only files on the page's own host are read. Long lists: 6 checks in parallel, at most 100 stale sites auto-checked per visit (oldest first), rendering throttled to one per frame, paste-a-list writes in batches of 400.
- **v4.56.3**: webpack chunk map parser accepts quoted keys — named chunks (`"npm.react":"14a4599…"`) use their name as id, which made the whole Zahir ERP map unreadable before. Debug output always reports `webpack chunks: N known`.
- **v4.56.2**: `api/erp-version.js` orders webpack chunks by how many `Promise.all` groups in the app code load them (the package.json chunk is a shared one, e.g. 98513 on Zahir ERP), so it is found within the first reads even when the runtime lists ~2000 chunks; per-file cap 12 MB, total 48 MB. Debug from the app's console: `fetch('/api/erp-version?debug=1&url=…', {headers:{Authorization:'Bearer '+await firebase.auth().currentUser.getIdToken()}})`.
- **v4.56.1**: Client Versions reads Zahir ERP's version format `V2.26.10.081600` (capital V, 4 parts, build stamp). Zahir ERP (Create React App / webpack 5) keeps it in its bundled `package.json` inside a lazy numeric chunk (`JSON.parse('{"UU":"zahironline","rE":"2.26.10.081600"}')`); `api/erp-version.js` now reads the webpack runtime's chunk map and scans app chunks (never `npm.*`), following `n.e(id)` references, up to 150 chunks / 10 in parallel. The chunk id found is returned as `chunkHint`, stored per site and sent back as `&hint=` so later checks open that chunk first. The Firestore listener now resubscribes after a permission error.
- **v4.56.0**: **Client Versions** menu (`src/features/sites.js`): hand-kept list of clients' Zahir ERP addresses in `workspaces/{id}/sites` (new Firestore rule — republish `firestore.rules`). The version is read from each site's public login page by `api/erp-version.js` (JSON endpoints the app calls, app-version constants in its JS bundles incl. lazy chunks, then HTML; library versions filtered out; https + `*.zahirerp.com` only, extend with `ERP_VERSION_HOSTS`). Auto-check on open when older than 6 h, version chips with latest/behind, change history, manual pin, paste-a-list, CSV export, included in backups.
- **v4.55.0**: Client Report (`src/features/client-report.js`): Report tab in a client's By Client view, grouped Not started / In progress / Done (done = last 90 days, toggle for older). Request text from the description (QA Actual/Expected when present), latest progress from Redmine journals via new `resource=journals&ids=` (≤50 ids, batched, session-cached). Issue lists accept `with_description=1`. Copy as WhatsApp/Telegram text, export CSV.
- **v4.54.0**: KB screenshots on Cloudinary. `api/cloudinary.js` signs browser uploads (secret stays server-side, same auth guard) and deletes images in the app folder; guides store `https://res.cloudinary.com/…/f_auto,q_auto/…` URLs; removed/discarded images are deleted; a banner moves old base64 `kbimg:` images (one click) and removes them from Firestore. Falls back to the old storage if Cloudinary isn't configured. Env: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, optional `CLOUDINARY_FOLDER`.
- **v4.53.0**: Backup v2: Export JSON adds Knowledge Base guides (with image subcollections) and the menu structure, plus private issue notes; Import restores them (v1 files still work). New `src/core/clipboard.js` (`writeClipboard`, `copyTextSmart`, manual-copy box) used by every copy button; removed fallbacks that reported "copied" without copying. Audit: all 13 views load correctly on reload/direct link.
- **v4.52.2**: Sidebar: By Client moved under Dashboard (Overview section).
- **v4.52.1**: By Client counts only the three Zahir products (same project list as Issue Status, name patterns as fallback); other Redmine projects are ignored in numbers, product filter, chips and badges. Product segment wraps instead of overlapping.
- **v4.52.0**: By Client overview v2: `client_names` adds per-product breakdown (`byProject`); statuses mapped to fixed columns (New, In Progress, Ready for Testing, Resolved, Other open, Open, Total, Last update) with totals cards, product segment filter, "show" filter, sortable headers; product filter also applies to a client's issue list, which gets status pills and status-ordered groups. Overview also loads on reload/direct link.
- **v4.51.1**: Update Plans *Copy for Telegram*: copies via the `copy` event inside the click (plain text + HTML with bold title and links), then the Clipboard API, then a manual-copy box; no more false "copied" toasts. Telegram plain text uses `**bold**`. Copy menu is viewport-pinned and flips above the button near the bottom of the screen.
- **v4.51.0**: By Client opens on an all-clients overview: `resource=client_names` now also returns per client open count (`closed_on`), statuses, projects and last update; the browser gets only this summary (cached 1 h). Filter/sort/open-only, click to drill into a client, back to the list; sidebar badge = clients with open issues.
- **v4.50.0**: New Issue *Paste from ChatGPT*: parses a QA-format bug report (plain, bold or `###` headings; `*`/`-`/numbered lists; chatty lead-ins ignored) into Subject, Tracker (`[Bug]`), Priority (from Priority or Severity), Client/Project Name and a Redmine-ready Markdown description, keeping pasted screenshots under their steps. Also: taller Notes textarea.
- **v4.49.1**: Generate description defaults to the team's QA bug-report format (Environment / Precondition / Steps to Reproduce / Actual / Expected / Severity-Priority / Notes / Attachment), with Module/Menu taken from the first "Buka X > Y" step, remembered Browser/OS/Env/App defaults, Severity/Priority derived from the Priority field, and a "[Tracker] …" subject prefix. Layout selector keeps the learned team layout as an option.
- **v4.49.0**: Generate description v2: `/api/redmine-issue` meta learns each tracker's section headings from the last 100 issues (`templates`); the generator fills those (or a built-in layout) from labelled notes (Langkah/Steps, Hasil/Actual, Harapan/Expected, Kebutuhan, Catatan), adds Client / Project Name / category / project, localizes fallback sections, keeps screenshots under their step, and confirms before overwriting typed text.
- **v4.48.1**: New Issue description editor modelled on the Knowledge Base (toolbar, Write/Preview). Screenshots pasted/dropped into the description are inserted at the cursor as `![](file.png)` (indented under a numbered step) and uploaded as attachments, so Redmine shows them inline. Redmine text format is guessed from recent issues (overridable); Markdown is converted to Textile when needed.
- **v4.48.0**: New Issue: Assignee from project memberships (developer roles first), Status from `issue_statuses`, an *Issue details* box (Status*, Priority*, Assignee, Category, Project Name*, Client Name) with other custom fields under *More Redmine fields*, and attachments (click / drop / paste; images over 3 MB shrunk) uploaded via `/uploads.json` tokens.
- **v4.47.2**: New Issue fixes: (1) form data loads whenever the view opens (reload/direct link left Tracker empty); (2) trackers come from the project (`/projects/{id}.json?include=trackers,...`) instead of the global list; (3) project custom fields (e.g. Client Name) are shown and sent as `custom_fields`, required ones are marked after Redmine reports them; (4) Redmine's errors and a hint per status code are shown in the form.
- **v4.47.1**: Bell red dot fixed: `.notif-bell-dot.hidden` had no CSS rule, so the dot was always visible. The dot now means "Ready for Testing issues not opened yet", which the panel lists per category with *Mark all as seen*.
- **v4.47.0**: Private notes on issues (`src/features/issue-notes.js`): a Note chip in every issue list row, optional "Information is missing" flag, "My notes" quick filter, search includes note text. Stored in `users/{uid}.issueNotes` (owner-only by the existing rules) with a localStorage copy; never sent to Redmine or copied.
- **v4.46.2**: Fix race in Issue Status lists: a slow load for one status (e.g. Rework) finishing after switching to another (Feedback) overwrote the list and its cache. Loads are now tied to their status and the newest load wins; old session caches are discarded.
- **v4.46.1**: New Issue Status menu **Resolved** (below On Deploy): issues with Redmine status Resolved, with its own sidebar count.
- **v4.46.0**: Dashboard redesign: header with date and quick actions; "Needs attention" counts strip plus a compact triage list (reason, issue, subject, project); new issues per project as bars; release paperwork KPIs; tidier recent plans (Write summary / Summary ready) and latest summary. Dashboard New counts use Redmine `total_count` (were capped at 100).
- **v4.45.2**: Knowledge Base list rows: product · Module › Submenu and client shown as a meta line under the title; right column shows only the date (fixed width, aligned).
- **v4.45.1**: Knowledge Base drops the separate "Zahir Manufacturing" product (same as Zahir MRP). Guides and menus stored under `mfg` are shown and saved as `mrp`; no data is deleted.
- **v4.45.0**: Knowledge Base **Edit menus**: the team defines modules and submenus per product (ordered), stored in `workspaces/{id}/kb/_structure` (no rules change needed). The editor's Module/Submenu are dropdowns from that list; renames update the guides that use them; in-use items can't be deleted; first use is pre-filled from existing guides.
- **v4.44.0**: Knowledge Base guides get an optional **Submenu** inside a module (Product › Module › Submenu). The library tree shows submenus under the open module (guides without one under *General*), module lists are grouped by submenu, and breadcrumbs, copy text, and search include it.
- **v4.43.4**: Knowledge Base editor: Client label shortened to "Client optional" (client count/refresh hint removed); field labels no longer wrap on small screens.
- **v4.43.3**: Redmine cache TTL 20 → 2 minutes; forced refreshes refetch every page (no more fresh/stale page mixes); status lists load up to 1,000 issues per project; lists show "Showing X of Y" with Clear filters when filters hide issues, plus the last update time.
- **v4.43.2**: `/api/redmine?resource=client_names` builds the full client list from Redmine issues (works without admin rights; up to 6,000 issues within ~8 s); the Knowledge Base Client field uses it, cached for 12 hours, with a refresh link.
- **v4.43.1**: Knowledge Base guides get an optional **Client** field (suggestions from Redmine's Client Name field), shown in the list and on the guide; clicking it opens that client's issues in By Client; search matches client names.
- **v4.43.0**: Knowledge Base redesign: product/module library tree, guides grouped in a wide list, full-width reading view with an "On this page" outline, global search, and a side-by-side editor with live preview. `#` and `##` headings both render as section headings.
- **v4.42.3**: "Important" / "Warning" callouts in Knowledge Base guides are styled as warnings again; README restored in full, in English.
- **v4.42.0–4.42.2**: **Knowledge Base** for Zahir ERP / ERP One / Manufacturing / MRP guides (screenshots, preview, search, copy text, direct links); UI fully in English.
- **v4.41.0**: In-app **Documentation** page; collapsed sidebar shows dots instead of overlapping counts.
- **v4.40.x**: Collapsible sidebar (icon rail), white sidebar text and counts, mobile drawer fix, auth-restore fix for early API calls; `src/app.js` split into feature modules with `npm run check`.
- **v4.39.x**: Security hardening: all `/api/*` require Google sign-in + email allowlist; Telegram chat allowlist; CORS `*` removed; cron state via firebase-admin with `system/*` locked; service worker cache fix; cleanup.
- **v4.38.x**: Filter By Client (Client Name custom field), sidebar theme.
- **v4.30–4.37**: Tester Queue RFT, Telegram notifications, server-side cron, Create Issue, public share links, team workspace, PWA, group-by status.
- **v4.15**: Google Sign-In. **v4.0**: Sync from Redmine. **v2.0**: Firebase. **v1.0**: LocalStorage version.

---

© Reyhan Labs: personal use.
