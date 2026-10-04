# Firestore rules

Source of truth: [`firestore.rules`](./firestore.rules). Publish via Firebase Console → Firestore → Rules
(paste the whole file) or `firebase deploy --only firestore:rules`.

| Path | Who | Notes |
| --- | --- | --- |
| `system/*` | nobody (client) | Cron state. Written only by `api/cron-rft-telegram.js` via firebase-admin (service account bypasses rules). |
| `shares/{id}` | get: anyone · create: signed-in | Public read-only share links. `list` is blocked so links can't be enumerated. |
| `workspaces/{id}` | get/write: signed-in | `list` is blocked — the workspace code is the shared secret. |
| `workspaces/{id}/plans|summaries` | signed-in | Anyone who knows the workspace code. Use long random codes. |
| `workspaces/{id}/kb/{doc}` | signed-in | Knowledge Base guides (since v4.42.0). |
| `workspaces/{id}/kb/{doc}/images/{img}` | signed-in | Screenshots as data URLs, < 1 MB each, image types only. |
| `users/{uid}/…` | owner only | Personal settings + legacy data. |

> **v4.42.0:** publish the rules again — the Knowledge Base needs the new `kb` rules, otherwise it shows a permission error.
>
> Since v4.39.0 the cron no longer needs `system/*` to be client-writable.
> If you published the old `allow read, write: if true` rule, replace it now.
