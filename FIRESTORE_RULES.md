# Firestore Security Rules

## Deploy
Firebase Console → Firestore → Rules → paste `firestore.rules` → Publish

Or: `firebase deploy --only firestore:rules`

## Paths
- `users/{uid}` — profile + `workspaceId`
- `users/{uid}/plans|summaries` — legacy (migration only)
- `workspaces/{workspaceId}/plans|summaries` — **team data (v4.19+)**

Signed-in users can read/write any workspace they know the ID for (share code model).
