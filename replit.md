# Base Sniper Ultimate

Crypto trading bot khusus untuk **Base Network** — fokus pada screener koin meme baru dengan eksekusi otomatis via flashblocks.

## Arsitektur

```
artifacts/
├── api-server/        Node.js + TypeScript backend (port 5000)
│   └── src/
│       ├── index.ts                  API routes utama
│       ├── ai-sniper-integration.ts  Orchestrator utama bot
│       ├── smart-screener.ts         Screener koin meme baru (FOKUS UTAMA)
│       ├── gecko-token-scanner.ts    Scanner via GeckoTerminal
│       ├── flashblocks-scanner.ts    WebSocket scanner Base flashblocks
│       ├── token-safety.ts           Validasi honeypot / tax
│       ├── deployer-checker.ts       Reputasi deployer token
│       ├── microcap-risk-manager.ts  Risk management (TP/SL/circuit breaker)
│       ├── multi-ai-provider.ts      AI (Groq/Gemini/HuggingFace) untuk analisis token
│       ├── swap-executor.ts          Eksekusi swap on-chain (Uniswap V2)
│       ├── paper-trader.ts           Paper trading mode
│       ├── telegram-bot.ts           Notifikasi & kontrol via Telegram
│       ├── db.ts                     SQLite persistence (sql.js)
│       └── config-store.ts           Manajemen konfigurasi runtime
└── base-sniper/       React + Vite frontend dashboard (diproxy via backend)
    └── src/
        ├── components/
        │   ├── Dashboard.tsx         Halaman utama — status, posisi, screener
        │   ├── SettingsModal.tsx     Pengaturan bot (TP/SL, AI, screener)
        │   ├── ActivityLog.tsx       Log aktivitas trading real-time
        │   ├── ScreenerHistory.tsx   Riwayat sinyal screener
        │   ├── BlacklistModal.tsx    Manajemen blacklist token
        │   └── WalletConfigModal.tsx Konfigurasi wallet & API keys
        └── App.tsx
```

## Fitur Utama

- **SmartScreener**: Scan token baru Base setiap 15 detik — filter likuiditas $5K-$200K, skor min 75, rasio buy/sell max 1.5x
- **GeckoTerminal Scanner**: Scan new pools & trending setiap 30 detik via API GeckoTerminal
- **Flashblocks WebSocket**: Koneksi real-time ke Base Network untuk deteksi token baru ultra-cepat
- **Safety Checker**: Honeypot detection, tax check, deployer reputation
- **Risk Manager**: TP1/TP2/TP3 otomatis, stop loss, circuit breaker harian
- **AI Analysis**: Groq / Gemini / HuggingFace untuk scoring token (opsional)
- **Paper Trading**: Mode simulasi tanpa modal nyata
- **Telegram Bot**: Notifikasi trade + kontrol penuh via command

## Konfigurasi

| File | Fungsi |
|------|--------|
| `artifacts/api-server/trading-config.json` | Semua setting trading (TP/SL, screener, dll) |
| `artifacts/api-server/.runtime-keys.json` | Telegram token/chatId & AI API keys (gitignored) |
| Replit Secrets: `PRIVATE_KEY` | Private key wallet untuk live trading |
| Replit Secrets: `APP_PASSWORD` | Password dashboard web |

## Cara Jalankan

Backend otomatis berjalan via workflow **Backend API** (port 5000).
Frontend build statis diproxy oleh backend — akses di URL preview Replit.

## Build Commands

```bash
# Backend
cd artifacts/api-server && npm run build   # tsc --noCheck

# Frontend
cd artifacts/base-sniper && npm run build  # tsc && vite build
```

## User Preferences

- Fokus hanya pada screener koin meme baru — tidak ada copy trading atau whale monitoring
- Semua fitur copy trade dan whale finder sudah dihapus permanen
- Bahasa Indonesia untuk UI dan log
- VPS-friendly: server load minimal, scan interval efisien (15 detik)
