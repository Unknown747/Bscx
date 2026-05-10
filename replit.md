# Base Sniper Ultimate

Crypto trading bot untuk jaringan Base blockchain dengan dashboard AI-powered dan backend Express API.

## Arsitektur

- **Frontend** (`artifacts/base-sniper/`): React + Vite + Tailwind CSS, port 5000
- **API Server** (`artifacts/api-server/`): TypeScript/Express backend, port 8080
- **Database**: SQLite (`artifacts/base-sniper/base.db`) — trade history, wallets, blacklist, whale waitlist events, monitored wallets, push subscriptions

## Workflows

- **Start application**: `artifacts/base-sniper` — Vite dev server port 5000
- **API Server**: `artifacts/api-server` — ts-node-dev, port 8080

---

## Alur 3-Tahap Whale Approval

```
Scan/Temukan Kandidat Whale
         ↓
Tahap 1: "Setujui untuk Monitor" (status: monitoring)
         ↓
Tahap 2: WhaleMonitorService polling Blockscout setiap 10 menit
         → baca semua ERC-20 tx on-chain, FIFO matching buy/sell
         → hitung win/loss, realized PnL, trade/hari
         ↓
Tahap 3: Klik "Evaluasi AI" → AI analisis data → verdict + skor
         → jika approved → "Promosikan ke Copy"
         ↓
Wallet masuk active copy list (CopyTradeMonitor aktif)
```

### Komponen Alur Monitoring

| Komponen | Deskripsi |
|----------|-----------|
| `WhaleMonitorService` | Polling Blockscout setiap 10 menit — primary on-chain, Gecko fallback |
| `basescan-monitor.ts` | Integrasi Blockscout API: fetch ERC-20 transfers, FIFO PnL, cursor cache, live feed |
| `addToMonitoring()` | Method AISniperBot: pindahkan kandidat ke monitoring |
| `evaluateMonitoredWallet()` | AI evaluasi dengan rule-based fallback |
| `promoteToActiveCopy()` | Promosikan wallet yang disetujui AI ke copy list |
| `WalletMonitorPage.tsx` | Modal monitoring: stats, Evaluasi AI, Feed Transaksi live, Rescan, Promosikan |

---

## Modul Backend (`artifacts/api-server/src/`)

| File | Deskripsi |
|------|-----------|
| `index.ts` | Express server — semua REST endpoints, auth session, rate limiting |
| `ai-sniper-integration.ts` | Kelas utama `AISniperBot` — orkestrator semua fitur + monitoring flow |
| `whale-monitor.ts` | `WhaleMonitorService` — polling Blockscout (primary) + GeckoTerminal (fallback), update stats DB |
| `basescan-monitor.ts` | Integrasi Blockscout API: `analyzeWalletOnChain()`, `fetchRecentTrades()`, cursor cache per wallet |
| `multi-ai-provider.ts` | AI multi-provider: Groq → Gemini → HuggingFace → rule-based fallback |
| `microcap-risk-manager.ts` | Risk gate: daily loss limit, consecutive loss cooldown, dynamic position sizing |
| `dynamic-exit.ts` | Exit dinamis berbasis OHLCV GeckoTerminal: momentum, trailing stop, timeout |
| `performance-optimizer.ts` | Cache harga token 3s, batch price fetch, ETH price refresh 60s, `getEthPriceSync()` |
| `whale-analyzer-pro.ts` | Analisis whale on-chain: Sharpe ratio, entry timing, MEV detection, PnL 7d |
| `whale-finder.ts` | Auto-scan whale di GeckoTerminal, scoring kandidat, simulasi copy trade |
| `whale-correlator.ts` | Deteksi 2+ whale beli token sama dalam 10 menit — sinyal coordinated play, bonus copy size |
| `token-safety.ts` | Full safety check token: GoPlus Labs + Honeypot.is, cache 10 menit |
| `backtest-engine.ts` | Replay OHLCV GeckoTerminal untuk simulasi strategi TP/SL — profit ladder, trailing stop |
| `telegram-bot.ts` | Long-poll Telegram bot: commands + pro alerts (trade, risk, waitlist, whale events) |
| `copy-trade-monitor.ts` | Monitor wallet whale via WebSocket, eksekusi copy trade dengan dynamic sizing |
| `flashblocks-scanner.ts` | WebSocket ke Base Flashblocks untuk new pool detection |
| `gecko-token-scanner.ts` | Polling GeckoTerminal untuk token opportunity |
| `swap-executor.ts` | Eksekusi swap via Uniswap V3 on Base, TP/SL + dynamic exit position manager |
| `price-oracle.ts` | Harga ETH + best DEX pair dari GeckoTerminal & DexScreener |
| `deployer-checker.ts` | Deteksi serial rugger berdasarkan riwayat deployer |
| `deployer-reputation.ts` | Skor reputasi deployer: wins/losses dari on-chain history |
| `push-manager.ts` | Web Push notifications (VAPID): subscribe browser, kirim alert buy/sell/whale/TP/SL |
| `db.ts` | SQLite schema + CRUD: trades, candidates, blacklist, copy_wallets, waitlist_events, monitored_wallets, push_subscriptions |

