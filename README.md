# Zahir ERP · Update Manager

Aplikasi web untuk mengelola history update Zahir ERP (sync dari Redmine `pjm.zahironline.com`), antrean Ready for Testing, dan generate ringkasan untuk dibagikan ke WhatsApp/Telegram.

![Version](https://img.shields.io/badge/version-4.40.2-blue) ![Firebase](https://img.shields.io/badge/Firebase-v10-orange) ![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)

Live: [erp-update-list.vercel.app](https://erp-update-list.vercel.app)

---

## ✨ Fitur utama

- **Update Plans & Summaries** — kelola daftar issue, generate ringkasan siap share (WA/Telegram/Markdown).
- **Sync from Redmine** — tarik issue berdasarkan status, tanggal, project, client.
- **Tester Queue (RFT)** — antrean Ready for Testing + notifikasi Telegram (di browser dan via cron server-side).
- **Create Issue** — buat issue Redmine langsung dari app.
- **Workspace tim** — data dibagi via kode workspace (Firestore realtime).
- **Share link publik** — `/share/:id` read-only untuk SDET.
- **PWA** — installable, offline fallback.

---

## 🏗️ Struktur

```
erp_update_list/
├── index.html / share.html        ← halaman
├── css/style.css                  ← styling
├── src/
│   ├── main.js                    ← entry point (init Firebase → startApp)
│   ├── app.js                     ← orchestrator: exposeAppGlobals() + startApp()
│   ├── config.js                  ← APP_VERSION (satu-satunya sumber versi)
│   ├── firebase.js · api.js · icons.js
│   ├── core/                      ← state, helpers, cloud-sync (Firestore)
│   ├── ui/                        ← navigation/routing, modal, confirm, theme,
│   │                                sync-status, batch-selection, list-controls
│   ├── redmine/                   ← client (fetch/cache/error), projects + date range
│   └── features/
│       ├── plans/                 ← plans CRUD/render, issue editor, copy menu
│       ├── tester/                ← RFT queue, categories, notifications
│       └── *.js                   ← summaries, dashboard, redmine-sync, backup,
│                                    account, settings, issue-status, new-issues,
│                                    active-work, what-next, auto-refresh,
│                                    telegram-briefing, create-issue, share, pwa,
│                                    notes, global-search, clients
├── api/                           ← Vercel serverless functions
│   ├── _lib/auth.js               ← guard: Google sign-in + allowlist email
│   ├── _lib/firebase-admin.js     ← firebase-admin bootstrap
│   ├── redmine.js · redmine-projects.js · redmine-issue.js
│   ├── telegram.js                ← kirim pesan (chat allowlist)
│   └── cron-rft-telegram.js       ← cron RFT → Telegram
├── sw.js                          ← service worker (versi di-stamp saat build)
├── scripts/check-modules.mjs      ← cek import/export antar modul sebelum build
├── scripts/build-static.mjs       ← build → dist/
├── firestore.rules                ← rules Firestore (lihat FIRESTORE_RULES.md)
└── vercel.json
```

File di `api/_lib/` tidak menjadi route (Vercel mengabaikan path berawalan `_`).

### Aturan modul (penting saat menambah fitur)

1. **Fungsi yang dipanggil dari HTML** (`onclick="..."`) harus didaftarkan di `exposeAppGlobals()` dalam `src/app.js`, karena ES module tidak otomatis global.
2. **Import bersifat read-only.** Variabel `let` milik sebuah modul (mis. `currentView` di `ui/navigation.js`) hanya boleh diubah di modul itu sendiri. Kalau modul lain perlu mengubahnya, buat fungsi setter di modul pemiliknya.
3. **Jangan jalankan kode di level atas modul yang memakai `const` dari modul lain** — modul saling import (siklik), jadi nilainya bisa belum siap saat file dimuat. Taruh di dalam fungsi.
4. Jalankan `npm run check` setelah memindah/menambah fungsi. Build Vercel juga menjalankannya, jadi import yang salah akan menggagalkan deploy, bukan merusak app yang live.

---

## 🔐 Model keamanan

| Lapisan | Aturan |
| --- | --- |
| `/api/redmine*`, `/api/telegram` | Wajib header `Authorization: Bearer <Firebase ID token>` dari akun **Google** (bukan guest) dengan email terverifikasi yang ada di `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`. Kalau keduanya kosong → semua ditolak (fail-closed). |
| `/api/telegram` | Bot hanya boleh kirim ke chat di `TELEGRAM_CHAT_ID` / `TELEGRAM_ALLOWED_CHAT_IDS`. |
| `/api/cron-rft-telegram` | `CRON_SECRET` (header Bearer; `?secret=` masih didukung tapi sebaiknya hindari karena masuk log). State disimpan via firebase-admin. |
| Firestore | `system/*` tertutup untuk client; `shares` & `workspaces` tidak bisa di-list. |
| CORS | Tidak ada `Access-Control-Allow-Origin: *` — API hanya dipanggil same-origin. |

Mode **guest** tetap bisa memakai Plans/Summaries (Firestore), tapi fitur Redmine & Telegram butuh login Google yang diizinkan.

`REDMINE_API_KEY` adalah key milik satu akun Redmine — semua aksi (termasuk Create Issue) tercatat atas nama akun itu. Pertimbangkan memakai akun Redmine khusus/bot dengan permission minimal.

---

## ⚙️ Environment variables (Vercel → Settings → Environment Variables)

| Variable | Wajib | Dipakai oleh | Keterangan |
| --- | --- | --- | --- |
| `REDMINE_API_KEY` | ✅ | semua route Redmine + cron | Redmine → My Account → API access key |
| `ALLOWED_EMAILS` | ✅* | guard API | Koma, mis. `kamu@gmail.com,rekan@gmail.com` |
| `ALLOWED_EMAIL_DOMAINS` | ✅* | guard API | Koma, mis. `perusahaan.com` |
| `TELEGRAM_BOT_TOKEN` | ✅ | telegram + cron | Token dari @BotFather |
| `TELEGRAM_CHAT_ID` | ✅ | telegram + cron | Chat/grup default |
| `TELEGRAM_ALLOWED_CHAT_IDS` | – | telegram | Chat tambahan yang boleh dipakai dari Settings app |
| `CRON_SECRET` | ✅ | cron | String acak panjang |
| `FIREBASE_SERVICE_ACCOUNT` | ✅ | cron (+ verifikasi token) | Isi JSON service account, satu baris |

\* minimal salah satu dari `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`.

**Service account:** Firebase Console → Project settings → Service accounts → *Generate new private key*. Salin seluruh isi JSON ke `FIREBASE_SERVICE_ACCOUNT`. Jangan commit file JSON-nya (sudah di `.gitignore`).

Setelah mengubah env var → **Redeploy**.

---

## 🚀 Setup Firebase (sekali)

1. Authentication → Sign-in method → aktifkan **Google** (dan **Anonymous** kalau mode guest masih dipakai).
2. Authentication → Settings → Authorized domains → tambahkan domain Vercel + `localhost`.
3. Firestore → Rules → paste isi `firestore.rules` → **Publish**.

---

## 🧑‍💻 Development

```bash
npm install
npx vercel dev        # app + /api/* lokal (butuh env var, lihat `vercel env pull`)
```

`npm run dev` (Vite) hanya untuk iterasi UI — route `/api/*` tidak jalan di sana.

Build produksi (dipakai Vercel):

```bash
npm run check         # cek import/export antar modul
npm run build         # check + build → dist/
```

### Rilis versi baru

1. Ubah `APP_VERSION` di `src/config.js` (dan `version` di `package.json`).
2. Build otomatis men-stamp versi ke `sw.js` (`CACHE_NAME`) dan `?v=` di link CSS, jadi user langsung dapat CSS/JS baru tanpa hard refresh.
3. Disarankan: kerjakan di branch terpisah → cek di **Vercel Preview URL** → baru merge ke `main`.

---

## ⏰ Cron: RFT → Telegram

`vercel.json` menjalankan `/api/cron-rft-telegram` sekali sehari (batas Hobby). Untuk tiap 15 menit pakai [cron-job.org](https://cron-job.org) dengan **custom header**:

```
GET https://erp-update-list.vercel.app/api/cron-rft-telegram
Authorization: Bearer <CRON_SECRET>
```

Test manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://erp-update-list.vercel.app/api/cron-rft-telegram
```

Run pertama hanya **seed** baseline (tanpa spam); run berikutnya hanya mengirim ID RFT baru. Kalau state Firestore tidak terbaca, cron berhenti dengan error (tidak re-seed/spam).

---

## 🐛 Troubleshooting

| Gejala | Penyebab / solusi |
| --- | --- |
| "Sign-in required" / "Not available in guest mode" | Login dengan Google di Settings. |
| "Account … is not allowed" | Tambahkan email ke `ALLOWED_EMAILS` → redeploy. |
| "Server access list not configured" | `ALLOWED_EMAILS`/`ALLOWED_EMAIL_DOMAINS` belum di-set. |
| "Chat ID not allowed" | Samakan Chat ID di Settings app dengan `TELEGRAM_CHAT_ID` atau tambahkan ke `TELEGRAM_ALLOWED_CHAT_IDS`. |
| Cron: "Could not read cron state" | `FIREBASE_SERVICE_ACCOUNT` belum/ salah di-set. |
| Redmine 401/403 | `REDMINE_API_KEY` salah/expired atau kurang permission. |
| App stuck "Syncing" | Domain belum di Authorized domains Firebase. |

---

## 📝 Changelog (ringkas)

- **v4.40.2** — Teks sidebar (menu, judul section, brand, footer, ikon) jadi putih polos agar lebih kontras.
- **v4.40.1** — Fix banner "Could not load projects: Sign-in required" setelah reload di halaman Plans: `apiFetch` menunggu Firebase selesai memulihkan sesi login sebelum memanggil API.
- **v4.40.0** — `src/app.js` (7.500+ baris) dipecah menjadi 36 modul per fitur di `src/core`, `src/ui`, `src/redmine`, `src/features`. Murni pemindahan kode, tanpa perubahan perilaku. Hapus `src/utils.js` (duplikat, tidak dipakai). Tambah `npm run check` (dijalankan otomatis saat build).
- **v4.39.1** — Hapus sisa `public/`, `js/`, `README_DEPLOY.txt`; guest tidak lagi memanggil `/api/*` (hemat invocation); validasi `project_id` di `/api/redmine-issue`.
- **v4.39.0** — Security hardening: semua `/api/*` wajib login Google + allowlist email; chat Telegram di-allowlist; CORS `*` dihapus; cron state via firebase-admin dan `system/*` dikunci; `shares`/`workspaces` tidak bisa di-list; fix service worker (versi cache otomatis dari `APP_VERSION`, CSS network-first, `?v=` cache-bust); hapus duplikat `public/`, `js/` deprecated, `README_DEPLOY.txt`; tambah `.gitignore`.
- **v4.38.x** — Filter By Client (custom field Client Name), tema sidebar.
- **v4.37.x** — Group-by Issue Status, chip status.
- **v4.30–4.36** — Tester Queue RFT, notifikasi Telegram, cron server-side, Create Issue, share link publik, workspace tim, PWA.
- **v4.15** — Google Sign-In (sync lintas device).
- **v4.0** — Sync from Redmine. **v2.0** — Firebase. **v1.0** — versi LocalStorage.

---

© Reyhan Labs — personal use.
