/**
 * PM2 Ecosystem Config — Base Sniper Ultimate
 *
 * Cara pakai di VPS:
 *   npm install -g pm2
 *   pm2 start artifacts/api-server/ecosystem.config.js
 *   pm2 save
 *   pm2 startup        # auto-start on reboot
 */

module.exports = {
    apps: [
        {
            name: 'base-sniper',
            script: 'supervisor.js',
            cwd: './artifacts/api-server',

            // ── Environment ────────────────────────────────────────────
            env: {
                NODE_ENV: 'production',
                PORT: 5000,
            },
            // env_file lets PM2 load your .env automatically
            // pm2 start ecosystem.config.js --env production
            env_production: {
                NODE_ENV: 'production',
                PORT: 5000,
            },

            // ── Process management ────────────────────────────────────
            instances: 1,              // single instance (stateful bot)
            exec_mode: 'fork',         // fork mode (not cluster — bot has internal state)
            autorestart: true,
            watch: false,              // don't watch files (supervisor handles restarts)
            max_restarts: 10,
            restart_delay: 5000,       // 5s between PM2 restarts

            // ── Logs ──────────────────────────────────────────────────
            out_file: './logs/base-sniper-out.log',
            error_file: './logs/base-sniper-error.log',
            merge_logs: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            max_size: '50M',
            retain: 7,

            // ── Monitoring ────────────────────────────────────────────
            min_uptime: '10s',
        }
    ]
};
