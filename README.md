# Base Sniper Ultimate

Automated crypto trading bot for the **Base network** built for small capital (≈ Rp 100.000 / ~$6 / 0.006 ETH). Combines real-time mempool scanning, whale copy-trading, AI-powered token selection, and GeckoTerminal market data into one dashboard.

---

## Features

| Feature | Description |
|---|---|
| **Flashblocks Scanner** | Listens to Uniswap V3 pool-creation events via WebSocket. Catches new tokens within seconds of launch |
| **GeckoTerminal Token Scanner** | Independent scanner polling GeckoTerminal new/trending pools every 30 s — works even without mempool access |
| **Whale Copy Trading** | Monitors approved whale wallets on Blockscout; copies their buys with configurable delay |
| **Auto Whale Finder** | Scans trending pools, evaluates top traders (win rate, profit, trade count), sends Telegram notification for manual approval |
| **P&L Simulation Gate** | Estimates expected profit/risk before every copy trade; blocks high-risk low-reward trades automatically |
| **AI Token Analysis** | Three-provider fallback chain: Groq (primary, ~88 ms) → Gemini → HuggingFace. Scores confidence 0–100 before any buy |
| **Dynamic Position Sizing** | Trade size auto-scales with WETH balance × AI confidence multiplier (0.6×–1.5×) |
| **Real-time OHLCV Chart** | Per-position inline price chart (SVG, 5-min candles, 30 s refresh) with entry price reference line |
| **Deployer Reputation Check** | Scores token deployers by survival rate of their previous contracts — flags serial ruggers |
| **Honeypot Detection** | GoPlus Security API check before every buy — blocks honeypots, high sell tax, suspicious ownership |
| **Trailing Stop Loss** | Activates after 50% profit; sells if price drops 12% from peak |
| **Telegram Notifications** | Trade alerts, whale approvals, P&L simulation results, GeckoTerminal opportunities |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend  (React + Vite, port 5000)                        │
│  artifacts/base-sniper/                                     │
│  ┌──────────┐ ┌─────────────┐ ┌────────────┐ ┌──────────┐  │
│  │Dashboard │ │PositionCard│ │Modal100k   │ │MiniChart │  │
│  │(live PnL)│ │+ OHLCV     │ │(Settings)  │ │(SVG)     │  │
│  └──────────┘ └─────────────┘ └────────────┘ └──────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API (axios proxy → :8080)
┌────────────────────────▼────────────────────────────────────┐
│  API Server  (Express + TypeScript, port 8080)              │
│  artifacts/api-server/                                      │
│  ┌──────────────────┐  ┌────────────────────────────────┐   │
│  │ FlashblocksScanner│  │ GeckoTokenScanner              │   │
│  │ (WebSocket → Base)│  │ (GeckoTerminal REST, 30s poll) │   │
│  └────────┬─────────┘  └───────────────┬────────────────┘   │
│           │                            │                     │
│  ┌────────▼────────────────────────────▼────────────────┐   │
│  │              AISniperBot (core orchestrator)          │   │
│  │  MultiAIProvider ──► Dynamic Sizing ──► SwapExecutor │   │
│  │  CopyTradeMonitor ──► SimulationGate ──► WhaleFinder │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  External APIs                                              │
│  ├─ GeckoTerminal  (price data, pools, OHLCV)              │
│  ├─ Blockscout Base (txs, token holders, deployer info)    │
│  ├─ GoPlus Security (honeypot / tax check)                 │
│  ├─ Groq / Gemini / HuggingFace (AI analysis)             │
│  └─ Telegram Bot API (notifications)                       │
└─────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│  Base Mainnet (chain ID 8453)                               │
│  Uniswap V3 Router: 0x2626664c2603336E57B271c5C0b26F421741e481 │
│  WETH:              0x4200000000000000000000000000000000000006 │
└─────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
.
├── .env.example                    # Environment variable template (copy → artifacts/api-server/.env)
├── artifacts/
│   ├── api-server/                 # Express backend
│   │   ├── src/
│   │   │   ├── index.ts            # All REST endpoints
│   │   │   ├── ai-sniper-integration.ts  # Core bot orchestrator
│   │   │   ├── swap-executor.ts    # Uniswap V3 trades + position management
│   │   │   ├── copy-trade-monitor.ts     # Whale wallet monitoring
│   │   │   ├── whale-finder.ts     # Auto whale discovery + approval gate
│   │   │   ├── gecko-token-scanner.ts    # GeckoTerminal independent scanner
│   │   │   ├── multi-ai-provider.ts      # Groq / Gemini / HuggingFace AI chain
│   │   │   ├── flashblocks-scanner.ts    # WebSocket mempool scanner
│   │   │   ├── price-oracle.ts     # GeckoTerminal price data + OHLCV
│   │   │   ├── deployer-checker.ts # Deployer contract-creation history
│   │   │   └── deployer-reputation.ts    # Token survival rate scorer
│   │   └── package.json
│   └── base-sniper/                # React + Vite frontend
│       ├── src/
│       │   ├── App.tsx             # Main app with auth gate + layout
│       │   ├── components/
│       │   │   ├── Dashboard.tsx   # Live stats, activity log
│       │   │   ├── PositionCard.tsx      # Open position with chart toggle
│       │   │   ├── MiniChart.tsx   # SVG OHLCV sparkline (no lib)
│       │   │   ├── Modal100k.tsx   # Settings modal — all config
│       │   │   └── WhaleFinder.tsx # Pending / approved whale candidates
│       │   └── hooks/useSniper.ts  # All API polling hooks
│       └── package.json
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
cd artifacts/api-server
npm install

