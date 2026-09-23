# Firestore Security Rules (P0)

## Deploy (one-time / after rule changes)

### Option A — Firebase Console
1. Open https://console.firebase.google.com → project **erpupdate-f0b18**
2. **Firestore Database → Rules**
3. Paste contents of `firestore.rules`
4. **Publish**

### Option B — Firebase CLI
```bash
npm i -g firebase-tools
firebase login
firebase use erpupdate-f0b18
firebase deploy --only firestore:rules
```

## What the rules do
- Only authenticated users can read/write
- Each user can only access `users/{theirUid}/plans` and `users/{theirUid}/summaries`
- No public list of other users' data

## After publish
Test: open the app, create a plan, refresh — should still work.
If permission-denied errors appear, confirm the user is signed in (Google or guest).
