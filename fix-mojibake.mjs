// Repair double-encoded Cyrillic: UTF-8 bytes were read as CP1251 and written
// back as UTF-8, turning "Ожидание" into "РћР¶РёРґР°РЅРёРµ".
// ASCII passes through CP1251 unchanged, so the code itself is unaffected.
import fs from 'fs';

const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');

// CP1251 -> Unicode table (0x80-0xBF mirrors U+0400-U+043F, 0xC0-0xFF mirrors U+0410-U+044F)
const toByte = new Map();
for (let i = 0x80; i <= 0xBF; i += 1) toByte.set(String.fromCharCode(0x0400 + (i - 0x80)), i);
for (let i = 0xC0; i <= 0xFF; i += 1) toByte.set(String.fromCharCode(0x0410 + (i - 0xC0)), i);
for (let i = 0xA8; i <= 0xB4; i += 1) toByte.set(String.fromCharCode(i), i); // Ё ё

let repaired = '';
let untouched = true;
for (const ch of text) {
    const code = ch.codePointAt(0);
    const byte = toByte.get(ch);
    if (byte !== undefined && code > 0x7F) {
        repaired += String.fromCharCode(byte);
        untouched = false;
    } else {
        repaired += ch;
    }
}

if (untouched) {
    console.log('испорченных символов не найдено');
    process.exit(0);
}

const bytes = Buffer.from(repaired, 'latin1');
const fixed = bytes.toString('utf8');

fs.writeFileSync(file, fixed, 'utf8');

const before = (text.match(/Р/g) || []).length;
console.log(`восстановлено, было символов "Р": ${before}`);
console.log('проверка:', fixed.includes('Ожидание') ? 'Ожидание найдено' : 'НЕ НАЙДЕНО');
console.log('проверка:', fixed.includes('Карта') ? 'Карта найдено' : 'НЕ НАЙДЕНО');