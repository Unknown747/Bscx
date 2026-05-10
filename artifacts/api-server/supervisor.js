/**
 * Base Sniper — Process Supervisor
 * Otomatis restart server kalau crash, dengan exponential backoff.
 */

const { spawn } = require('child_process');
const path = require('path');

const SCRIPT      = path.join(__dirname, 'dist/index.js');
const MIN_DELAY   = 2000;    // 2 detik sebelum restart pertama
const MAX_DELAY   = 60000;   // Maksimum 60 detik
const RESET_AFTER = 300000;  // Reset backoff setelah 5 menit uptime

let restartCount = 0;
let delay        = MIN_DELAY;
let startTime    = Date.now();

function log(msg) {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`[${ts}] [SUPERVISOR] ${msg}`);
}

function start() {
    startTime = Date.now();
    log(`Menjalankan server... (restart ke-${restartCount})`);

    const child = spawn('node', [SCRIPT], {
        stdio: 'inherit',
        env: process.env,
    });

    child.on('exit', (code, signal) => {
        const uptime = Math.round((Date.now() - startTime) / 1000);

        // Reset backoff kalau server berhasil jalan minimal 5 menit
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

    child.on('error', (err) => {
        log(`Gagal menjalankan proses: ${err.message}`);
        restartCount++;
        log(`Retry dalam ${delay / 1000}s...`);
        setTimeout(start, delay);
        delay = Math.min(delay * 2, MAX_DELAY);
    });

    // Forward SIGTERM/SIGINT ke child
    process.on('SIGTERM', () => { log('SIGTERM diterima — menghentikan child...'); child.kill('SIGTERM'); });
    process.on('SIGINT',  () => { log('SIGINT diterima — menghentikan child...');  child.kill('SIGINT');  });
}

log('=== Base Sniper Supervisor dimulai ===');
start();