# Frontend
cd ../base-sniper
npm install
```

### 3. Configure

```bash
# From repo root
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
npm run dev
# Listening on http://localhost:8080
```

**Terminal 2 — Frontend:**
```bash
cd artifacts/base-sniper
npx vite --port 5000 --host
# Open http://localhost:5000
```

---

## Configuration Reference

All settings are configurable via the Settings modal in the UI without restart. The `.env` file sets startup defaults.

### Trading

| Variable | Default | Description |
|---|---|---|
| `PRIVATE_KEY` | — | Wallet private key (required for live trading) |
| `APP_PASSWORD` | — | Dashboard access password |
| `TOTAL_CAPITAL_ETH` | `0.006` | Total capital reference |
| `MAX_TRADE_AMOUNT` | `0.0006` | Max ETH per single trade |
| `MAX_SLIPPAGE_PERCENT` | `8` | Uniswap slippage tolerance |
| `MAX_OPEN_POSITIONS` | `3` | Simultaneous open trades |
| `MAX_HOLD_MINUTES` | `30` | Force-exit stale positions |

### Exit Strategy

| Variable | Default | Description |
|---|---|---|
| `TAKE_PROFIT_1_MULTIPLIER` | `2.0` | First TP at 2× (sell 50%) |
| `TAKE_PROFIT_2_MULTIPLIER` | `5.0` | Second TP at 5× (sell remaining 50%) |
| `STOP_LOSS_PERCENTAGE` | `20` | Stop loss at −20% |
| `DCA_ENABLED` | `false` | Dollar-cost averaging on dip (disabled by default — gas cost exceeds benefit at small capital) |

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
| `GROQ_API_KEY` | Primary. Free at [console.groq.com](https://console.groq.com). Latency ~88 ms. Uses `llama-3.3-70b-versatile` |
| `GEMINI_API_KEY` | Secondary. Free at [aistudio.google.com](https://aistudio.google.com). Uses `gemini-2.0-flash` |
| `HUGGINGFACE_API_KEY` | Fallback. Free at [huggingface.co](https://huggingface.co/settings/tokens). Uses `Llama-3.1-8B-Instruct` |

At least one key is required for AI-powered filtering. Without AI, the bot falls back to rule-based `HOLD` recommendations (conservative — will rarely trade).

### Telegram Notifications

1. Message [@BotFather](https://t.me/botfather) → `/newbot` → copy the token
2. Message [@userinfobot](https://t.me/userinfobot) → copy your Chat ID
3. Set in `.env` or via the Settings modal:

```env
TELEGRAM_BOT_TOKEN=123456789:AAF...
TELEGRAM_CHAT_ID=987654321
```

You will receive alerts for: new trades, take profits, stop losses, whale candidates (with approve/reject), simulation blocks, and GeckoTerminal opportunities.

---

## API Endpoints

All endpoints are on `http://localhost:8080`.

