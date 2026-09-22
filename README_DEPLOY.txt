Zahir ERP Update Manager — v4.14.0
===================================

BARU di v4.14.0
---------------
Tester Queue dipisah per Category di sidebar:
  - Front End
  - Backend
  - Design
  - Other  (issue tanpa category / category lain)

Mapping category Redmine (case-insensitive):
  Front End  ← "Front End", "Frontend", "FE", "front-end"
  Backend    ← "Backend", "Back End", "BE", "server"
  Design     ← "Design", "UI", "UX", "UI/UX", "figma"
  Other      ← selain di atas / kosong

API Redmine sekarang mengirim field category.

CARA DEPLOY
-----------
1. Copy file ke root repo (timpa yang sama nama)
2. git add . && git commit -m "v4.14.0: tester queue by category" && git push
3. Tunggu Vercel → hard refresh (Ctrl+Shift+R)
