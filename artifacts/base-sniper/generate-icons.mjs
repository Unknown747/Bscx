/**
 * Generate PWA icons (192x192 and 512x512) as PNG files.
 * Run: node generate-icons.mjs
 */
import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

function drawIcon(size, maskable = false) {
    const canvas = createCanvas(size, size);
    const ctx    = canvas.getContext('2d');
    const pad    = maskable ? size * 0.15 : 0;

    // Background
    ctx.fillStyle = '#030712';
    if (maskable) {
        ctx.fillRect(0, 0, size, size);
    } else {
        const r = size * 0.18;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(size - r, 0);
        ctx.quadraticCurveTo(size, 0, size, r);
        ctx.lineTo(size, size - r);
        ctx.quadraticCurveTo(size, size, size - r, size);
        ctx.lineTo(r, size);
        ctx.quadraticCurveTo(0, size, 0, size - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();
    }

    // Green glow ring
    const cx    = size / 2;
    const cy    = size / 2;
    const ringR = (size / 2) - pad - size * 0.06;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth   = size * 0.025;
    ctx.stroke();

    // Fire emoji
    ctx.font      = `${size * 0.42}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔥', cx, cy + size * 0.03);

    // "BS" text below
    ctx.font         = `bold ${size * 0.1}px sans-serif`;
    ctx.fillStyle    = '#22c55e';
    ctx.textBaseline = 'top';
    ctx.fillText('BASE SNIPER', cx, cy + size * 0.26 + pad * 0.5);

    return canvas.toBuffer('image/png');
}

try {
    fs.writeFileSync(path.join(publicDir, 'icon-192.png'),     drawIcon(192, false));
    fs.writeFileSync(path.join(publicDir, 'icon-512.png'),     drawIcon(512, false));
    fs.writeFileSync(path.join(publicDir, 'icon-maskable.png'), drawIcon(512, true));
    console.log('✅ Icons generated: icon-192.png, icon-512.png, icon-maskable.png');
} catch (e) {
    console.error('❌ Failed to generate icons with canvas:', e.message);
    console.log('Falling back to SVG icon...');
}