### Status & Control

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Bot status, connection, AI stats |
| `GET` | `/api/config` | Current runtime configuration |
| `POST` | `/api/start` | Start the bot |
| `POST` | `/api/stop` | Stop the bot |
| `POST` | `/api/settings` | Update runtime settings (no restart needed) |
| `POST` | `/api/keys` | Update API keys and private key |

### Trading

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/positions` | Open positions with live PnL |
| `GET` | `/api/portfolio` | Full portfolio (ETH balance + token holdings) |
| `GET` | `/api/history` | Closed trade history + win rate stats |
| `POST` | `/api/sell` | Manual sell `{ tokenAddress, percent }` |
| `POST` | `/api/buy` | Manual buy `{ tokenAddress, amountEth }` |
| `POST` | `/api/send` | Send ETH or token to address |

### Whale Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/wallets` | List monitored whale wallets |
| `POST` | `/api/wallets` | Add wallet `{ address, name }` |
| `DELETE` | `/api/wallets/:address` | Remove wallet |
| `PATCH` | `/api/wallets/:address/toggle` | Enable / disable wallet |
| `PATCH` | `/api/wallets/:address/rename` | Rename wallet |
| `GET` | `/api/whale/candidates` | Pending whale candidates awaiting approval |
| `POST` | `/api/whale/approve/:address` | Approve candidate → adds to copy list |
| `POST` | `/api/whale/reject/:address` | Reject candidate permanently |
| `POST` | `/api/whale/scan` | Trigger manual whale scan now |

### Data

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/chart/:tokenAddress` | OHLCV candles (5-min, last 40) via GeckoTerminal |
| `GET` | `/api/eth-price` | Current ETH/USD price |
| `GET` | `/api/logs` | Activity log (last 100 entries) |
| `GET` | `/api/blacklist` | Blacklisted tokens |
| `POST` | `/api/blacklist` | Add token to blacklist |
| `DELETE` | `/api/blacklist/:address` | Remove from blacklist |
| `POST` | `/api/simulate` | Simulate copy trade P&L `{ walletAddress, tokenAddress }` |
| `GET` | `/api/deployer/:tokenAddress` | Deployer reputation score |
| `POST` | `/api/telegram/test` | Send test Telegram message |

---

## How Each Feature Works

### Flashblocks Scanner
Connects to `wss://base.llamarpc.com` (or Flashblocks preconf endpoint if available). Subscribes to `eth_newPendingTransactions` and `logs` filtered for Uniswap V3's `PoolCreated` event signature (`0x783c...`). When a new pool appears, it checks liquidity, pool age, and safety score — then routes to AI analysis.

### GeckoTerminal Token Scanner
Polls `/api/v2/networks/base/new_pools` (every 30 s) and `/trending_pools` (every 2 min). Applies 10 filters (liquidity, FDV, volume, buy/sell ratio, age, price momentum). Passes survivors through GoPlus honeypot check before emitting a signal. Seen tokens are pruned after 6 hours to prevent memory growth.

### Whale Copy Trading Flow
```
Blockscout API (every 2s)
    → filter: Uniswap exactInputSingle selector (0x414bf389)
    → check: tx within 30s window, not recently seen
    → GoPlus safety check
    → P&L simulation gate (block if HIGH risk + profit < 10%)
    → AI wallet analysis (score > threshold)
    → Dynamic copy amount (7% of balance × AI multiplier)
    → SwapExecutor.buy()
```

### Auto Whale Finder
Every 15 minutes (configurable):
1. Fetches top 5 trending pools from GeckoTerminal
2. Gets top 20 holders from Blockscout for each token
3. Analyzes each holder's transaction history (win rate, avg profit, trade count, recency)
4. Filters: win rate ≥ 55%, trades ≥ 8, active within 3 days, score ≥ 60
5. Sends Telegram message with wallet stats + approve/reject buttons
6. Holds in `pending` state until owner decides

