# Zahir ERP · Update Manager

Aplikasi web untuk mengelola history update Zahir ERP dan generate ringkasan untuk dibagikan ke grup WhatsApp/Telegram.

![Version](https://img.shields.io/badge/version-4.1.0-blue)
![Firebase](https://img.shields.io/badge/Firebase-v10-orange)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)

---

## ✨ Fitur

| Fitur | Deskripsi |
|---|---|
| 📋 **Update Plans** | Kelola daftar issue dari SDET — input manual atau sync dari Redmine |
| 📝 **Update Summaries** | Generate ringkasan siap share ke WA/Telegram dengan format emoji |
| 🔴 **Sync from Redmine** | Tarik otomatis issue berstatus Resolved dari Redmine |
| 📤 **Copy for Telegram** | 4 format copy: Telegram markdown, numbered list, plain URLs, clickable links |
| ☁️ **Cloud Sync** | Data tersimpan di Firebase Firestore — realtime across devices |
| 🌗 **Light/Dark/Auto** | Theme switcher dengan system preference detection |
| 💾 **Backup/Restore** | Export/Import JSON untuk backup atau migrasi |

---

## 🏗️ Struktur Proyek

```
erp_update_list/
├── index.html              ← Struktur halaman
├── css/
│   └── style.css          ← Semua styling
├── js/
│   └── app.js             ← Semua logic (Firebase, CRUD, sync)
├── api/
│   └── redmine.js         ← Vercel serverless: Redmine API proxy
├── vercel.json            ← Konfigurasi Vercel (opsional)
├── README.md              ← Dokumen ini
└── .gitignore
```

---

## 🚀 Setup & Deploy

### 1. Clone / Fork

```bash
git clone https://github.com/reyhanlabs/erp_update_list.git
cd erp_update_list
```

### 2. Setup Firebase

Aplikasi menggunakan **Firebase Firestore** untuk cloud sync dan **Anonymous Auth** untuk identifikasi device.

#### a. Buat Firebase Project

1. Buka [Firebase Console](https://console.firebase.google.com/)
2. Buat project baru atau pakai yang sudah ada
3. Copy config dari **Project Settings → General → Your apps → Web**

#### b. Update Config di `js/app.js`

Cari blok ini di bagian atas file `js/app.js`:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyA9EXEDl79MzQkO4k181BH4SQPE6lOArGg",
  authDomain: "erpupdate-f0b18.firebaseapp.com",
  projectId: "erpupdate-f0b18",
  storageBucket: "erpupdate-f0b18.firebasestorage.app",
  messagingSenderId: "500016291571",
  appId: "1:500016291571:web:455e3a23ce8f8597142186",
  measurementId: "G-WNPME76HRK"
};
```

Ganti dengan config Firebase milik Anda.

#### c. Enable Firestore

1. Firebase Console → **Firestore Database** → **Create database**
2. Pilih lokasi: `asia-southeast1` (Singapore) atau `asia-southeast2` (Jakarta)
3. Mode: **Production mode**
4. Setelah dibuat, buka tab **Rules**, paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{collection}/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

5. Klik **Publish**

#### d. Enable Anonymous Auth

1. Firebase Console → **Authentication** → **Get started**
2. Tab **Sign-in method** → aktifkan **Anonymous**
3. Save

#### e. Authorize Domain

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Tambahkan domain Vercel Anda (contoh: `erp-update-list.vercel.app`)
3. Tambahkan juga `localhost` untuk testing lokal

---

### 3. Setup Redmine Sync (Opsional)

Kalau ingin fitur **Sync from Redmine** berfungsi:

#### a. Dapatkan Redmine API Key

1. Login ke Redmine Anda (mis. `pjm.zahironline.com`)
2. Buka **My Account** (`/my/account`)
3. Di panel kanan, cari **API access key** → klik **Show**
4. Copy key tersebut

#### b. Set Environment Variable di Vercel

1. Buka Vercel Dashboard → project Anda
2. **Settings → Environment Variables**
3. Tambahkan:

| Name | Value | Environment |
|------|-------|-------------|
| `REDMINE_API_KEY` | API key Anda | Production, Preview, Development |

4. Klik **Save**
5. **Redeploy** project (penting — env var tidak berlaku sampai redeploy)

#### c. Deploy ke Vercel

```bash
# Kalau pakai Vercel CLI
vercel --prod

# Atau push ke GitHub → Vercel auto-deploy
git push origin main
```

---

## 🧪 Testing

### Test Firebase Connection

Buka app → cek badge di topbar: harusnya muncul **"Synced"** hijau.

Kalau masih **"Syncing"** terus:
- Cek **F12 → Console** untuk error
- Pastikan Anonymous Auth enabled
- Pastikan domain Vercel sudah authorized

### Test Redmine Proxy

Buka di browser:

```
https://your-app.vercel.app/api/redmine?limit=1
```

Harusnya muncul JSON dengan data issue. Kalau error:

| Error | Solusi |
|-------|--------|
| `REDMINE_API_KEY not configured` | Env var belum di-set → Redeploy di Vercel |
| `Redmine API error 401` | API key salah/expired → Generate ulang |
| `Redmine API error 403` | User tidak punya akses → Cek permission |
| `Proxy failed` | Cek koneksi internet / DNS |

### Test Sync dari App

1. Buka app → sidebar **Sync from Redmine**
2. Klik **Test Connection** → harus muncul ✅
3. Pilih **Status: Resolved**, kosongkan date filter
4. Klik **Preview** → lihat daftar issue + status "New"/"Already added"
5. Klik **Sync Now** → issues baru akan tersimpan sebagai Update Plan

---

## 📖 Cara Pakai

### Alur Manual

1. **Add New Plan** → isi title, tanggal, paste URL issue SDET
2. **Create Summary** → pilih plan, auto-generate template
3. Edit ringkasan sesuai hasil GPT
4. Klik **Copy for WhatsApp** → paste ke grup

### Alur Sync dari Redmine

1. Di Redmine, set issue status ke **Resolved**
2. Di app, buka **Sync from Redmine**
3. Set filter **Status: Resolved** + tanggal opsional
4. Klik **Sync Now**
5. Issues otomatis masuk sebagai Update Plan baru (badge 🔴 Redmine Sync)
6. Lanjut **Create Summary** seperti biasa

### Copy Format untuk Telegram

Klik **Copy for Telegram** di setiap plan → pilih:

| Format | Kapan Dipakai |
|--------|---------------|
| **Telegram format** | Kirim ke tim via Telegram — issue number jadi link clickable |
| **Markdown links** | Kirim via Slack/Discord yang support markdown |
| **Numbered list** | Kirim via WhatsApp (WA tidak support markdown) |
| **Plain URLs** | Backup manual / catatan |

---

## 🎨 Kustomisasi

### Ubah Warna Brand

Edit CSS variables di `css/style.css`:

```css
:root {
  --brand: #2563eb;        /* warna utama */
  --brand-hover: #1d4ed8;  /* hover state */
  --brand-soft: #eff4ff;   /* soft background */
  --brand-ring: rgba(37,99,235,.14);  /* focus ring */
}
```

### Ubah Nama Aplikasi

Di `index.html`, cari:

```html
<div class="sidebar-brand">
  <div class="mark">Z</div>
  <div class="brand-text">
    <h1>Zahir ERP</h1>
    <p>Update Manager</p>
  </div>
</div>
```

Ganti teksnya sesuai kebutuhan.

### Tambah Format Copy Baru

Di `js/app.js`, cari fungsi `buildCopyText()`:

```javascript
function buildCopyText(plan, format){
  const issues = (plan.issues || '').split('\n')...
  
  if(format === 'plain') return issues.join('\n');
  if(format === 'numbered') { /* ... */ }
  if(format === 'markdown') { /* ... */ }
  if(format === 'telegram') { /* ... */ }
  
  // Tambahkan format baru di sini:
  if(format === 'slack'){
    let out = `*${title}*\n${dateStr} · ${issues.length} issues\n\n`;
    issues.forEach(url => {
      const num = extractIssueNumber(url) || '—';
      out += `• <${url}|#${num}>\n`;
    });
    return out.trim();
  }
}
```

Lalu tambahkan tombol di `renderPlans()` di bagian `.copy-menu`.

---

## 🐛 Troubleshooting

### App stuck di "Syncing"

1. Buka **F12 → Console**
2. Cari error `auth/unauthorized-domain`
3. Fix: tambahkan domain Vercel di Firebase Authorized domains

### Data tidak muncul setelah refresh

1. Cek `users/{uid}/plans` di Firestore Console
2. Kalau ada tapi tidak muncul di UI → Firestore rules salah
3. Cek **F12 → Console** untuk error

### Sync from Redmine tidak return apa-apa

1. Test manual: `https://your-app.vercel.app/api/redmine?limit=5`
2. Kalau error 401/403 → API key issue
3. Kalau return tapi kosong → filter status_id salah (cek di **Administration → Enumerations → Issue statuses**)

### Dropdown copy terpotong

Pastikan CSS ini ada di `css/style.css`:

```css
.list-item{ overflow:visible; }
#planList, #summaryList { overflow:visible; }
```

---

## 📦 Teknologi

- **Frontend**: Vanilla HTML/CSS/JS (no framework, no build step)
- **Cloud**: Firebase Firestore + Anonymous Auth
- **Backend**: Vercel Serverless Functions (untuk Redmine proxy)
- **Fonts**: Inter + JetBrains Mono (Google Fonts)
- **Icons**: Inline SVG (Lucide-style)

---

## 🔒 Keamanan

- **Firestore Rules** memastikan user A tidak bisa akses data user B
- **API Key Redmine** disimpan di Vercel env var, tidak di-expose ke browser
- **Firebase API Key** memang public — bukan rahasia, dilindungi oleh rules
- **Anonymous Auth** — setiap browser punya UID unik

⚠️ **Jangan commit** file `.env` atau `serviceAccountKey.json` ke GitHub.

---

## 🤝 Kontribusi

Karena ini project pribadi, untuk perubahan:

1. Edit file yang sesuai (`index.html` / `css/style.css` / `js/app.js` / `api/redmine.js`)
2. Commit dengan message jelas
3. Push → Vercel auto-deploy

---

## 📝 Changelog

### v4.1.0 — Split Files
- Pisah menjadi `index.html`, `css/style.css`, `js/app.js`
- Fix dropdown copy terpotong
- Toggle buka/tutup dropdown copy
- ESC menutup dropdown

### v4.0.0 — Redmine Sync
- Menu "Sync from Redmine" dengan badge NEW
- Test Connection, Preview, Sync Now
- Auto-detect duplicate issues
- Badge "Redmine Sync" di plan yang auto-imported

### v3.2.0 — Issue Editor
- Tombol Add Issue pindah ke bawah (footer editor)
- Auto-scroll to bottom saat add
- Auto-focus input

### v3.1.0 — Copy for Telegram
- Dropdown dengan 4 format copy
- Telegram markdown, numbered, plain, clickable

### v3.0.0 — Line Items
- Issue list jadi dynamic rows
- Auto-detect issue number
- Line-item view di list plan

### v2.0.0 — Firebase
- Firebase Firestore integration
- Realtime listener
- Anonymous auth

### v1.0.0 — Initial
- LocalStorage version
- Update Plan & Summary CRUD

---

## 📄 License

Personal use. © Reyhan Labs

---

## 🔗 Links

- **Repo**: [github.com/reyhanlabs/erp_update_list](https://github.com/reyhanlabs/erp_update_list)
- **Live**: [erp-update-list.vercel.app](https://erp-update-list.vercel.app)
- **Firebase Console**: [console.firebase.google.com/project/erpupdate-f0b18](https://console.firebase.google.com/project/erpupdate-f0b18)