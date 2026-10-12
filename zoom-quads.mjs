import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

const src = process.argv[2];
const img = await loadImage(src);
const cols = 3, rows = 2, SCALE = 2;

for (let q = 0; q < cols * rows; q += 1) {
    const qc = Math.floor(q / rows), qr = q % rows;
    const w = Math.floor(img.width / cols);
    const h = Math.floor(img.height / rows);
    const c = createCanvas(w * SCALE, h * SCALE);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, qc * w, qr * h, w, h, 0, 0, w * SCALE, h * SCALE);
    const out = src.replace(/\.png$/, `_q${q + 1}.png`);
    fs.writeFileSync(out, c.toBuffer('image/png'));
    console.log(out);
}