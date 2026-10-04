# Zahir ERP · Update Manager

Web app to manage Zahir ERP update history (sync from Redmine `pjm.zahironline.com`), Ready for Testing queues, and generate summaries for WhatsApp/Telegram.

## Features

- **Update Plans** — sync from Redmine or add manually
- **Update Summaries** — release notes for WA / Telegram
- **Tester Queue** — Ready for Testing by category (FE / BE / Design / Other)
- **Issue Status** — New, On Progress, On Deploy, Rework, Feedback
- **What Next / Active Work / By Client**
- **Create Issue** — create Redmine issues from the app
- **Knowledge Base** — team how-to guides per product
- **Public share links** — `/share/:id` read-only for SDET
- **PWA** — installable on phone

## Stack

Vanilla JS (ES modules), Firebase Auth + Firestore, Vercel (static + serverless API).

See in-app **Documentation** for full usage guides.

Version is defined in `src/config.js` (`APP_VERSION`).
