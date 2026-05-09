# Base Sniper Ultimate

A crypto trading bot for the Base blockchain network with an AI-powered frontend dashboard and Express API backend.

## Architecture

- **Frontend** (`artifacts/base-sniper/`): React + Vite + Tailwind CSS dashboard running on port 5000
- **API Server** (`artifacts/api-server/`): TypeScript/Express backend running on port 8080
- **Database**: SQLite (`artifacts/base-sniper/base.db`) for trade history, wallets, and blacklist

## Workflows

- **Start application**: Runs the Vite dev server (`artifacts/base-sniper`) on port 5000
- **API Server**: Runs the Express API (`artifacts/api-server`) on port 8080 using `ts-node-dev`

## Environment Variables (set via Replit Secrets)

The following secrets can be configured through the app's built-in key management UI (`/api/keys`) or as Replit environment secrets:

- `APP_PASSWORD` — Required. Password to access the dashboard
- `PRIVATE_KEY` — Ethereum wallet private key for executing trades
- `GROQ_API_KEY` — Groq AI API key (fastest, primary AI provider)
- `GEMINI_API_KEY` — Google Gemini API key (quality analysis)
- `HUGGINGFACE_API_KEY` — HuggingFace API key (fallback AI)
- `TELEGRAM_BOT_TOKEN` — Optional Telegram bot token for notifications
- `TELEGRAM_CHAT_ID` — Optional Telegram chat ID for notifications

RPC endpoints and trading parameters are pre-configured via `.replit` `[userenv]` section.

## User Preferences

- All API keys/secrets should be managed via Replit Secrets or the in-app key management UI
- Never commit `.env` files with real keys
