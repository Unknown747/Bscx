# Base Sniper Ultimate

Automated crypto trading bot for the **Base network** (ETH L2), built for small capital (≈ Rp 100.000 / ~$6 / 0.006 ETH). Combines real-time mempool scanning, smart token screening, whale copy-trading, AI-powered token analysis, and an auto-resume risk manager — all in one password-protected dashboard.

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
| **Trade History CSV Export** | Download button on the Histori tab exports all closed trades to a well-formatted CSV file (symbol, entry ETH, profit %, hold time, TX hash, etc.) for spreadsheet analysis or tax reporting |
| **Deployer Reputation Check** | Scores token deployers by survival rate of previous contracts — flags serial ruggers. Also accessible via `GET /api/reputation/:address` |
| **Honeypot Detection** | GoPlus Security API check before every buy — blocks honeypots, high sell tax, suspicious ownership |
| **Real-time OHLCV Chart** | Per-position inline price chart (SVG, 5-min candles, 30 s refresh) with entry-price reference line |
| **Live Mempool Gauge** | Overview widget showing current Base Network mempool pressure (pending tx count), status (Quiet / Normal / Congested), a colour-coded progress bar, and a 30-point sparkline. Refreshes every 8 s |
| **Telegram Bot Interface** | Full command interface: trade alerts, whale approvals (approve/reject buttons), P&L simulation results, daily report, emergency stop |
| **Web Push Notifications** | Browser push for trade events — works on mobile even when dashboard is closed |
| **Daily P&L Report** | Auto-generated report at midnight UTC: win rate, total PnL, fees, best/worst trade |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend  (React + Vite, port 5000)                                │
│  artifacts/base-sniper/                                             │
│  ┌───────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────────────┐ │
│  │ Dashboard │ │PositionCard│ │SettingsModal│ │WhaleLeaderboard  │ │
│  │(PnL,logs) │ │+ MiniChart │ │ (all config)│ │VettedWalletsPage │ │
│  └───────────┘ └────────────┘ └─────────────┘ └──────────────────┘ │
│  ┌───────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────────────┐ │
│  │ Backtest  │ │ Portfolio  │ │PnLChart     │ │SmartScreener UI  │ │
│  └───────────┘ └────────────┘ └─────────────┘ └──────────────────┘ │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────┐ │
│  │WhaleCorrelation  │ │DeployerRepCheck  │ │MempoolGauge          │ │
│  │(Korelasi tab)    │ │(Deployer tab)    │ │(Overview widget)     │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ REST API (axios proxy → :8080)
┌───────────────────────────▼─────────────────────────────────────────┐
│  API Server  (Express + TypeScript, port 8080)                      │
│  artifacts/api-server/                                              │
│                                                                     │
│  ┌──────────────────┐  ┌────────────────┐  ┌────────────────────┐  │
│  │FlashblocksScanner│  │GeckoTokenScanner│  │SmartScreener       │  │
│  │(WebSocket → Base)│  │(REST, 30s poll) │  │(score 0–100, 20s)  │  │
│  └────────┬─────────┘  └───────┬────────┘  └────────┬───────────┘  │
│           └───────────────────┬┘                    │              │
│                               ▼                     │              │
│  ┌──────────────────────────────────────────────────▼───────────┐  │
│  │               AISniperBot (core orchestrator)                 │  │
│  │                                                               │  │
│  │  MultiAIProvider ──► MicroCapRiskManager ──► SwapExecutor    │  │
│  │  CopyTradeMonitor ──► WhaleCorrelator ──► SimulationGate     │  │
│  │  WhaleFinder ──► WhaleMonitor ──► TelegramBot                │  │
│  │  BacktestEngine ──► DynamicExit ──► PushManager              │  │
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

## Project Structure