---

## Komponen Frontend (`artifacts/base-sniper/src/components/`)

| File | Deskripsi |
|------|-----------|
| `Dashboard.tsx` | Halaman utama: status bot, open positions, activity log, tombol 🔬 Monitor |
| `WalletMonitorPage.tsx` | Modal monitoring: stats grid, feed transaksi live Blockscout, Evaluasi AI, Rescan, Promosikan ke Copy |
| `WhaleLeaderboard.tsx` | Leaderboard whale wallet — klik baris untuk detail analisis |
| `CopyWalletsModal.tsx` | Kelola whale wallets + Auto Finder dengan tombol 🔬 Setujui untuk Monitor |
| `WhaleDetailModal.tsx` | Detail whale: skor kualitas, Sharpe ratio, entry timing, MEV, waitlist history |
| `TradeHistory.tsx` | Riwayat semua trade + statistik win/loss |
| `DailyReport.tsx` | Laporan P&L harian: grafik 14 hari, win rate, best/worst trade, ETH balance |
| `Backtest.tsx` | UI simulasi backtest: pilih token, timeframe, konfigurasi TP/SL, lihat hasil |
| `Portfolio.tsx` | Portofolio token + saldo ETH |
| `BlacklistModal.tsx` | Manajemen blacklist token |
| `WalletConfigModal.tsx` | Konfigurasi trading parameters |
| `Modal100k.tsx` | Modal konfigurasi mode 100k IDR — capital kecil, gas, slippage |
| `TokenSafetyBadge.tsx` | Badge keamanan token inline: honeypot, GoPlus flags, buy/sell tax, compact & full mode |
| `MiniChart.tsx` | Chart OHLCV mini untuk token tertentu (candlestick, volume, MA) |
| `PushNotification.tsx` | UI subscribe/unsubscribe Web Push notifications browser |
| `ActivityLog.tsx` | Log aktivitas bot real-time |
| `PositionCard.tsx` | Card posisi terbuka dengan P&L live |
| `DeployerCard.tsx` | Info reputasi deployer token |
| `LoginGate.tsx` | Auth gate dengan APP_PASSWORD |

---

## API Endpoints

### Auth & Status

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/auth/verify` | Login, returns session token |
| GET | `/api/status` | Status bot lengkap + risk state |
| GET | `/api/logs` | Activity log (100 entri terakhir) |
| GET | `/api/eth-price` | Harga ETH live dari oracle |
| GET | `/api/pnl` | Ringkasan P&L global |

### Config & Keys

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/config` | Konfigurasi runtime |
| PATCH | `/api/config` | Update konfigurasi |
| POST | `/api/settings` | Alias update settings |
| GET | `/api/keys` | Status API keys (tersedia/tidak) |
| POST | `/api/keys` | Update API keys |

### Trading & Posisi

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/positions` | Posisi terbuka saat ini |
| GET | `/api/portfolio` | Data portofolio + saldo ETH |
| GET | `/api/trades` | Riwayat trade (alias `/api/history`) |
| POST | `/api/sell` | Manual sell token |
| POST | `/api/send` | Manual send transaksi |
| POST | `/api/emergency-stop` | Hentikan semua + jual semua posisi |

### Backtest & Chart

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/backtest` | Simulasi strategi TP/SL dengan data OHLCV historis |
| GET | `/api/chart/:tokenAddress` | Data OHLCV token untuk mini chart |
| GET | `/api/report` | Laporan P&L terstruktur: hari ini + 14 hari + all-time |
| GET | `/api/daily-report` | Laporan P&L teks (format Telegram) |

### Token Safety & Analisis

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/safety/:address` | Full safety check: GoPlus Labs + Honeypot.is |
| GET | `/api/reputation/:address` | Skor reputasi deployer token |
| POST | `/api/narrative/check` | Deteksi narasi token (AI-based) |

### Wallet & Blacklist

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/wallets` | Daftar copy wallets aktif |
| POST | `/api/wallets` | Tambah copy wallet |
| DELETE | `/api/wallets/:addr` | Hapus copy wallet |
| PATCH | `/api/wallets/:addr` | Toggle aktif / rename wallet |
| GET | `/api/blacklist` | Daftar blacklist token |
| POST | `/api/blacklist` | Tambah token ke blacklist |
| DELETE | `/api/blacklist/:addr` | Hapus token dari blacklist |

