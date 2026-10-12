// Real ground truth: are the 36 captcha maps pieces of ONE picture?
// If yes, correct neighbours must share borders much better than wrong pairs.
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

const px = [];
for (const t of tiles) px.push(await load(t.file));

// cost of butting piece a's RIGHT edge against piece b's LEFT edge
function seamCost(a, b, vertical) {
    let sum = 0, n = 0;
    for (let i = 0; i < 128; i += 1) {
        const ia = vertical ? ((127 * 128 + i) * 4) : ((i * 128 + 127) * 4);
        const ib = vertical ? (i * 4) : ((i * 128) * 4);
        if (a[ia + 3] < 8 || b[ib + 3] < 8) continue;
        sum += Math.abs(a[ia] - b[ib]) + Math.abs(a[ia + 1] - b[ib + 1]) + Math.abs(a[ia + 2] - b[ib + 2]);
        n += 1;
    }
    return n ? sum / n : null;
}

const costs = [];
for (let a = 0; a < px.length; a += 1) {
    for (let b = 0; b < px.length; b += 1) {
        if (a === b) continue;
        const c = seamCost(px[a], px[b], false);
        if (c !== null) costs.push({ a, b, c });
    }
}
costs.sort((x, y) => x.c - y.c);

const values = costs.map(x => x.c);
const avg = values.reduce((s, v) => s + v, 0) / values.length;

console.log(`плиток: ${px.length}, пар: ${values.length}`);
console.log(`средняя разница на шве: ${avg.toFixed(1)}`);
console.log('\n10 самых похожих швов:');
costs.slice(0, 10).forEach(x => console.log(`  ${tiles[x.a].mapId} -> ${tiles[x.b].mapId} : ${x.c.toFixed(1)}`));
console.log('\n10 самых разных:');
costs.slice(-10).forEach(x => console.log(`  ${tiles[x.a].mapId} -> ${tiles[x.b].mapId} : ${x.c.toFixed(1)}`));

// If it is one picture, the best seams must stand out from the average.
const best = values[0];
console.log(`\nлучший шов ${best.toFixed(1)} против среднего ${avg.toFixed(1)}`);
console.log(best < avg * 0.6 ? 'ВЫВОД: есть выраженные совпадения - похоже на одну картинку' : 'ВЫВОД: швы не различаются - это независимые картинки');