```
.
├── .env.example                          # Environment variable template
├── README.md
└── artifacts/
    ├── api-server/                       # Express + TypeScript backend
    │   ├── src/
    │   │   ├── index.ts                  # All REST endpoints + auth middleware
    │   │   ├── ai-sniper-integration.ts  # Core orchestrator (AISniperBot class)
    │   │   ├── microcap-risk-manager.ts  # Auto cooldown, daily loss, consecutive loss
    │   │   ├── swap-executor.ts          # Uniswap V3 trades + TP/SL position loop
    │   │   ├── dynamic-exit.ts           # Trailing stop loss logic
    │   │   ├── smart-screener.ts         # Independent token screener (score 0–100)
    │   │   ├── flashblocks-scanner.ts    # WebSocket mempool scanner
    │   │   ├── gecko-token-scanner.ts    # GeckoTerminal REST scanner
    │   │   ├── copy-trade-monitor.ts     # Whale wallet monitoring + copy execution
    │   │   ├── whale-finder.ts           # Auto whale discovery + approval gate
    │   │   ├── whale-analyzer-pro.ts     # Advanced wallet scoring
    │   │   ├── whale-correlator.ts       # Multi-whale token correlation boost
    │   │   ├── whale-monitor.ts          # Background on-chain whale activity poll
    │   │   ├── basescan-monitor.ts       # Base chain monitoring utilities
    │   │   ├── multi-ai-provider.ts      # Groq → Gemini → HuggingFace AI chain
    │   │   ├── token-safety.ts           # GoPlus honeypot / tax check
    │   │   ├── deployer-checker.ts       # Deployer contract-creation history
    │   │   ├── deployer-reputation.ts    # Token survival rate scorer
    │   │   ├── price-oracle.ts           # GeckoTerminal price + OHLCV
    │   │   ├── telegram-bot.ts           # Bot command interface + trade alerts
    │   │   ├── push-manager.ts           # Web Push notification service
    │   │   ├── backtest-engine.ts        # Historical strategy simulation
    │   │   ├── performance-optimizer.ts  # Runtime performance tuning
    │   │   ├── config-store.ts           # Persistent settings helpers
    │   │   └── db.ts                     # sql.js (SQLite) schema + queries
    │   ├── supervisor.js                 # Process supervisor (auto-restart)
    │   ├── trading-config.json           # Persisted non-secret settings
    │   └── package.json
    └── base-sniper/                      # React + Vite frontend
        ├── src/
        │   ├── App.tsx                   # Auth gate + tab layout
        │   ├── components/
        │   │   ├── Dashboard.tsx         # Live stats, auto-cooldown widget, activity log
        │   │   ├── PositionCard.tsx       # Open position with live PnL + chart toggle
        │   │   ├── MiniChart.tsx          # SVG OHLCV sparkline (no external lib)
        │   │   ├── SettingsModal.tsx      # All config (trading, risk, AI, whale, gas)
        │   │   ├── SmartScreener.tsx      # Screener signals UI + signal history panel
        │   │   ├── WhaleCorrelation.tsx   # Whale Correlation Map tab (new)
        │   │   ├── DeployerRepCheck.tsx   # Deployer Reputation Checker tab (new)
        │   │   ├── MempoolGauge.tsx       # Live mempool pressure widget (new)
        │   │   ├── WhaleLeaderboard.tsx   # Approved whale wallet performance table
        │   │   ├── VettedWalletsPage.tsx  # Manage monitored whale wallets
        │   │   ├── WalletMonitorPage.tsx  # Live whale on-chain activity
        │   │   ├── WhaleDetailModal.tsx   # Detailed whale wallet stats
        │   │   ├── CopyWalletsModal.tsx   # Copy wallet management
        │   │   ├── Portfolio.tsx          # Wallet balance + token holdings
        │   │   ├── Backtest.tsx           # Backtest UI
        │   │   ├── PnLChart.tsx           # Historical P&L graph
        │   │   ├── TradeHistory.tsx       # Closed trade log with filters + CSV export button
        │   │   ├── DailyReport.tsx        # Daily P&L report view
        │   │   ├── ActivityLog.tsx        # Real-time event log
        │   │   ├── BlacklistModal.tsx     # Token blacklist management
        │   │   ├── DeployerCard.tsx       # Deployer reputation card
        │   │   ├── TokenSafetyBadge.tsx   # GoPlus safety indicator
        │   │   ├── PushNotification.tsx   # Web push subscription UI
        │   │   ├── LoginGate.tsx          # Password auth screen
        │   │   └── WalletConfigModal.tsx  # Wallet address + key config
        │   └── hooks/useSniper.ts         # All API polling hooks
        └── package.json
```

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- A Base mainnet wallet with ≥ 0.006 ETH (≈ Rp 100.000)
- At least one AI API key (Groq recommended — free at [console.groq.com](https://console.groq.com))

### 2. Clone & Install

```bash
git clone https://github.com/your-username/base-sniper-ultimate.git
cd base-sniper-ultimate

# Backend
cd artifacts/api-server && npm install

# Frontend
cd ../base-sniper && npm install
```

### 3. Configure

```bash
cp .env.example artifacts/api-server/.env
```

Open `artifacts/api-server/.env` and fill in at minimum:

```env
PRIVATE_KEY=0xYOUR_WALLET_PRIVATE_KEY
APP_PASSWORD=your_strong_password
GROQ_API_KEY=gsk_...
```

### 4. Run

**Terminal 1 — API Server:**
```bash
cd artifacts/api-server
npm run dev        # compiles TypeScript + starts Express on :8080
```

**Terminal 2 — Frontend:**
```bash
cd artifacts/base-sniper
npx vite --port 5000 --host   # open http://localhost:5000
```

---

## Configuration Reference

All settings are configurable live via the **Settings modal** in the UI without restarting. The `.env` file and `trading-config.json` set startup defaults.

### Core Trading

| Variable | Default | Description |
|---|---|---|
| `PRIVATE_KEY` | — | Wallet private key (required for live trading) |
| `APP_PASSWORD` | — | Dashboard access password |
| `TOTAL_CAPITAL_ETH` | `0.006` | Total capital reference used for position sizing |
| `MAX_TRADE_AMOUNT` | `0.0006` | Maximum ETH per single trade |
| `MAX_SLIPPAGE_PERCENT` | `15` | Uniswap V3 slippage tolerance |
| `MAX_OPEN_POSITIONS` | `3` | Maximum simultaneous open positions |
| `MAX_HOLD_MINUTES` | `30` | Force-exit stale positions after this many minutes |
| `DYNAMIC_SIZING_ENABLED` | `true` | Scale trade size with balance and AI confidence |
| `TRADE_BALANCE_PCT` | `10` | % of balance used per trade (dynamic sizing) |

### Exit Strategy

| Variable | Default | Description |
|---|---|---|
| `TAKE_PROFIT_1_MULTIPLIER` | `1.2` | TP1 at 1.2× entry (sell 30%) |
| `TAKE_PROFIT_1_PERCENTAGE` | `30` | % of position to sell at TP1 |
| `TAKE_PROFIT_2_MULTIPLIER` | `1.4` | TP2 at 1.4× entry (sell 30%) |
| `TAKE_PROFIT_2_PERCENTAGE` | `30` | % of position to sell at TP2 |
| `STOP_LOSS_PERCENTAGE` | `15` | Stop loss at −15% |
| `DCA_ENABLED` | `false` | Dollar-cost averaging on dips (disabled — gas exceeds benefit at small capital) |

### Auto Cooldown (Risk Manager)

The bot never hard-stops on daily loss. Instead it pauses for a configurable cooldown period and resumes automatically. Emergency Stop (🚨 button in header) is the only permanent halt.

| Variable | Default | Description |
|---|---|---|
| `MAX_DAILY_LOSS_ETH` | `0.0015` | Trigger cooldown when daily loss exceeds this |
| `DAILY_LOSS_COOLDOWN_HOURS` | `2` | Hours to pause after hitting daily loss limit — then auto-resume |
| `MAX_CONSECUTIVE_LOSSES` | `3` | Trigger 30-minute cooldown after this many losses in a row |
| `COOLDOWN_AFTER_BIG_PROFIT_MINUTES` | `15` | Pause after profit > 50% of capital (let gains settle) |

**Copy trade is not affected by screener cooldowns.** Whale signals are independent — only Emergency Stop halts copy trades.

### Gas (Base L2)

> Base L2 gas is ~100× cheaper than Ethereum mainnet. Do not use Ethereum-calibrated values.

| Variable | Default | Description |
|---|---|---|
| `GAS_MODE` | `auto` | `auto` reads actual network fee; `economy` caps at configured values |
| `MAX_PRIORITY_FEE_GWEI` | `0.005` | Miner tip (Base typical: 0.001–0.005 gwei) |
| `MAX_FEE_PER_GAS_GWEI` | `0.05` | Max total fee per gas unit |

A full Uniswap V3 swap on Base costs ≈ 150,000 gas × 0.005 gwei ≈ **$0.002**.

### AI Providers

| Variable | Notes |
|---|---|
| `GROQ_API_KEY` | Primary. Free at [console.groq.com](https://console.groq.com). Latency ~88 ms. Model: `llama-3.3-70b-versatile` |
| `GEMINI_API_KEY` | Secondary. Free at [aistudio.google.com](https://aistudio.google.com). Model: `gemini-2.0-flash` |
| `HUGGINGFACE_API_KEY` | Fallback. Free at [huggingface.co](https://huggingface.co/settings/tokens). Model: `Llama-3.1-8B-Instruct` |

At least one key is required for AI-powered filtering. Without any AI key, the bot defaults to rule-based `HOLD` (conservative — will rarely trade).

### Token Safety

| Variable | Default | Description |
|---|---|---|
| `BLOCK_HONEYPOT` | `true` | Reject honeypot tokens (GoPlus check) |
| `BLOCK_HIGH_TAX` | `true` | Reject tokens with sell tax above threshold |
| `MAX_TAX_PERCENT` | `15` | Maximum allowed buy/sell tax |
| `MIN_SAFETY_SCORE` | `65` | Minimum GoPlus safety score (0–100) |
| `MAX_POOL_AGE_SECONDS` | `60` | Reject tokens older than this (screener freshness) |
| `SERIAL_RUGGER_ENABLED` | `true` | Check deployer's previous contract survival rate |
| `SERIAL_RUGGER_MAX_DEPLOYS` | `3` | Max rug count in window before flagging |
| `SERIAL_RUGGER_WINDOW_HOURS` | `24` | Look-back window for serial rugger check |
| `REPUTATION_ENABLED` | `true` | Check deployer reputation score |
| `REPUTATION_MIN_SCORE` | `25` | Minimum deployer reputation (0–100) |

### Copy Trading

| Variable | Default | Description |
|---|---|---|
| `COPY_ENABLED` | `false` | Enable copy trading |
| `COPY_AMOUNT` | `0.002` | Base ETH per copy trade (dynamic sizing applies on top) |
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

You will receive alerts for: new trades (buy/TP/SL), whale candidates (with approve/reject buttons), P&L simulation blocks, daily P&L report, GeckoTerminal signals, and cooldown events.

---

## API Endpoints

All endpoints on `http://localhost:8080`. Protected endpoints require `Authorization: Bearer <session-token>` (obtained from `/api/auth/verify`).

### Auth & Status

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/verify` | Password login → returns session token |
| `GET` | `/api/status` | Bot status, WebSocket health, AI provider state |
| `GET` | `/api/config` | Current runtime configuration |
| `GET` | `/api/logs` | Activity log (last 100 entries) |
| `GET` | `/api/eth-price` | Current ETH/USD price |
| `GET` | `/api/risk` | Risk manager state (cooldown, daily loss, streak) |

### Bot Control

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/settings` | Update all runtime settings (no restart needed) |
| `POST` | `/api/keys` | Update API keys and wallet private key |
| `POST` | `/api/emergency-stop` | Trigger emergency stop (hard halt, manual reset required) |
| `POST` | `/api/telegram/test` | Send a test Telegram message |

### Trading

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/positions` | Open positions with live PnL |
| `GET` | `/api/portfolio` | Full portfolio (ETH balance + token holdings) |
| `GET` | `/api/pnl` | Live profit/loss summary |
| `GET` | `/api/history` | Closed trade history + win rate stats |
| `GET` | `/api/trades` | Raw trade records |
| `POST` | `/api/sell` | Manual sell `{ tokenAddress, percent }` |
| `POST` | `/api/send` | Send ETH or token `{ to, amount, tokenAddress? }` |
| `POST` | `/api/buy` | Manual buy `{ tokenAddress, amountEth }` |
| `POST` | `/api/backtest` | Simulate strategy on historical data |

### Smart Screener

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/screener/signals` | Latest screener token signals |
| `GET` | `/api/screener/stats` | Screener performance stats |
| `GET` | `/api/screener/config` | Current screener config |
| `POST` | `/api/screener/config` | Update screener settings |
| `POST` | `/api/screener/toggle` | Enable / disable screener |
| `GET` | `/api/screener/history` | Persisted signal history from DB (query: `?signal=STRONG_BUY\|BUY\|WATCH&limit=100`) |

### Whale Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/wallets` | List copy-trade whale wallets |
| `POST` | `/api/wallets` | Add wallet `{ address, name }` |
| `DELETE` | `/api/wallets/:address` | Remove wallet |
| `PATCH` | `/api/wallets/:address/toggle` | Enable / disable wallet |
| `PATCH` | `/api/wallets/:address/rename` | Rename wallet |
| `GET` | `/api/whale/pending` | Pending candidates awaiting approval |
| `GET` | `/api/whale/all` | All whale candidates (pending + approved + rejected) |
| `POST` | `/api/whale/scan` | Trigger manual whale scan now |
| `POST` | `/api/whale/approve` | Approve candidate → add to copy list |
| `POST` | `/api/whale/reject` | Reject candidate permanently |
| `GET` | `/api/whale/detail/:address` | Detailed on-chain stats for a wallet |
| `GET` | `/api/whale/blockscout/:address/trades` | Raw trade history from Blockscout |
| `POST` | `/api/whale/rescan/:address` | Re-score a specific wallet |
| `POST` | `/api/whale/evaluate/:address` | Run AI wallet analysis |
| `POST` | `/api/whale/promote/:address` | Promote candidate to copy list |
| `POST` | `/api/whale/force-promote/:address` | Force-promote without score check |
| `POST` | `/api/whale/monitor` | Add wallet to background monitor |
| `GET` | `/api/whale/monitored` | List background-monitored wallets |
| `DELETE` | `/api/whale/monitored/:address` | Remove from background monitor |
| `GET` | `/api/whale/monitor-status` | Monitor service health |
| `GET` | `/api/whale/correlation` | Active multi-whale token correlations |

### Dashboard Feature Endpoints (New)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/mempool` | Live Base Network mempool size + status (`quiet`/`normal`/`congested`) |
| `GET` | `/api/history/export.csv` | Download all closed trades as CSV file |
| `GET` | `/api/reputation/:address` | Deployer reputation score, survival rate, per-token checks |

### Data & Safety

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/chart/:tokenAddress` | OHLCV candles (5-min, last 40) via GeckoTerminal |
| `GET` | `/api/blacklist` | Blacklisted tokens |
| `POST` | `/api/blacklist` | Add token to blacklist |
| `DELETE` | `/api/blacklist/:address` | Remove from blacklist |
| `POST` | `/api/simulate` | Simulate copy trade P&L `{ walletAddress, tokenAddress }` |
| `GET` | `/api/reputation/:address` | Deployer reputation score |
| `GET` | `/api/safety/:address` | GoPlus token safety report |
| `POST` | `/api/narrative/check` | Check token narrative/hype signals |
| `GET` | `/api/daily-report` | Today's P&L report |
| `GET` | `/api/report` | Extended performance report |
| `GET` | `/api/cache` | Internal cache stats (debug) |

### Web Push

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/push/vapid-key` | VAPID public key for push subscription |
| `GET` | `/api/push/status` | Current push subscription status |
| `POST` | `/api/push/subscribe` | Register push subscription |
| `DELETE` | `/api/push/unsubscribe` | Remove push subscription |

---

## How Each Feature Works

### Auto Cooldown Risk Manager

```
After each trade loss:
  todayLossEth += abs(loss)
  if todayLossEth >= maxDailyLossEth:
    → set cooldown for dailyLossCooldownHours (default: 2h)
    → bot pauses all screener signals
    → resumes automatically when cooldown expires

  if consecutiveLosses >= maxConsecutiveLosses:
    → set cooldown for 30 minutes
    → resets on next win

Copy trade:
  → skips cooldown check entirely
  → only halted by Emergency Stop (🚨 button)

Emergency Stop:
  → hard flag, requires manual reset via UI or API restart
  → halts ALL trading including copy trade
```

### Smart Screener Scoring

Each token is scored out of 100:
- **Momentum** (up to 27): 1h price change, buy/sell ratio
- **Activity** (up to 19): buy count in last hour, volume
- **Safety** (up to 25): GoPlus score, tax check, clean flags
- **Freshness** (up to 16): pool age (newer = higher score)

Threshold ≥ 45 → `WATCH`, ≥ 65 → `BUY`, ≥ 80 → `STRONG_BUY`.

### Whale Copy Trading Flow

```
Blockscout API poll (every 2s)
  → filter: Uniswap exactInputSingle selector (0x414bf389)
  → check: tx within 30s window, not recently seen
  → GoPlus safety check + deployer reputation
  → P&L simulation gate (block if HIGH risk and profit < 10%)
  → AI wallet analysis (score > AUTO_COPY_SCORE_THRESHOLD)
  → Whale correlation check (boost size if multiple whales on same token)
  → Dynamic copy amount = (balance × tradeBalancePct%) × AI multiplier
  → Risk gate: Emergency Stop only (cooldowns bypassed)
  → SwapExecutor.buy()
```

### Auto Whale Finder

Every 15 minutes:
1. Fetch top 5 trending pools from GeckoTerminal
2. Get top 20 holders from Blockscout for each token
3. Score each holder: win rate, avg profit, trade count, recency
4. Filter: win rate ≥ 55%, trades ≥ 8, active within 3 days, score ≥ 60
5. Send Telegram alert with wallet stats + approve/reject buttons
6. Hold in `pending` state until owner decides

### AI Decision Logic

Token data → structured prompt → JSON response:
```json
{
  "recommendation": "BUY",
  "confidence": 87,
  "riskLevel": "MEDIUM",
  "reasoning": "New pool, strong buy pressure, liquidity sufficient"
}
```
Bot only buys if `recommendation == "BUY"` AND `confidence >= minAiConfidence (default 75)` AND `riskLevel != "CRITICAL"`.

### Dynamic Position Sizing

```
base    = balance × (tradeBalancePct / 100)
size    = base × aiMultiplier   (0.6× if confidence < 80, 1.5× if ≥ 90)
size    = clamp(size, 0.001 ETH, balance × 0.30)
```

### Trailing Stop Loss

After position reaches +50% profit: trailing stop activates. If price drops 12% from its post-entry peak, the position is sold regardless of TP levels.

---

## Safety & Risk Warnings

> **This bot trades real money on mainnet. You can lose your entire balance. DeFi trading carries extreme risk — new tokens frequently go to zero within minutes.**

- Never use funds you cannot afford to lose
- The suggested capital is Rp 100.000 (~$6 / 0.006 ETH) — treat it as learning money
- Honeypot detection is not 100% reliable — some malicious tokens bypass GoPlus
- Never share your private key or commit `.env` to version control
- Gas costs on Base are very low (~$0.002/swap) but still reduce returns at tiny capital
- The bot has no access to your funds beyond what is in the configured wallet
- Monitor your wallet on [Basescan](https://basescan.org) for unexpected transactions

---

## On-chain Contracts Used

| Contract | Address | Network |
|---|---|---|
| Uniswap V3 SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` | Base |
| Uniswap V3 Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | Base |
| WETH | `0x4200000000000000000000000000000000000006` | Base |

---

## External Services (All Free Tier)

| Service | Usage | Rate Limit |
|---|---|---|
| [GeckoTerminal](https://www.geckoterminal.com/dex-api) | Price data, pools, OHLCV, trending | ~3 req/s |
| [Blockscout Base](https://base.blockscout.com) | Tx history, holders, deployer info | Generous free tier |
| [GoPlus Security](https://gopluslabs.io) | Honeypot / tax detection | ~10 req/s |
| [Groq](https://console.groq.com) | AI analysis (primary) | 30 req/min free |
| [Gemini](https://aistudio.google.com) | AI analysis (secondary) | 15 req/min free |
| [HuggingFace](https://huggingface.co) | AI analysis (fallback) | Free inference API |
| [Telegram Bot API](https://core.telegram.org/bots/api) | Notifications + commands | No meaningful limit |

---

## Development

### Build backend

```bash
cd artifacts/api-server
npm run build   # tsc --noCheck → dist/
```

### Type check (without building)

```bash
# Backend
cd artifacts/api-server && npx tsc --noEmit --skipLibCheck

# Frontend
cd artifacts/base-sniper && npx tsc --noEmit --skipLibCheck
```

### Environment precedence

```
DB settings  (highest — set via UI)
    └── trading-config.json  (startup defaults, committed to git)
        └── .env  (secret values, gitignored)
            └── process.env defaults  (hardcoded fallbacks)
```

### Adding a new API endpoint

1. Add route handler in `artifacts/api-server/src/index.ts`
2. Add method to the relevant class (`AISniperBot`, `SwapExecutor`, etc.)
3. Add API call in `artifacts/base-sniper/src/hooks/useSniper.ts`
4. Add UI element in the relevant component

---

## Common Issues

**Bot starts but never buys anything**
- Set at least one AI key (`GROQ_API_KEY` etc.) — without AI the bot defaults to `HOLD`
- Check the Activity Log in the dashboard for rejection reasons
- Verify wallet has enough ETH (both for trade amount + gas)
- Smart Screener threshold may be too high — check screener signals tab

**Copy trading never triggers**
- Ensure whale wallets are added and set to Active in the Whale Wallets tab
- Blockscout polls every 2 seconds — give it a few minutes with active whales
- Confirm whale wallets are trading on Base network (not another chain)
- Copy trade is disabled by default — enable `copyEnabled` in Settings

**Circuit breaker / cooldown is active but I want to trade now**
- Open the Dashboard — the Auto Cooldown widget shows remaining time
- Wait for auto-resume, or use Emergency Stop reset if you want to clear manually
- Copy trade continues regardless of screener cooldowns

**WebSocket shows 405 error on startup**
- The Flashblocks preconf endpoint requires special access
- The bot automatically falls back to `wss://base.drpc.org` — this is expected and does not affect functionality

**Chart shows "Pool not found"**
- Token is too new to be indexed by GeckoTerminal (usually < 5 minutes old)
- Wait a few minutes and refresh

**Telegram test fails**
- Start a conversation with your bot in Telegram before testing (bot can't initiate messages)
- Chat ID must be your personal ID (from @userinfobot), not the bot's own ID

---

## License

MIT — use freely, at your own risk.

---

## Disclaimer

This software is provided for educational purposes. The authors are not responsible for financial losses incurred through use of this bot. Cryptocurrency trading is highly speculative. Past performance of whale wallets does not guarantee future results.
