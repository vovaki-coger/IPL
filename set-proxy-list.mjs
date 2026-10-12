// Put a working proxy list into settings.json for the bot to try.
import fs from 'fs';

// PowerShell redirection writes UTF-16LE, so sniff the encoding first.
const bytes = fs.readFileSync('pt.txt');
const isUtf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
const raw = bytes.toString(isUtf16 ? 'utf16le' : 'utf8');
const list = raw.split(/\r?\n/).map(s => s.trim()).filter(s => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(s));

let settings = {};
try {
    settings = JSON.parse(fs.readFileSync('settings.json', 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
    console.log('settings.json не читался, создаю заново:', e.message.slice(0, 60));
}

settings.port = settings.port || 3000;
settings.randomProxy = true;
settings.proxyList = list.join('\n');

fs.writeFileSync('settings.json', JSON.stringify(settings, null, 2), 'utf8');

const check = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
console.log('прокси записано:', list.length);
console.log('проверка: randomProxy =', check.randomProxy, ', строк в списке =', check.proxyList.split('\n').length);
console.log('первые:', check.proxyList.split('\n').slice(0, 5).join(', '));