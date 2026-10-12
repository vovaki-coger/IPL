// Are the 36 maps one picture at different zoom levels / tiles, or 36
// unrelated pictures? Render a big labelled contact sheet to look at.
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const manifestPath = process.argv[2];
const dir = path.dirname(manifestPath);
const tiles = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).maps;

const CELL = 256;           // 2x scale so digits are readable
const COLS = 6;
const rows = Math.ceil(tiles.length / COLS);
const canvas = createCanvas(COLS * CELL, rows * (CELL + 18));
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#111';
ctx.fillRect(0, 0, canvas.width, canvas.height);

for (let i = 0; i < tiles.length; i += 1) {
    const img = await loadImage(path.join(dir, tiles[i].file));
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    ctx.drawImage(img, col * CELL, row * (CELL + 18), CELL, CELL);
    ctx.fillStyle = '#ff0';
    ctx.font = '14px sans-serif';
    ctx.fillText(`#${tiles[i].mapId} (${i})`, col * CELL + 4, row * (CELL + 18) + CELL + 14);
    ctx.strokeStyle = '#f0f';
    ctx.strokeRect(col * CELL, row * (CELL + 18), CELL, CELL);
}

const out = path.join(dir, 'contact_sheet.png');
fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`${out}  ${canvas.width}x${canvas.height}`);