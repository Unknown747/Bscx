/**
 * Base Sniper — Process Supervisor
 * Otomatis restart server kalau crash, dengan exponential backoff.
 * Membersihkan port 5000 sebelum setiap start untuk menghindari EADDRINUSE.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const net  = require('net');

const SCRIPT      = path.join(__dirname, 'dist/index.js');
const PORT        = parseInt(process.env.PORT || '5000', 10);
const MIN_DELAY   = 2000;
const MAX_DELAY   = 60000;
const RESET_AFTER = 300000;

let restartCount = 0;
let delay        = MIN_DELAY;
let startTime    = Date.now();
let currentChild = null;

function log(msg) {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`[${ts}] [SUPERVISOR] ${msg}`);
}

// Coba berbagai cara untuk membersihkan port
function killPort(port) {
    const methods = [
        () => execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, { timeout: 3000 }),
        () => execSync(`kill $(cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk 'NR>1{split($2,a,":"); if(strtonum("0x"a[2])==${port}){print $10}}' | sort -u) 2>/dev/null || true`, { timeout: 3000, shell: '/bin/sh' }),
        () => {
            // Fallback: kill semua proses node yang menjalankan dist/index.js selain diri sendiri
            execSync(`pkill -f "node.*dist/index" 2>/dev/null || true`, { timeout: 3000 });
        },
    ];
    for (const m of methods) {
        try { m(); break; } catch { /* coba metode berikutnya */ }
    }
}

// Cek apakah port sedang dipakai
function isPortBusy(port) {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', () => resolve(true))
            .once('listening', () => { tester.close(); resolve(false); })
            .listen(port, '0.0.0.0');
    });
}

async function start() {
    startTime = Date.now();

    // Bersihkan port dulu sebelum start
    const busy = await isPortBusy(PORT);
    if (busy) {
        log(`Port ${PORT} dipakai proses lain — membersihkan...`);
        killPort(PORT);
        await new Promise(r => setTimeout(r, 1500));

        // Cek sekali lagi
        const stillBusy = await isPortBusy(PORT);
        if (stillBusy) {
            log(`Port ${PORT} masih sibuk setelah cleanup. Tunggu ${delay / 1000}s...`);
            restartCount++;
            setTimeout(start, delay);
            delay = Math.min(delay * 2, MAX_DELAY);
            return;
        }
        log(`Port ${PORT} berhasil dibersihkan ✅`);
    }

    log(`Menjalankan server... (restart ke-${restartCount})`);

    currentChild = spawn('node', [SCRIPT], {
        stdio: 'inherit',
        env: process.env,
    });

    currentChild.on('exit', (code, signal) => {
        currentChild = null;
        const uptime = Math.round((Date.now() - startTime) / 1000);

        if (uptime >= RESET_AFTER / 1000) {
            delay = MIN_DELAY;
            log(`Server berjalan ${uptime}s — backoff direset`);
        } else {
            delay = Math.min(delay * 2, MAX_DELAY);
        }

        if (signal === 'SIGTERM' || signal === 'SIGINT') {
            log(`Server dihentikan (${signal}) — tidak di-restart`);
            process.exit(0);
        }

        restartCount++;
        log(`Server exit code=${code ?? '?'} signal=${signal ?? '-'} uptime=${uptime}s`);
        log(`Restart ke-${restartCount} dalam ${delay / 1000}s...`);
        setTimeout(start, delay);
    });

    currentChild.on('error', (err) => {
        currentChild = null;
        log(`Gagal menjalankan proses: ${err.message}`);
        restartCount++;
        setTimeout(start, delay);
        delay = Math.min(delay * 2, MAX_DELAY);
    });
}

// Forward SIGTERM/SIGINT ke child
function shutdown(sig) {
    log(`${sig} diterima — menghentikan child...`);
    if (currentChild) currentChild.kill(sig);
    else process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

log('=== Base Sniper Supervisor dimulai ===');
start();
