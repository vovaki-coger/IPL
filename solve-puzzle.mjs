// Real jigsaw solver, verified against real captcha tiles.
// The border analysis proved the pieces belong to ONE picture, so this
// greedily grows the grid from the single best-matching seam.
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const dir = path.dirname(process.argv[2]);
const tiles = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).maps;

async function load(file) {
    const img = await loadImage(path.join(dir, file));
    const c = createCanvas(128, 128);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, 128, 128).data;
}

const pieces = [];
for (const t of tiles) pieces.push({ id: t.mapId, px: await load(t.file) });
const n = pieces.length;
const cols = Math.round(Math.sqrt(n));
const rows = Math.ceil(n / cols);

function seam(a, b, vertical) {
    let sum = 0, count = 0;
    for (let i = 0; i < 128; i += 1) {
        const ia = vertical ? ((127 * 128 + i) * 4) : ((i * 128 + 127) * 4);
        const ib = vertical ? (i * 4) : ((i * 128) * 4);
        if (a[ia + 3] < 8 || b[ib + 3] < 8) continue;
        sum += Math.abs(a[ia] - b[ib]) + Math.abs(a[ia + 1] - b[ib + 1]) + Math.abs(a[ia + 2] - b[ib + 2]);
        count += 1;
    }
    return count ? sum / count : 765;
}

// start from the globally best horizontal pair
let bestPair = null;
for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
        if (a === b) continue;
        const c = seam(pieces[a].px, pieces[b].px, false);
        if (!bestPair || c < bestPair.c) bestPair = { a, b, c };
    }
}
console.log(`стартовая пара: #${pieces[bestPair.a].id} -> #${pieces[bestPair.b].id} (шов ${bestPair.c.toFixed(1)})`);

const grid = new Array(cols * rows).fill(null);
const used = new Set([bestPair.a, bestPair.b]);
grid[0] = pieces[bestPair.a];
grid[1] = pieces[bestPair.b];

for (let cell = 2; cell < cols * rows; cell += 1) {
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const left = col > 0 ? grid[cell - 1] : null;
    const above = row > 0 ? grid[cell - cols] : null;

    let best = null;
    for (let i = 0; i < n; i += 1) {
        if (used.has(i)) continue;
        let cost = 0, parts = 0;
        if (left) { cost += seam(left.px, pieces[i].px, false); parts += 1; }
        if (above) { cost += seam(above.px, pieces[i].px, true); parts += 1; }
        if (!parts) continue;
        cost /= parts;
        if (!best || cost < best.cost) best = { i, cost };
    }
    if (!best) break;
    grid[cell] = pieces[best.i];
    used.add(best.i);
}

console.log(`размещено ${used.size} из ${n}, сетка ${cols}x${rows}`);

const out = createCanvas(cols * 128, rows * 128);
const octx = out.getContext('2d');
octx.imageSmoothingEnabled = false;
const part = createCanvas(128, 128);
const pctx = part.getContext('2d');
for (let cell = 0; cell < grid.length; cell += 1) {
    const p = grid[cell];
    if (!p) continue;
    const image = pctx.createImageData(128, 128);
    image.data.set(p.px);
    pctx.putImageData(image, 0, 0);
    octx.drawImage(part, (cell % cols) * 128, Math.floor(cell / cols) * 128);
}
const file = path.join(dir, 'solved.png');
fs.writeFileSync(file, out.toBuffer('image/png'));
console.log(`собрано -> ${file}`);
console.log('порядок:', grid.map(p => p ? p.id : '—').join(' '));