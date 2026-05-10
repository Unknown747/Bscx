# Base Sniper Ultimate

Crypto trading bot untuk jaringan Base blockchain dengan dashboard AI-powered dan backend Express API.

## Arsitektur

- **Frontend** (`artifacts/base-sniper/`): React + Vite + Tailwind CSS, port 5000
- **API Server** (`artifacts/api-server/`): TypeScript/Express backend, port 8080
- **Database**: SQLite (`artifacts/base-sniper/base.db`) — trade history, wallets, blacklist, whale waitlist events, monitored wallets

## Workflows

- **Start application**: `artifacts/base-sniper` — Vite dev server port 5000
- **API Server**: `artifacts/api-server` — ts-node-dev, port 8080

## Alur 3-Tahap Whale Approval

```
Scan/Temukan Kandidat Whale
         ↓
Tahap 1: "Setujui untuk Monitor" (status: monitoring)
         ↓
Tahap 2: WhaleMonitorService polling GeckoTerminal setiap 10 menit
         → amati trade buy/sell, hitung win/loss, PnL, trade/hari
         ↓
Tahap 3: Klik "Evaluasi AI" → AI analisis data → verdict + skor
         → jika approved → "Promosikan ke Copy"
         ↓
Wallet masuk active copy list (CopyTradeMonitor aktif)
```

### Komponen Alur Monitoring

| Komponen | Deskripsi |
|----------|-----------|
| `WhaleMonitorService` | Polling GeckoTerminal setiap 10 menit, update stats DB |
| `addToMonitoring()` | Method AISniperBot: pindahkan kandidat ke monitoring |
| `evaluateMonitoredWallet()` | AI evaluasi dengan rule-based fallback |
| `promoteToActiveCopy()` | Promosikan wallet yang disetujui AI ke copy list |
| `WalletMonitorPage.tsx` | Dashboard modal untuk kelola monitoring |

## Modul Backend (`artifacts/api-server/src/`)

| File | Deskripsi |
|------|-----------|
| `index.ts` | Express server, semua REST endpoints, auth session |
| `ai-sniper-integration.ts` | Kelas utama `AISniperBot` — orkestrator semua fitur + monitoring flow |
| `whale-monitor.ts` | `WhaleMonitorService` — polling 10 menit, update stats DB |
| `multi-ai-provider.ts` | AI multi-provider: Groq → Gemini → HuggingFace → rule-based fallback |
| `microcap-risk-manager.ts` | Risk gate: daily loss limit, consecutive loss cooldown, dynamic position sizing |
| `dynamic-exit.ts` | Exit dinamis berbasis OHLCV GeckoTerminal: momentum, trailing stop, timeout |
| `performance-optimizer.ts` | Cache harga token 3s, batch price fetch, ETH price refresh 60s, `getEthPriceSync()` |
| `whale-analyzer-pro.ts` | Analisis whale on-chain: Sharpe ratio, entry timing, MEV detection, PnL 7d |
| `whale-finder.ts` | Auto-scan whale di GeckoTerminal, scoring kandidat, simulasi copy trade |
| `telegram-bot.ts` | Long-poll Telegram bot: commands + pro alerts (trade, risk, waitlist) |
| `copy-trade-monitor.ts` | Monitor wallet whale via WebSocket, eksekusi copy trade |
| `flashblocks-scanner.ts` | WebSocket ke Base Flashblocks untuk new pool detection |
| `gecko-token-scanner.ts` | Polling GeckoTerminal untuk token opportunity |
| `swap-executor.ts` | Eksekusi swap via Uniswap V3 on Base, TP/SL + dynamic exit position manager |
| `price-oracle.ts` | Harga ETH + best DEX pair dari GeckoTerminal & DexScreener |
| `deployer-checker.ts` | Deteksi serial rugger berdasarkan riwayat deployer |
| `deployer-reputation.ts` | Skor reputasi deployer: wins/losses dari on-chain history |
| `db.ts` | SQLite schema + CRUD: trades, candidates, blacklist, copy_wallets, waitlist_events, **monitored_wallets** |

## Komponen Frontend (`artifacts/base-sniper/src/components/`)