### Dynamic Position Sizing
```
tradeSize = balance × (tradeBalancePct / 100)
tradeSize × aiMultiplier   (0.6× if confidence < 80, 1.5× if ≥ 90)
tradeSize = clamp(tradeSize, 0.001 ETH, balance × 0.30)
```

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
Bot only buys if `recommendation == "BUY"` and `confidence >= 75` and `riskLevel != "CRITICAL"`.

---

## Safety & Risk Warnings

> **This bot trades real money on mainnet. You can lose your entire balance. DeFi trading carries extreme risk — new tokens frequently go to zero.**

- Never use funds you cannot afford to lose
- The suggested capital is Rp 100.000 (~$6 / 0.006 ETH) — treat it as learning money
- Honeypot detection is not 100% reliable — some malicious tokens bypass GoPlus
- Never share your private key or commit `.env` to version control
- Gas costs on Base are very low ($0.002/swap) but still reduce small-capital returns
- The bot has no access to your funds beyond what is in the configured wallet
- Add your wallet address to a block explorer alert service (e.g. Etherscan/Basescan alerts)

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
| [GeckoTerminal](https://www.geckoterminal.com/dex-api) | Price data, pools, OHLCV | ~3 req/s |
| [Blockscout Base](https://base.blockscout.com) | Tx history, holders, deployer | Generous free tier |
| [GoPlus Security](https://gopluslabs.io) | Honeypot / tax detection | ~10 req/s |
| [Groq](https://console.groq.com) | AI analysis (primary) | 30 req/min free |
| [Gemini](https://aistudio.google.com) | AI analysis (secondary) | 15 req/min free |
| [HuggingFace](https://huggingface.co) | AI analysis (fallback) | Free inference API |
| [Telegram Bot API](https://core.telegram.org/bots/api) | Notifications | No meaningful limit |

---

## Development

### Run TypeScript type check

```bash
# Backend
cd artifacts/api-server && npx tsc --noEmit --skipLibCheck

# Frontend
cd artifacts/base-sniper && npx tsc --noEmit --skipLibCheck
```

### Environment flow

```
.env.example  (committed, no real keys)
    └── cp → artifacts/api-server/.env  (gitignored, real keys)
```

### Adding a new API endpoint

1. Add route handler in `artifacts/api-server/src/index.ts`
2. Add method to the relevant class (`AISniperBot`, `SwapExecutor`, etc.)
3. Add corresponding hook in `artifacts/base-sniper/src/hooks/useSniper.ts`
4. Add UI element in relevant component

---

## Common Issues

**Bot starts but never buys anything**
- Check that `GROQ_API_KEY` (or another AI key) is set — without AI the bot defaults to `HOLD`
- Check the activity log in the dashboard for rejection reasons
- Verify your wallet has enough ETH for trades + gas

**WebSocket shows 405 error on startup**
- The Flashblocks preconf endpoint (`mainnet-preconf.base.org`) requires special access
- The bot automatically falls back to `wss://base.llamarpc.com` — this is expected behavior and does not affect functionality

**Copy trading never triggers**
- Ensure whale wallets are added and set to Active in the Whale Wallets tab
- Blockscout API checks every 2 seconds — give it a few minutes with active whale wallets
- Verify the whale wallets you added are actually trading on Base (not another chain)

**Chart shows "Pool not found"**
- The token is too new to be indexed by GeckoTerminal (usually < 5 minutes old)
- Wait a few minutes and click the refresh icon

**Telegram test fails**
- Ensure the bot has been started at least once by messaging it in Telegram first
- Chat ID must be your personal ID (from @userinfobot), not the bot's own ID

---

## License

MIT — use freely, at your own risk.

---

## Disclaimer

This software is provided for educational purposes. The authors are not responsible for financial losses incurred through use of this bot. Cryptocurrency trading is highly speculative. Past performance of whale wallets does not guarantee future results.