### Whale Kandidat

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/whale/pending` | List kandidat whale (status: pending) |
| GET | `/api/whale/all` | Semua kandidat (pending + approved + rejected) |
| POST | `/api/whale/scan` | Trigger manual whale scan |
| POST | `/api/whale/approve` | Setujui kandidat (legacy alias → `/api/whale/monitor`) |
| POST | `/api/whale/reject` | Tolak kandidat whale |
| POST | `/api/simulate` | Simulasi copy trade P&L kandidat |
| GET | `/api/whale/detail/:address` | Analisis whale pro: Sharpe, MEV, entry timing, PnL 7d |
| GET | `/api/whale/correlation` | Peta korelasi aktif (2+ whale beli token sama) |

### Whale Monitoring Flow

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/whale/monitor` | **Tahap 1**: Setujui kandidat → masuk monitoring |
| GET | `/api/whale/monitored` | List semua wallet dimonitor + stats lengkap |
| DELETE | `/api/whale/monitored/:addr` | Hapus wallet dari monitoring |
| POST | `/api/whale/evaluate/:addr` | **Tahap 3**: Trigger evaluasi AI → verdict + breakdown |
| POST | `/api/whale/promote/:addr` | Promosikan wallet (AI approved) → copy aktif |
| POST | `/api/whale/force-promote/:addr` | Paksa promosikan (override, tanpa persetujuan AI) |
| GET | `/api/whale/monitor-status` | Status Blockscout integration (selalu aktif) |
| GET | `/api/whale/blockscout/:addr/trades` | Feed 10 transaksi ERC-20 terbaru dari Blockscout |
| POST | `/api/whale/rescan/:addr` | Force rescan wallet dari awal via Blockscout |

### Risk & Cache

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/risk` | State risk manager saat ini |
| GET | `/api/cache` | Statistik performance cache |

### Web Push Notifications

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/push/vapid-key` | Ambil VAPID public key untuk subscribe |
| GET | `/api/push/status` | Jumlah subscriber aktif |
| POST | `/api/push/subscribe` | Daftarkan browser untuk notifikasi push |
| DELETE | `/api/push/unsubscribe` | Batalkan langganan push |

