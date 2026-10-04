# Firestore rules

Source of truth: [`firestore.rules`](./firestore.rules). Publish via Firebase Console → Firestore → Rules
(paste the whole file) or `firebase deploy --only firestore:rules`.

| Path | Who | Notes |
| --- | --- | --- |
| `system/*` | nobody (client) | Cron state. Written only by `api/cron-rft-telegram.js` via firebase-admin (service account bypasses rules). |
| `shares/{id}` | get: anyone · create: signed-in | Public read-only share links. `list` is blocked so links can't be enumerated. |
| `workspaces/{id}` | get/write: signed-in | `list` is blocked — the workspace code is the shared secret. |
| `workspaces/{id}/plans|summaries` | signed-in | Anyone who knows the workspace code. Use long random codes. |
| `users/{uid}/…` | owner only | Personal settings + legacy data. |

> Since v4.39.0 the cron no longer needs `system/*` to be client-writable.
> If you published the old `allow read, write: if true` rule, replace it now.
