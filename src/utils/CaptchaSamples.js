// Captcha map samples. The dashboard can show the picture, but automatic
// symbol recognition needs real examples of what this server actually draws.
// Every received map burst is written to captcha_samples/ as plain PNGs.
import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';

const MAP_SIZE = 128;
// Same palette the dashboard uses (public/app.js MANUAL_MAP_PALETTE).
const PALETTE = [
    0x000000, 0x7FB238, 0xF7E9A3, 0xC7C7C7, 0xFF0000, 0xA0A0FF, 0xA7A7A7, 0x007C00,
    0xFFFFFF, 0xA4A8B8, 0x976D4D, 0x707070, 0x4040FF, 0x8F7748, 0xFFFCF5, 0xD87F33,
    0xB24CD8, 0x6699D8, 0xE5E533, 0x7FCC19, 0xF27FA5, 0x4C4C4C, 0x999999, 0x4C7F99,
    0x4E4E4E, 0xBFBFBF, 0x669900, 0x7C7C7C, 0x9C5C2C, 0xBFBFBF, 0x8F7748, 0x404040,
    0x2D6E8E, 0x4C7F99, 0xB24CD8, 0xD87F33, 0x8F7748, 0xF7E9A3, 0x3B3B3B, 0x6A6A6A,
    0xB24CD8, 0x4C7F99, 0x4E4E4E, 0xFFFFFF, 0x4040FF, 0xD87F33, 0x2D6E8E, 0x7C7C7C,
    0xBFBFBF, 0x8F7748, 0xF27FA5, 0x7FCC19, 0xE5E533, 0x6699D8, 0xB24CD8, 0xD87F33
];
const SHADES = [0.71, 0.86, 1, 0.53];
const IDLE_FLUSH_MS = 2500;
const MAX_SETS = 40;

const enabled = process.env.IMPERIALS_CAPTCHA_SAMPLES !== 'off';
const directory = path.join(process.cwd(), 'captcha_samples');
let setCount = 0;
const pending = new Map(); // username -> { maps: Map, timer }

function renderPng(pixels) {
    const canvas = createCanvas(MAP_SIZE, MAP_SIZE);
    const context = canvas.getContext('2d');
    const image = context.createImageData(MAP_SIZE, MAP_SIZE);
    for (let index = 0; index < MAP_SIZE * MAP_SIZE; index += 1) {
        const packed = pixels[index];
        const output = index * 4;
        // Palette index 0 is Minecraft's CLEAR colour -> stay transparent.
        if (packed === 0) continue;
        const rgb = PALETTE[packed >> 2] ?? 0x909090;
        const brightness = SHADES[packed & 3];
        image.data[output] = Math.min(255, Math.round(((rgb >> 16) & 0xff) * brightness));
        image.data[output + 1] = Math.min(255, Math.round(((rgb >> 8) & 0xff) * brightness));
        image.data[output + 2] = Math.min(255, Math.round((rgb & 0xff) * brightness));
        image.data[output + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toBuffer('image/png');
}

function flush(username) {
    const entry = pending.get(username);
    if (!entry) return;
    pending.delete(username);
    if (!entry.maps.size) return;
    if (setCount >= MAX_SETS) return;

    try {
        if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
        setCount += 1;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const name = `${String(setCount).padStart(3, '0')}_${username}_${stamp}`;
        const saved = [];
        for (const [mapId, pixels] of entry.maps) {
            const file = path.join(directory, `${name}_map${mapId}.png`);
            fs.writeFileSync(file, renderPng(pixels));
            saved.push({ mapId, file: path.basename(file) });
        }
        fs.writeFileSync(
            path.join(directory, `${name}.json`),
            JSON.stringify({ username, maps: saved }, null, 2)
        );
        console.log(`[captcha-samples] saved ${saved.length} map(s) as ${name}`);
    } catch (err) {
        console.warn(`[captcha-samples] failed: ${err.message}`);
    }
}

export function recordCaptchaMaps(username, maps) {
    if (!enabled || !username) return;
    if (!pending.has(username)) pending.set(username, { maps: new Map(), timer: null });
    const entry = pending.get(username);

    for (const { mapId, pixels } of maps) {
        if (pixels && pixels.length === MAP_SIZE * MAP_SIZE) entry.maps.set(mapId, pixels);
    }
    if (entry.timer) clearTimeout(entry.timer);
    // Parts of one picture arrive in a burst; wait until it stops.
    entry.timer = setTimeout(() => flush(username), IDLE_FLUSH_MS);
    entry.timer.unref?.();
}