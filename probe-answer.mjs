// Where does the answer actually live? Dump every chat component the server
// sends during the captcha, including item/lore/click data.
import mineflayer from 'mineflayer';
import fs from 'fs';

const bot = mineflayer.createBot({
    username: process.argv[2] || 'DiagBot4',
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;
let n = 0;

function collect(node, found, depth = 0) {
    if (depth > 12 || node == null || Buffer.isBuffer(node)) return;
    if (Array.isArray(node)) {
        for (const item of node) collect(item, found, depth + 1);
        return;
    }
    if (typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
        const k = key.toLowerCase();
        if (/item|map|customname|lore|clickevent|hoverevent|value|text|nbt|components/.test(k)) {
            found.push({ key, value });
        }
        collect(value, found, depth + 1);
    }
}

bot.on('spawn', () => console.log(t(), 'SPAWN'));
bot.on('windowOpen', w => console.log(t(), 'WINDOW_OPEN', JSON.stringify(w.title).slice(0, 160)));
let mapPackets = 0;
bot._client.on('packet', (packet, meta) => {
    if (meta?.name === 'map') {
        mapPackets += 1;
        console.log(t(), `MAP PACKET #${mapPackets} id=${packet.itemDamage ?? packet.mapId}`);
    }
});
bot.on('message', (jsonMsg, position) => {
    n += 1;
    let text = '';
    try { text = jsonMsg.toString(); } catch { return; }
    const found = [];
    collect(jsonMsg, found);
    const interesting = found.filter(f =>
        /map|item|customname|lore|clickevent/i.test(f.key)
    );
    console.log('='.repeat(70));
    console.log(t(), `MSG#${n} [${position}]`);
    console.log('TEXT:', JSON.stringify(text).slice(0, 400));
    console.log('INTERESTING FIELDS:', JSON.stringify(interesting).slice(0, 2500));
    fs.appendFileSync('captcha_raw_messages.json', JSON.stringify(jsonMsg) + '\n');
});

bot.on('kicked', r => console.log(t(), 'KICK', JSON.stringify(r).slice(0, 200)));
setTimeout(() => {
    console.log(t(), `ИТОГ: сообщений=${n}, map-пакетов=${mapPackets}, спавн=${!!bot.entity}`);
    bot.quit();
    process.exit(0);
}, 90000);