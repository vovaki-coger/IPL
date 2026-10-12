// Is the captcha text drawn in a map colour that renders as transparent?
// Highlight pixels that vanish in the normal render.
import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

const file = process.argv[2];
const img = await loadImage(file);
const c = createCanvas(img.width, img.height);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const src = ctx.getImageData(0, 0, img.width, img.height);

// 1) invisible pixels
const ghost = createCanvas(img.width, img.height);
const gctx = ghost.getContext('2d');
const gdata = gctx.createImageData(img.width, img.height);
let ghostCount = 0;
const colourHits = new Map();

for (let i = 0; i < img.width * img.height; i += 1) {
    const o = i * 4;
    if (src.data[o + 3] < 255) {
        ghostCount += 1;
        gdata.data[o] = 255; gdata.data[o + 1] = 0; gdata.data[o + 2] = 255; gdata.data[o + 3] = 255;
        continue;
    }
    const key = `${src.data[o]},${src.data[o + 1]},${src.data[o + 2]}`;
    colourHits.set(key, (colourHits.get(key) || 0) + 1);
}
gctx.putImageData(gdata, 0, 0);
fs.writeFileSync(file.replace(/\.png$/, '_ghost.png'), ghost.toBuffer('image/png'));

const total = img.width * img.height;
const sorted = [...colourHits.entries()].sort((a, b) => b[1] - a[1]);
console.log(`размер ${img.width}x${img.height}, всего пикселей ${total}`);
console.log(`прозрачных (невидимых) пикселей: ${ghostCount} (${(ghostCount / total * 100).toFixed(1)}%)`);
console.log(`\nвсего различных цветов: ${sorted.length}`);
console.log('\nтоп-15 цветов:');
sorted.slice(0, 15).forEach(([k, v]) => console.log(`  ${k} : ${v}`));
console.log('\n15 самых редких цветов:');
sorted.slice(-15).forEach(([k, v]) => console.log(`  ${k} : ${v}`));