| File | Deskripsi |
|------|-----------|
| `Dashboard.tsx` | Halaman utama: status bot, open positions, activity log, tombol 🔬 Monitor |
| `WalletMonitorPage.tsx` | Modal manajemen monitoring: stats grid, Evaluasi AI, Promosikan ke Copy |
| `WhaleLeaderboard.tsx` | Leaderboard whale wallet — klik baris untuk detail analisis |
| `CopyWalletsModal.tsx` | Kelola whale wallets + Auto Finder dengan tombol 🔬 Setujui untuk Monitor |
| `WhaleDetailModal.tsx` | Detail whale: skor kualitas, Sharpe ratio, entry timing, MEV, waitlist history |
| `TradeHistory.tsx` | Riwayat semua trade + statistik win/loss |
| `Portfolio.tsx` | Portofolio token + saldo ETH |
| `BlacklistModal.tsx` | Manajemen blacklist token |
| `WalletConfigModal.tsx` | Konfigurasi trading parameters |
| `ActivityLog.tsx` | Log aktivitas bot real-time |
| `PositionCard.tsx` | Card posisi terbuka dengan P&L live |
| `DeployerCard.tsx` | Info reputasi deployer token |
| `LoginGate.tsx` | Auth gate dengan APP_PASSWORD |

## API Endpoints

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/auth/verify` | Login, returns session token |
| GET | `/api/status` | Status bot lengkap + risk state |
| GET | `/api/logs` | Activity log (100 entri terakhir) |
| GET | `/api/wallets` | Daftar copy wallets |
| POST | `/api/wallets` | Tambah copy wallet |
| DELETE | `/api/wallets/:addr` | Hapus copy wallet |
| PATCH | `/api/wallets/:addr` | Toggle/rename wallet |
| GET | `/api/candidates` | Semua whale kandidat |
| POST | `/api/candidates/scan` | Trigger manual whale scan |
| POST | `/api/candidates/:addr/approve` | Setujui whale kandidat (legacy) |
| POST | `/api/candidates/:addr/reject` | Tolak whale kandidat |
| POST | `/api/simulate` | Simulasi copy trade P&L |
| GET | `/api/whale/detail/:address` | Analisis whale pro (Sharpe, MEV, dll) |
| GET | `/api/risk` | State risk manager saat ini |
| GET | `/api/cache` | Statistik performance cache |
| GET | `/api/blacklist` | Daftar blacklist |
| POST | `/api/blacklist` | Tambah ke blacklist |
| DELETE | `/api/blacklist/:addr` | Hapus dari blacklist |
| GET | `/api/trades` | Riwayat trade |
| GET | `/api/positions` | Posisi terbuka |
| GET | `/api/portfolio` | Data portofolio |
| POST | `/api/sell` | Manual sell |
| GET | `/api/config` | Konfigurasi runtime |
| PATCH | `/api/config` | Update konfigurasi |
| GET | `/api/keys` | Status API keys |
| POST | `/api/keys` | Update API keys |
| POST | `/api/telegram/test` | Test koneksi Telegram |
| **POST** | **`/api/whale/monitor`** | **Setujui kandidat → masuk monitoring (Tahap 1)** |
| **GET** | **`/api/whale/monitored`** | **List semua wallet dimonitor + stats** |
| **DELETE** | **`/api/whale/monitored/:addr`** | **Hapus wallet dari monitoring** |
| **POST** | **`/api/whale/evaluate/:addr`** | **Trigger evaluasi AI (Tahap 3)** |
| **POST** | **`/api/whale/promote/:addr`** | **Promosikan wallet ke copy aktif** |
| POST | `/api/whale/approve` | Legacy alias → redirect ke `/api/whale/monitor` |
| POST | `/api/whale/reject` | Tolak kandidat |
| POST | `/api/whale/scan` | Trigger manual whale scan |

## Database Tables

- `whale_candidates` — hasil whale scan dengan score & status (pending/monitoring/approved/rejected)
- `monitored_wallets` — wallet dalam fase monitoring: stats trade, win/loss, PnL, verdict AI
- `trade_history` — semua trade yang dieksekusi
- `blacklist` — token yang diblacklist
- `copy_wallets` — wallet whale yang aktif di-copy
- `whale_waitlist_events` — log events whale (discovered/monitoring/approved/rejected)

## Environment Variables

Dikelola via Replit Secrets atau in-app key management UI (`/api/keys`):

| Variabel | Wajib | Deskripsi |
|----------|-------|-----------|
| `APP_PASSWORD` | ✅ | Password akses dashboard |
| `PRIVATE_KEY` | Untuk trading live | Ethereum private key |
| `GROQ_API_KEY` | Rekomendasi | AI provider utama (tercepat) |
| `GEMINI_API_KEY` | Opsional | AI provider fallback |
| `HUGGINGFACE_API_KEY` | Opsional | AI provider terakhir |
| `TELEGRAM_BOT_TOKEN` | Opsional | Untuk notifikasi & commands |
| `TELEGRAM_CHAT_ID` | Opsional | Target chat Telegram |

Parameter trading (capital, slippage, TP/SL, dll) dikonfigurasi via UI atau `.replit [userenv]`.

## Telegram Commands

`/help`, `/status`, `/balance`, `/candidates`, `/approve <addr>` (→ masuk monitoring), `/reject <addr>`, `/positions`, `/history`, `/blacklist`, `/dailyreport`

**Notifikasi otomatis:** whale masuk monitoring, whale dipromosikan ke copy, trade buy/sell, risk alert (daily loss, consecutive loss, cooldown), laporan P&L harian.

## Perbaikan & Peningkatan (Audit Lengkap)

### Bug Kritis yang Sudah Diperbaiki

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `gecko-token-scanner.ts` | GoPlus fail-open di honeypot check | Fail-closed: `safe: false` saat error |
| 2 | `ai-sniper-integration.ts` | `checkHoneypot` catch mengembalikan `safe: true` | Fail-closed + log warning |
| 3 | `ai-sniper-integration.ts` | Filter `tx_from_address` pakai `filter:from` (tidak valid di viem) | Fix ke `getLogs` manual + decode |
| 4 | `swap-executor.ts` | ABI decode error saat beli token baru | Wrap decode dalam try-catch |
| 5 | `swap-executor.ts` | WETH tidak dideteksi sebagai output token | Cek `tokenOut === WETH_BASE` |
| 6 | `swap-executor.ts` | Slippage 0 → selalu gagal | Hitung `amountOutMinimum` dari ETH price |
| 7 | `price-oracle.ts` | ETH price hardcode 3500 | Fetch live dari CoinGecko + DexScreener |
| 8 | `multi-ai-provider.ts` | AI BUY bias karena prompt tidak seimbang | Prompt baru + batasi BUY, minta reasoning |
| 9 | `copy-trade-monitor.ts` | Stats hardcode 75%/50 trade | Hitung dari DB aktual |
| 10 | `swap-executor.ts` | Duplicate `tokenAddress` di SELL_ALL_PANIC emit | Hapus duplikat |
| 11 | `ai-sniper-integration.ts` | ETH price hardcode `* 3000` di GeckoTokenScanner | Gunakan `getEthPriceSync()` |

### Peningkatan AI & Trading

| # | Fitur | Deskripsi |
|---|-------|-----------|
| 1 | **Dynamic Exit** | `dynamic-exit.ts` sekarang benar-benar dipakai di `swap-executor.ts` position monitor |
| 2 | **AI Token Prompt** | Tambah ETH price live, sinyal baru: priceChangeH1, buyTxH1, sellTxH1, fdvUsd |
| 3 | **AI Response Cache** | Cache 30 detik untuk token analysis — kurangi latency & rate limit |
| 4 | **Whale Correlation** | +0-20% copy size saat 2+ whale beli token yang sama |
| 5 | **Rule-based Scoring** | Sinyal baru + hard gate untuk filter token buruk |
| 6 | **analyzeWallet** | Prompt bahasa Indonesia, JSON-only, regex extract, fallback ke Groq dulu |
| 7 | **shouldBuy threshold** | `predictedProfit` threshold dinamis: 10/15/20% sesuai confidence AI |
| 8 | **getEthPriceSync()** | Fungsi baru di `performance-optimizer.ts` untuk akses ETH price secara sync |

### Peningkatan Telegram

- Notifikasi buy kaya: token name, harga ETH, USD value, sumber whale, confidence AI
- Notifikasi take-profit: hold time, multiplier, level TP
- Notifikasi stop-loss: hold time, peak multiplier, alasan
- Notifikasi risk alert: detail tipe (daily loss / consecutive / cooldown)
- Notifikasi whale waitlist: skor, WR, profit estimasi dengan format rich

## User Preferences

- Semua API key dikelola via Replit Secrets atau in-app UI — jangan hardcode
- Jangan commit `.env` dengan key asli
- Bahasa Indonesia untuk UI dan pesan pengguna
