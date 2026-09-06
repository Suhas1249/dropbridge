# ⚡ DropBridge

> **"Your temporary digital bridge between devices."**

DropBridge is a high-speed, zero-knowledge, real-time cross-device transfer application. It allows you to move text, links, code snippets, images, and files instantly between desktop and mobile devices without accounts, apps, setup, or data logging.

![E2E Encrypted](https://img.shields.io/badge/Security-AES--256--GCM%20E2EE-10B981)
![Realtime](https://img.shields.io/badge/Realtime-Socket.io-6366F1)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## 🔥 Key Features

- ⚡ **Zero-Friction Device Pairing**: Open website on desktop → QR code appears → Scan with phone camera → Connected instantly.
- 🔒 **Zero-Knowledge E2E Encryption (E2EE)**: Payloads are encrypted in-browser via Web Crypto API (AES-GCM-256). Encryption keys reside strictly in the URL hash fragment (`#key=...`), which is never sent over HTTP to the server.
- 📱↔️💻 **Bi-Directional Instant Sync**: Sub-50ms sync for text, links, code, images, and binary files up to 25MB.
- ⏱️ **Ephemeral & Self-Destructing**: Data lives strictly in server RAM (no database, no disk logs) and auto-destructs upon room expiration or 10s after device disconnect.
- 🛡️ **Hardened Security**: IP-based rate limiting on room creation and join attempts (brute-force protection).

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Clone repository
git clone https://github.com/YOUR_USERNAME/dropbridge.git
cd dropbridge

# 2. Install dependencies
npm install

# 3. Run security test suite
npm test

# 4. Start local development server
npm start
```

Open `http://localhost:3000` in your desktop browser.

---

## 🌐 Deploy to Production (Free on Render / Railway)

1. Fork or push this repository to your GitHub account.
2. Sign up on **[Render.com](https://render.com)** (Free Tier).
3. Create a **New Web Service** and select your `dropbridge` repository.
4. Configure service settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Deploy**. Render will generate a live HTTPS URL (e.g. `https://dropbridge.onrender.com`) with automatic Web Crypto E2EE support!

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, CSS3 Glassmorphic UI, Web Crypto API (`crypto.subtle`), Socket.io client.
- **Backend**: Node.js, Express, Socket.io, Express-Rate-Limit.
- **Testing**: Jest, Supertest.

---

## 📜 License

Distributed under the MIT License.
