# Base Sniper Ultimate

Automated crypto trading bot for the **Base network** (ETH L2), built for small capital (≈ 0.006 ETH). Combines real-time mempool scanning, smart token screening, whale copy-trading, AI-powered token analysis, and an auto-resume risk manager — all in one password-protected dashboard.

---

## Features

| Feature | Description |
|---|---|
| **Flashblocks Scanner** | Listens to Uniswap V3 `PoolCreated` events via WebSocket. Catches new tokens within seconds of launch |
| **GeckoTerminal Token Scanner** | Independent scanner polling GeckoTerminal new/trending pools every 30 s — works even without mempool access |
| **Smart Screener** | Parallel independent screener: scores every token 0–100 using momentum, activity, safety, and freshness signals. Configurable threshold and scan interval. Signal history persisted to SQLite (last 500 entries) and browsable in the Histori tab |
| **Whale Copy Trading** | Monitors approved whale wallets via Blockscout; copies their buys with P&L simulation gate and AI wallet-score check |
| **Whale Auto-Finder** | Scans trending pools, evaluates top traders (win rate, profit, trade count, recency), sends Telegram notification for manual approval |
| **Whale Correlation Map** | Dashboard tab showing live multi-whale correlation signals: when 2+ approved whales buy the same token within 10 minutes, a confidence-scored card appears with per-whale buy details. Auto-refreshes every 10 s |
| **Whale Correlator** | Detects when multiple approved whales buy the same token within a short window — boosts copy trade size proportionally |
| **Whale Monitor** | Background on-chain service polling whale wallet activity every 10 min via Blockscout API |
| **Deployer Reputation Checker** | Dashboard tab with address input: enter any token or deployer address to see a reputation score (0–100), survival rate of previous tokens, and per-token alive/dead status with liquidity |
| **P&L Simulation Gate** | Estimates expected profit/risk before every copy trade; blocks HIGH-risk low-reward trades automatically |
| **AI Token Analysis** | Three-provider fallback chain: Groq (primary, ~88 ms) → Gemini → HuggingFace. Scores confidence 0–100 before any buy |
| **Dynamic Position Sizing** | Trade size auto-scales with wallet balance × AI confidence multiplier (0.6×–1.5×) |
| **Auto Cooldown Risk Manager** | Daily loss limit triggers a timed cooldown (configurable hours) — bot resumes automatically. Consecutive losses trigger 30-minute cooldown. Only Emergency Stop is permanent |
| **Copy Trade Cooldown Bypass** | Copy trade ignores screener cooldowns — whale signals are independent. Only Emergency Stop halts copy trades |
| **Dynamic Exit (Trailing SL)** | Activates after 50% profit; sells if price drops 12% from peak. Laddered TP1/TP2 with configurable multipliers and percentages |
| **Backtest Engine** | Replay historical GeckoTerminal data against current filter settings to estimate win rate and expected PnL |
| **Trade History CSV Export** | Download button on the Histori tab exports all closed trades to a well-formatted CSV file (symbol, entry ETH, profit %, hold time, TX hash, etc.) |
| **Deployer Reputation Check** | Scores token deployers by survival rate of previous contracts — flags serial ruggers |
| **Honeypot Detection** | GoPlus Security API check before every buy — blocks honeypots, high sell tax, suspicious ownership |
| **Real-time OHLCV Chart** | Per-position inline price chart (SVG, 5-min candles, 30 s refresh) with entry-price reference line |
| **Live Mempool Gauge** | Overview widget showing current Base Network mempool pressure, status, colour-coded bar, and 30-point sparkline |
| **Telegram Bot Interface** | Full command interface: trade alerts, whale approvals, P&L simulation results, daily report, emergency stop |
| **Web Push Notifications** | Browser push for trade events — works on mobile even when dashboard is closed |
| **Daily P&L Report** | Auto-generated report at midnight UTC: win rate, total PnL, fees, best/worst trade |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend  (React + Vite)                                           │
│  artifacts/base-sniper/                                             │
│  Dashboard · PositionCard · SmartScreener · WhaleCorrelation        │
│  Portfolio · Backtest · PnLChart · TradeHistory · DailyReport       │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ REST API  /api/*
┌───────────────────────────▼─────────────────────────────────────────┐
│  API Server  (Express + TypeScript, port 5000)                      │
│  artifacts/api-server/                                              │
│                                                                     │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────────┐  │
│  │FlashblocksScanner│  │GeckoTokenScanner│  │SmartScreener       │  │
│  │(WebSocket → Base)│  │(REST, 30s poll) │  │(score 0–100, 20s)  │  │
│  └────────┬─────────┘  └───────┬─────────┘  └────────┬───────────┘  │
│           └───────────────────┬┘                    │              │
│                               ▼                     │              │
│  ┌──────────────────────────────────────────────────▼───────────┐  │
│  │               AISniperBot (core orchestrator)                 │  │
│  │  MultiAIProvider ──► MicroCapRiskManager ──► SwapExecutor    │  │
│  │  CopyTradeMonitor ──► WhaleCorrelator ──► SimulationGate     │  │
│  │  WhaleFinder ──► WhaleMonitor ──► TelegramBot                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  External APIs                                                      │
│  ├─ GeckoTerminal   (price data, pools, OHLCV)                     │
│  ├─ Blockscout Base (txs, token holders, deployer info)            │
│  ├─ GoPlus Security (honeypot / tax check)                         │
│  ├─ Groq / Gemini / HuggingFace (AI analysis)                     │
│  └─ Telegram Bot API (notifications + commands)                    │
└─────────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  Base Mainnet (chain ID 8453)                                       │
│  Uniswap V3 Router:  0x2626664c2603336E57B271c5C0b26F421741e481    │
│  Uniswap V3 Factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD    │
│  WETH:               0x4200000000000000000000000000000000000006    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start — Replit

1. Fork / import this repo into Replit.
2. Go to **Secrets** and add:
   - `APP_PASSWORD` — dashboard login password (required)
   - `PRIVATE_KEY` — EVM wallet private key, no `0x` prefix (required for live trading)
3. Click **Run** — the `Backend API` workflow starts automatically.
4. Open the preview URL and log in with your `APP_PASSWORD`.

---

## VPS Installation Guide

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 10 GB SSD | 20 GB SSD |
| Network | 100 Mbit | 1 Gbit |

### 1 — Update the system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential ufw
```

### 2 — Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v20.x.x
npm -v
```

### 3 — Install PM2 (process manager)

PM2 keeps the bot running after SSH disconnect and restarts it automatically on crashes or reboots.

```bash
sudo npm install -g pm2
```

### 4 — Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/base-sniper-ultimate.git
cd base-sniper-ultimate
```

### 5 — Install dependencies

```bash
# Backend
cd artifacts/api-server && npm install

# Frontend
cd ../base-sniper && npm install && cd ../..
```

### 6 — Build both projects

```bash
# Backend (TypeScript → JavaScript)
cd artifacts/api-server && npm run build

# Frontend (React → static files served by the backend)
cd ../base-sniper && npm run build && cd ../..
```

### 7 — Configure environment variables

```bash
nano artifacts/api-server/.env
```

Minimum required variables:

```env
# ─── Required ───────────────────────────────────────────────────────────────
APP_PASSWORD=your_secure_dashboard_password
PRIVATE_KEY=your_wallet_private_key_without_0x_prefix

# ─── Optional: AI providers (at least one recommended) ───────────────────────
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
HUGGINGFACE_API_KEY=hf_...

# ─── Optional: Telegram notifications ────────────────────────────────────────
TELEGRAM_BOT_TOKEN=123456:ABC-...
TELEGRAM_CHAT_ID=your_chat_id

# ─── Optional: Custom RPC (improves speed & reliability) ─────────────────────
BASE_HTTP_URL=https://mainnet.base.org
BASE_WSS_URL=wss://base.drpc.org
BACKUP_HTTP_URL=https://base.llamarpc.com
BACKUP_WSS_URL=wss://base-rpc.publicnode.com

# ─── Optional: Basescan API (whale analysis) ──────────────────────────────────
BASESCAN_API_KEY=your_basescan_api_key

# ─── Optional: Port & feature flags ──────────────────────────────────────────
PORT=5000
SMART_SCREENER_ENABLED=false
GECKO_SCANNER_ENABLED=false
COPY_TRADING_ENABLED=false
AI_ENABLED=true
```

> **Security:** Never commit `.env` to git. Add it to `.gitignore` before your first push.

### 8 — Start with PM2

```bash
cd artifacts/api-server
pm2 start supervisor.js --name "base-sniper"
pm2 save
pm2 startup   # run the printed command to enable auto-start on boot
```

Check logs:

```bash
pm2 logs base-sniper --lines 50
pm2 status
```

### 9 — Firewall (UFW)

If using Nginx (recommended), only expose 80/443:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

If exposing the bot port directly (not recommended for production):

```bash
sudo ufw allow 5000/tcp
```

### 10 — Nginx reverse proxy (recommended)

Install Nginx:

```bash
sudo apt install -y nginx
```

Create a site config (replace `your-domain.com` with your domain or VPS IP):

```bash
sudo nano /etc/nginx/sites-available/base-sniper
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;

        # WebSocket support (live dashboard push events)
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/base-sniper /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 11 — SSL/TLS with Certbot (HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot automatically updates the Nginx config and sets up auto-renewal. Test renewal:

```bash
sudo certbot renew --dry-run
```

### 12 — Verify

```bash
pm2 status
sudo systemctl status nginx
curl -s http://localhost:5000/api/deployment-status | python3 -m json.tool
```

Open `https://your-domain.com` and log in with your `APP_PASSWORD`.

---

## Update / Redeploy

```bash
cd base-sniper-ultimate
git pull

cd artifacts/api-server  && npm install && npm run build
cd ../base-sniper         && npm install && npm run build
cd ../..

pm2 restart base-sniper
pm2 logs base-sniper --lines 30
```

---

## Database

The bot uses SQLite via `sql.js` (pure JavaScript — no native compilation needed).

- **Location:** `artifacts/base-sniper/base.db`
- **Auto-saved** to disk every 5 seconds.
- **Backup:** `cp artifacts/base-sniper/base.db base.db.bak`
- Trade history, copy wallets, whale candidates, screener config, and runtime settings are all stored here.
- Settings saved in the DB take priority over `.env` at startup.

To reset to defaults: delete `base.db` and `trading-config.json`, then restart PM2.

---

## Configuration Reference

All settings are changeable live from the **Settings modal** — no restart needed.

### Core Trading

| Variable | Default | Description |
|---|---|---|
| `PRIVATE_KEY` | — | Wallet private key, no `0x` (required for live trading) |
| `APP_PASSWORD` | — | Dashboard access password |
| `TOTAL_CAPITAL_ETH` | `0.006` | Total capital reference for position sizing |
| `MAX_TRADE_AMOUNT` | `0.0006` | Maximum ETH per single trade |
| `MAX_SLIPPAGE_PERCENT` | `8` | Uniswap V3 slippage tolerance |
| `MAX_OPEN_POSITIONS` | `3` | Maximum simultaneous open positions |
| `MAX_HOLD_MINUTES` | `30` | Force-exit stale positions after this many minutes |
| `DYNAMIC_SIZING_ENABLED` | `true` | Scale trade size with balance and AI confidence |
| `TRADE_BALANCE_PCT` | `10` | % of balance used per trade (dynamic sizing) |

### Exit Strategy

| Variable | Default | Description |
|---|---|---|
| `TAKE_PROFIT_1_MULTIPLIER` | `1.3` | TP1 price target (×) |
| `TAKE_PROFIT_1_PERCENTAGE` | `50` | % of position to sell at TP1 |
| `TAKE_PROFIT_2_MULTIPLIER` | `2.5` | TP2 price target (×) |
| `TAKE_PROFIT_2_PERCENTAGE` | `50` | % of position to sell at TP2 |
| `STOP_LOSS_PERCENTAGE` | `15` | Stop loss at −15% |

### Risk Manager

The bot never hard-stops on daily loss. It pauses for a configurable cooldown and resumes automatically. Emergency Stop (🚨 header button) is the only permanent halt.

| Variable | Default | Description |
|---|---|---|
| `MAX_DAILY_LOSS_ETH` | `0.0015` | Trigger cooldown when daily loss exceeds this |
| `DAILY_LOSS_COOLDOWN_HOURS` | `2` | Hours to pause before auto-resume |
| `MAX_CONSECUTIVE_LOSSES` | `3` | Trigger 30-min cooldown after this many losses in a row |
| `COOLDOWN_AFTER_PROFIT_MINUTES` | `15` | Pause after a large profit (let gains settle) |

### Gas (Base L2)

> Base L2 gas is ~100× cheaper than Ethereum mainnet. Do not use Ethereum-calibrated values.

| Variable | Default | Description |
|---|---|---|
| `GAS_MODE` | `auto` | `auto` reads network fee; `economy` caps at configured values |
| `MAX_PRIORITY_FEE_GWEI` | `0.005` | Miner tip (Base typical: 0.001–0.005 gwei) |
| `MAX_FEE_PER_GAS_GWEI` | `0.05` | Max total fee per gas unit |

A full Uniswap V3 swap on Base costs ≈ 150,000 gas × 0.005 gwei ≈ **$0.002**.

### AI Providers

| Key | Notes |
|---|---|
| `GROQ_API_KEY` | Primary. Free at [console.groq.com](https://console.groq.com). Latency ~88 ms. Model: `llama-3.3-70b-versatile` |
| `GEMINI_API_KEY` | Secondary. Free at [aistudio.google.com](https://aistudio.google.com). Model: `gemini-2.0-flash` |
| `HUGGINGFACE_API_KEY` | Fallback. Free at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). Model: `Llama-3.1-8B-Instruct` |

At least one key is required for AI filtering. Without any, the bot defaults to conservative rule-based `HOLD`.

### Token Safety

| Variable | Default | Description |
|---|---|---|
| `BLOCK_HONEYPOT` | `true` | Reject honeypot tokens (GoPlus) |
| `BLOCK_HIGH_TAX` | `true` | Reject tokens with sell tax above threshold |
| `MAX_TAX_PERCENT` | `15` | Maximum allowed buy/sell tax |
| `MIN_SAFETY_SCORE` | `72` | Minimum GoPlus safety score (0–100) |
| `MAX_POOL_AGE_SECONDS` | `300` | Reject tokens older than this |
| `SERIAL_RUGGER_ENABLED` | `true` | Check deployer's previous contract survival rate |
| `SERIAL_RUGGER_MAX_DEPLOYS` | `2` | Max rug count before flagging deployer |
| `SERIAL_RUGGER_WINDOW_HOURS` | `24` | Look-back window for serial rugger check |
| `REPUTATION_ENABLED` | `true` | Check deployer reputation score |
| `REPUTATION_MIN_SCORE` | `40` | Minimum deployer reputation (0–100) |

### Copy Trading

| Variable | Default | Description |
|---|---|---|
| `COPY_ENABLED` | `false` | Enable copy trading |
| `COPY_AMOUNT` | `0.0003` | Base ETH per copy trade |
| `COPY_DELAY` | `2` | Seconds to wait after whale tx before copying |
| `COPY_MAX_PER_DAY` | `10` | Max copy trades per day |

### Telegram Notifications

1. Message [@BotFather](https://t.me/botfather) → `/newbot` → copy the token
2. Message [@userinfobot](https://t.me/userinfobot) → copy your Chat ID
3. Set in `.env` or via the Settings modal:

```env
TELEGRAM_BOT_TOKEN=123456789:AAF...
TELEGRAM_CHAT_ID=987654321
```

Alerts sent for: new trades (buy/TP/SL), whale candidates (approve/reject buttons), P&L simulation blocks, daily report, screener signals, cooldown events.

---

## API Endpoints

All endpoints on `http://localhost:5000`. Protected endpoints require `Authorization: Bearer <session-token>` (obtained from `/api/auth/verify`).

### Auth & Status

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/verify` | Password login → returns session token |
| `GET` | `/api/status` | Bot status, WebSocket health, AI provider state |
| `GET` | `/api/config` | Current runtime configuration (includes `smartScreenerEnabled`) |
| `GET` | `/api/logs` | Activity log (last 100 entries) |
| `GET` | `/api/eth-price` | Current ETH/USD price |
| `GET` | `/api/risk` | Risk manager state (cooldown, daily loss, streak) |

### Bot Control

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/settings` | Update all runtime settings live (no restart) |
| `PATCH` | `/api/config` | Partial config update |
| `POST` | `/api/keys` | Update API keys and wallet private key |
| `POST` | `/api/emergency-stop` | Trigger emergency stop (manual reset required) |
| `POST` | `/api/telegram/test` | Send a test Telegram message |

### Trading

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/positions` | Open positions with live PnL |
| `GET` | `/api/portfolio` | Full portfolio (ETH balance + token holdings) |
| `GET` | `/api/pnl` | Live profit/loss summary |
| `GET` | `/api/history` | Closed trade history + win rate stats |
| `GET` | `/api/history/export.csv` | Download all closed trades as CSV |
| `POST` | `/api/sell` | Manual sell `{ tokenAddress, percent }` |
| `POST` | `/api/buy` | Manual buy `{ tokenAddress, amountEth }` |
| `POST` | `/api/backtest` | Simulate strategy on historical OHLCV data |

### Smart Screener

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/screener/signals` | Latest token signals with scores |
| `GET` | `/api/screener/stats` | Screener performance stats |
| `GET` | `/api/screener/config` | Current screener config |
| `POST` | `/api/screener/config` | Update screener settings |
| `POST` | `/api/screener/toggle` | Enable / disable screener |
| `GET` | `/api/screener/history` | Persisted signal history (query: `?signal=STRONG_BUY&limit=100`) |

### Whale Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/wallets` | List copy-trade whale wallets |
| `POST` | `/api/wallets` | Add wallet `{ address, name }` |
| `DELETE` | `/api/wallets/:address` | Remove wallet |
| `PATCH` | `/api/wallets/:address/toggle` | Enable / disable wallet |
| `PATCH` | `/api/wallets/:address/rename` | Rename wallet |
| `GET` | `/api/whale/pending` | Pending candidates awaiting approval |
| `GET` | `/api/whale/all` | All whale candidates |
| `POST` | `/api/whale/scan` | Trigger manual whale scan |
| `POST` | `/api/whale/approve` | Approve candidate → add to copy list |
| `POST` | `/api/whale/reject` | Reject candidate |
| `GET` | `/api/whale/detail/:address` | Detailed on-chain stats for a wallet |
| `GET` | `/api/whale/correlation` | Live multi-whale correlation map |

### Utilities

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/safety/:address` | Full token safety check (GoPlus + Honeypot.is) |
| `GET` | `/api/reputation/:address` | Deployer reputation score |
| `GET` | `/api/mempool` | Current mempool pressure |
| `GET` | `/api/report` | Structured P&L report (last 14 days) |
| `GET` | `/api/daily-report` | Text P&L report (Telegram format) |
| `GET` | `/api/deployment-status` | Server uptime, version, environment |

---

## Security Notes

- `PRIVATE_KEY` is never written to any file by the bot — it must come from `.env` or a Replit Secret.
- The dashboard uses HMAC session tokens with a 12-hour TTL — no persistent cookies.
- Login attempts are rate-limited to 20 per minute per IP.
- All `/api/*` routes except `/api/auth/verify` require a valid session token.
- For production: always use HTTPS (Certbot). Do not expose port 5000 directly.

---

## Project Structure

```
.
├── README.md
└── artifacts/
    ├── api-server/                       # Express + TypeScript backend
    │   ├── src/
    │   │   ├── index.ts                  # All REST endpoints + auth middleware
    │   │   ├── ai-sniper-integration.ts  # Core orchestrator (AISniperBot class)
    │   │   ├── microcap-risk-manager.ts  # Auto cooldown, daily loss, consecutive loss
    │   │   ├── swap-executor.ts          # Uniswap V3/Aerodrome trades + TP/SL loop
    │   │   ├── dynamic-exit.ts           # Trailing stop loss logic
    │   │   ├── smart-screener.ts         # Independent token screener (score 0–100)
    │   │   ├── flashblocks-scanner.ts    # WebSocket mempool scanner
    │   │   ├── gecko-token-scanner.ts    # GeckoTerminal REST scanner
    │   │   ├── copy-trade-monitor.ts     # Whale wallet monitoring + copy execution
    │   │   ├── whale-finder.ts           # Auto whale discovery + approval gate
    │   │   ├── whale-analyzer-pro.ts     # Advanced wallet scoring
    │   │   ├── whale-correlator.ts       # Multi-whale token correlation boost
    │   │   ├── whale-monitor.ts          # Background on-chain whale activity poll
    │   │   ├── multi-ai-provider.ts      # Groq → Gemini → HuggingFace AI chain
    │   │   ├── token-safety.ts           # GoPlus honeypot / tax check
    │   │   ├── deployer-reputation.ts    # Token survival rate scorer
    │   │   ├── price-oracle.ts           # GeckoTerminal price + OHLCV
    │   │   ├── telegram-bot.ts           # Bot command interface + trade alerts
    │   │   ├── push-manager.ts           # Web Push notification service
    │   │   ├── backtest-engine.ts        # Historical strategy simulation
    │   │   └── db.ts                     # sql.js (SQLite) schema + queries
    │   ├── supervisor.js                 # Process supervisor (auto-restart on crash)
    │   ├── trading-config.json           # Persisted non-secret settings
    │   └── package.json
    └── base-sniper/                      # React + Vite frontend
        ├── src/
        │   ├── App.tsx                   # Auth gate + tab layout
        │   ├── components/
        │   │   ├── Dashboard.tsx         # Live stats, cooldown widget, activity log
        │   │   ├── PositionCard.tsx       # Open position with live PnL + chart
        │   │   ├── MiniChart.tsx          # SVG OHLCV sparkline
        │   │   ├── SettingsModal.tsx      # All config (trading, risk, AI, whale, gas)
        │   │   ├── SmartScreener.tsx      # Screener signals UI + history panel
        │   │   ├── WhaleCorrelation.tsx   # Whale Correlation Map tab
        │   │   ├── DeployerRepCheck.tsx   # Deployer Reputation Checker tab
        │   │   ├── MempoolGauge.tsx       # Live mempool pressure widget
        │   │   ├── WhaleLeaderboard.tsx   # Approved whale wallet performance table
        │   │   ├── VettedWalletsPage.tsx  # Manage monitored whale wallets
        │   │   ├── Portfolio.tsx          # Wallet balance + token holdings
        │   │   ├── Backtest.tsx           # Backtest UI
        │   │   ├── PnLChart.tsx           # Historical P&L graph
        │   │   ├── TradeHistory.tsx       # Closed trade log with filters + CSV export
        │   │   └── LoginGate.tsx          # Password auth screen
        │   └── hooks/useSniper.ts         # All API polling hooks
        └── package.json
```

---

## Troubleshooting

**Bot not starting:**
```bash
pm2 logs base-sniper --lines 100
```

**Port already in use:**
```bash
sudo lsof -i :5000
pm2 delete base-sniper
pm2 start artifacts/api-server/supervisor.js --name base-sniper
```

**Frontend shows blank page:**
```bash
ls artifacts/base-sniper/dist/   # must contain index.html
cd artifacts/base-sniper && npm run build
pm2 restart base-sniper
```

**Database locked or corrupt:**
```bash
cp artifacts/base-sniper/base.db artifacts/base-sniper/base.db.bak
rm artifacts/base-sniper/base.db
pm2 restart base-sniper
```

**Copy trades not executing:**
- Check that Copy Trading is enabled in Settings.
- Verify at least one copy wallet is added and toggled active.
- The detection window is 60 seconds — trades are only copied if Blockscout responds within that window.

**Smart Screener toggle resets after saving config:**
- Fixed in this build — the Smart Screener now has its own independent `smartScreenerEnabled` flag, completely separate from the GeckoTerminal scanner toggle.

---

## License

MIT — use at your own risk. Crypto trading involves substantial financial risk. This software does not guarantee profits.
