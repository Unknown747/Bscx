#!/usr/bin/env bash
# ================================================================
# Base Sniper Ultimate v2.0 — VPS Build & Deploy Script
# ================================================================
# Jalankan dari root project: bash scripts/build-vps.sh
# ================================================================

set -e
YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

log()  { echo -e "${YELLOW}[build]${NC} $1"; }
ok()   { echo -e "${GREEN}[ok]${NC} $1"; }
fail() { echo -e "${RED}[fail]${NC} $1"; exit 1; }

# ── Check prerequisites ───────────────────────────────────────────
command -v node  >/dev/null 2>&1 || fail "Node.js tidak ditemukan. Install: https://nodejs.org"
command -v npm   >/dev/null 2>&1 || fail "npm tidak ditemukan."

NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>&1) || \
    fail "Node.js >= 18 diperlukan (saat ini: $(node -v))"
ok "Node.js $(node -v)"

# ── 1. Install backend dependencies ──────────────────────────────
log "Install backend dependencies..."
cd artifacts/api-server
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3
ok "Backend deps installed"

# ── 2. Build backend (TypeScript → JS) ───────────────────────────
log "Build backend (TypeScript)..."
npm run build
ok "Backend compiled → dist/"

cd ../..

# ── 3. Install frontend dependencies ─────────────────────────────
log "Install frontend dependencies..."
cd artifacts/base-sniper
npm install --no-audit --no-fund 2>&1 | tail -3
ok "Frontend deps installed"

# ── 4. Build frontend (Vite) ─────────────────────────────────────
log "Build frontend (Vite)..."
npm run build
ok "Frontend compiled → dist/"

cd ../..

# ── 5. Create logs directory ─────────────────────────────────────
mkdir -p artifacts/api-server/logs
ok "Logs directory ready"

# ── 6. Verify .env ───────────────────────────────────────────────
if [ ! -f .env ]; then
    echo ""
    echo -e "${YELLOW}⚠️  File .env tidak ditemukan!${NC}"
    echo "Buat file .env dari template:"
    echo "  cp .env.example .env && nano .env"
    echo ""
fi

# ── 7. Done ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN} ✅ Build selesai! Cara menjalankan:${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "  1. Dengan PM2 (direkomendasikan untuk VPS):"
echo "     npm install -g pm2"
echo "     pm2 start artifacts/api-server/ecosystem.config.js"
echo "     pm2 save && pm2 startup"
echo ""
echo "  2. Langsung (untuk testing):"
echo "     cd artifacts/api-server && PORT=5000 node supervisor.js"
echo ""
echo "  3. Dashboard: http://SERVER_IP:5000"
echo "     Health:    http://SERVER_IP:5000/health"
echo ""
