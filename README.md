# Zahir ERP · Update Manager

Web app for managing the Zahir ERP update history (synced from Redmine `pjm.zahironline.com`), the Ready for Testing queue, team how-to guides, and release summaries for WhatsApp/Telegram.

![Version](https://img.shields.io/badge/version-4.54.0-blue) ![Firebase](https://img.shields.io/badge/Firebase-v10-orange) ![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)

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
