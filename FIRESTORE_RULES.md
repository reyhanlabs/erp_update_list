# Firestore Security Rules

## Deploy
Firebase Console → Firestore → Rules → paste `firestore.rules` → Publish

Or: `firebase deploy --only firestore:rules`

## Paths
- `users/{uid}` — profile + `workspaceId`
- `users/{uid}/plans|summaries` — legacy (migration only)
- `workspaces/{workspaceId}/plans|summaries` — **team data (v4.19+)**

Signed-in users can read/write any workspace they know the ID for (share code model).

## System collection (cron state)

Deploy these rules so server-side RFT Telegram cron can save its baseline:

```
match /system/{document} {
  allow read, write: if true;
}
```

Document used: `system/rftTelegramState` (notified issue ids).
