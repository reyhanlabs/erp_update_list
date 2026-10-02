# Firestore rules — publish in Firebase Console

After deploy v4.34.2, publish rules so short share links work:

```
match /shares/{shareId} {
  allow read: if true;
  allow create: if request.auth != null
    && request.resource.data.keys().hasAll(['v', 'title', 'issues', 'createdAt'])
    && request.resource.data.issues is list
    && request.resource.data.issues.size() <= 500;
  allow update, delete: if false;
}
```

Full file: `firestore.rules` in this repo.
