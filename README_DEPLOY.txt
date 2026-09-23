Zahir ERP Update Manager — v4.15.2 (stable rebuild)
====================================================

Berisi:
- v4.15.0 Google Sign-In (cross-device sync)
- v4.15.1 Colorful UI
- v4.15.2 Hardened auth (null-safe, no double sign-in race)

CARA DEPLOY AMAN
----------------
1. Backup dulu (opsional):
   git status
   git stash   # jika ada perubahan lokal yang belum commit

2. Extract zip ini, copy SEMUA file ke root repo
   (timpa index.html, js/app.js, css/style.css, api/*)

3. Cek ukuran file (penting!):
   - js/app.js harus ~100 KB (bukan 1-3 KB)
   - index.html ~48 KB

4. Commit & push:
   git add index.html js/app.js css/style.css api/redmine.js api/redmine-projects.js manifest.json sw.js
   git commit -m "v4.15.2: stable rebuild Google Sign-In + colorful UI"
   git pull --rebase origin main
   git push origin main

5. Tunggu Vercel 1-2 menit → Ctrl+Shift+R

6. Firebase Console (sekali saja):
   Authentication → Sign-in method → Enable Google
   Authorized domains → erp-update-list.vercel.app

7. Di app: Settings → Sign in with Google
