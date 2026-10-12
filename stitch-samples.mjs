// Offline stitcher for captured captcha samples.
// node stitch-samples.mjs <manifest.json>
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const manifestPath = process.argv[2];
if (!manifestPath) {
    console.log('usage: node stitch-samples.mjs <manifest.json>');
    process.exit(1);
}
const dir = path.dirname(manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const tiles = manifest.maps.map((m) => m.file);

const TILE = 128;
const grids = [
    [6, 6], [9, 4], [4, 9], [3, 12], [12, 3], [2, 18], [18, 2]
].filter(([c, r]) => c * r === tiles.length);

if (!grids.length) {
    console.log(`tiles=${tiles.length}, no grid fits; using ${tiles.length} x 1`);
    grids.push([tiles.length, 1]);
}

for (const [cols, rows] of grids) {
    const canvas = createCanvas(cols * TILE, rows * TILE);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < tiles.length; i += 1) {
        const img = await loadImage(path.join(dir, tiles[i]));
        ctx.drawImage(img, (i % cols) * TILE, Math.floor(i / cols) * TILE);
    }
    // thin separators so tile borders stay visible
    ctx.strokeStyle = 'rgba(255,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c += 1) {
        ctx.beginPath(); ctx.moveTo(c * TILE + 0.5, 0); ctx.lineTo(c * TILE + 0.5, rows * TILE); ctx.stroke();
    }
    for (let r = 0; r <= rows; r += 1) {
        ctx.beginPath(); ctx.moveTo(0, r * TILE + 0.5); ctx.lineTo(cols * TILE, r * TILE + 0.5); ctx.stroke();
    }
    const out = path.join(dir, `stitched_${cols}x${rows}.png`);
    fs.writeFileSync(out, canvas.toBuffer('image/png'));
    console.log(`${cols}x${rows} -> ${out}`);
}
console.log(`tiles: ${tiles.length}`);