### Telegram

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/telegram/test` | Test koneksi & kirim pesan ke Telegram |

---

## Database Tables

| Tabel | Deskripsi |
|-------|-----------|
| `whale_candidates` | Hasil whale scan — skor, status (pending/monitoring/approved/rejected) |
| `monitored_wallets` | Wallet fase monitoring: tradesObserved, winsObserved, lossesObserved, totalPnlPct, tradesPerDay, lastTradeMs, aiVerdict, aiReason, aiScore, dataSource |
| `trade_history` | Semua trade yang dieksekusi — buy/sell, profit, hold time |
| `blacklist` | Token yang diblacklist |
| `copy_wallets` | Wallet whale yang aktif di-copy |
| `whale_waitlist_events` | Log events whale (discovered/monitoring/approved/rejected) |
| `push_subscriptions` | Endpoint + data browser untuk Web Push |

---

## Environment Variables

Dikelola via Replit Secrets atau in-app key management UI (`/api/keys`):

| Variabel | Wajib | Deskripsi |
|----------|-------|-----------|
| `APP_PASSWORD` | ✅ | Password akses dashboard |
| `PRIVATE_KEY` | Untuk trading live | Ethereum private key wallet |
| `GROQ_API_KEY` | Rekomendasi | AI provider utama (tercepat) |
| `GEMINI_API_KEY` | Opsional | AI provider fallback |
| `HUGGINGFACE_API_KEY` | Opsional | AI provider terakhir |
| `TELEGRAM_BOT_TOKEN` | Opsional | Untuk notifikasi & commands |
| `TELEGRAM_CHAT_ID` | Opsional | Target chat Telegram |
| `BASESCAN_API_KEY` | Tidak diperlukan | Blockscout digunakan (gratis, tanpa key) |

Parameter trading (capital, slippage, TP/SL, dll) dikonfigurasi via UI atau `.replit [userenv]`.

---

## Telegram Commands

`/help`, `/status`, `/balance`, `/candidates`, `/approve <addr>` (→ masuk monitoring), `/reject <addr>`, `/positions`, `/history`, `/blacklist`, `/dailyreport`

**Notifikasi otomatis:** whale masuk monitoring, whale dipromosikan ke copy, trade buy/sell, risk alert (daily loss, consecutive loss, cooldown), laporan P&L harian.

---

## Integrasi Blockscout (On-Chain Monitoring)

Whale monitoring menggunakan **Blockscout API** (`base.blockscout.com/api/v2`) — gratis, tanpa API key, data langsung dari blockchain Base.

| Fungsi | Deskripsi |
|--------|-----------|
| `analyzeWalletOnChain()` | Fetch semua ERC-20 transfers sejak `monitoredSince`, FIFO matching buy↔sell, hitung realized PnL |
| `fetchRecentTrades()` | Fetch 10 tx ERC-20 terbaru untuk live feed (tanpa cache, selalu fresh) |
| `resetWalletCache()` | Hapus cursor cache wallet → rescan dari awal |
| Cursor cache | Per-wallet cursor (`next_page_params`) — polling incremental, tidak re-fetch dari genesis |
| Filter | Stablecoins (USDC, USDT, USDbC, DAI, EURC) dan WETH dibuang dari feed (noise) |

---

## Perbaikan & Peningkatan

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
| 12 | `basescan-monitor.ts` | Basescan V1 deprecated, Etherscan V2 butuh plan berbayar | Migrasi ke Blockscout (gratis) |

### Peningkatan AI & Trading

| # | Fitur | Deskripsi |
|---|-------|-----------|
| 1 | **Dynamic Exit** | `dynamic-exit.ts` dipakai di `swap-executor.ts` position monitor |
| 2 | **AI Token Prompt** | ETH price live, sinyal baru: priceChangeH1, buyTxH1, sellTxH1, fdvUsd |
| 3 | **AI Response Cache** | Cache 30 detik untuk token analysis — kurangi latency & rate limit |
| 4 | **Whale Correlation** | +0-20% copy size saat 2+ whale beli token sama dalam 10 menit |
| 5 | **Rule-based Scoring** | Sinyal baru + hard gate untuk filter token buruk |
| 6 | **analyzeWallet** | Prompt bahasa Indonesia, JSON-only, regex extract, fallback ke Groq dulu |
| 7 | **shouldBuy threshold** | `predictedProfit` threshold dinamis: 10/15/20% sesuai confidence AI |
| 8 | **getEthPriceSync()** | Fungsi baru di `performance-optimizer.ts` untuk akses ETH price secara sync |

### Fitur Baru

| Fitur | Modul | Deskripsi |
|-------|-------|-----------|
| **Backtest Engine** | `backtest-engine.ts` + `Backtest.tsx` | Replay OHLCV historis — simulasi profit ladder TP, trailing stop, fixed SL |
| **Token Safety Full** | `token-safety.ts` + `TokenSafetyBadge.tsx` | GoPlus Labs + Honeypot.is: honeypot, buy/sell tax, owner renounced, lock LP |
| **Whale Correlator** | `whale-correlator.ts` | Deteksi koordinasi whale — rekam buy events, beri bonus copy size |
| **Web Push Notifikasi** | `push-manager.ts` + `PushNotification.tsx` | Browser push untuk buy/sell/TP/SL/whale events — tanpa buka dashboard |
| **Daily Report Dashboard** | `DailyReport.tsx` + `/api/report` | Chart P&L 14 hari, win rate per hari, best/worst trade, ETH balance |
| **Mini Chart** | `MiniChart.tsx` + `/api/chart/:token` | Candlestick OHLCV inline untuk token tertentu |
| **Blockscout Live Feed** | `basescan-monitor.ts` + `WalletMonitorPage.tsx` | 10 tx ERC-20 terbaru per wallet — BUY/SELL badge, auto-refresh 30 detik |
| **Emergency Stop** | `/api/emergency-stop` | Hentikan semua scanner + jual semua posisi sekaligus |
| **Narrative Detector** | `/api/narrative/check` | AI deteksi narasi token (AI/RWA/meme/DeFi/gaming) dari nama & simbol |
| **Force Promote** | `/api/whale/force-promote/:addr` | Promosikan whale ke copy list tanpa menunggu persetujuan AI |
| **Rescan Wallet** | `/api/whale/rescan/:addr` | Reset cursor cache + rescan wallet dari awal via Blockscout |

### Peningkatan Telegram

- Notifikasi buy kaya: token name, harga ETH, USD value, sumber whale, confidence AI
- Notifikasi take-profit: hold time, multiplier, level TP
- Notifikasi stop-loss: hold time, peak multiplier, alasan
- Notifikasi risk alert: detail tipe (daily loss / consecutive / cooldown)
- Notifikasi whale waitlist: skor, WR, profit estimasi dengan format rich

---

## User Preferences

- Semua API key dikelola via Replit Secrets atau in-app UI — jangan hardcode
- Jangan commit `.env` dengan key asli
- Bahasa Indonesia untuk UI dan pesan pengguna
- On-chain data menggunakan Blockscout (gratis, tanpa API key) — tidak perlu BASESCAN_API_KEY
