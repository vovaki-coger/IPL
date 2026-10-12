// Log EVERY packet the server sends, plus every inventory slot (not just items()).
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
    username: process.argv[2] || 'DiagBot14',
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;
const counts = new Map();
const interesting = [];

bot._client.on('packet', (packet, meta) => {
    const name = meta?.name || 'unknown';
    counts.set(name, (counts.get(name) || 0) + 1);
    if (/slot|inventory|window|icon|decor|held|equipment|open/i.test(name)) {
        interesting.push(`${t()} ${name} ${JSON.stringify(packet).slice(0, 220)}`);
    }
});

bot.on('spawn', () => console.log(t(), 'SPAWN'));
bot.on('kicked', r => console.log(t(), 'KICK', JSON.stringify(r).slice(0, 120)));

setTimeout(() => {
    console.log('\n=== ПАКЕТЫ ПО ИМЕНАМ ===');
    [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`  ${c.toString().padStart(5)}  ${n}`));

    console.log('\n=== СЛОТЫ ИНВЕНТАРЯ (все 46) ===');
    const slots = bot.inventory?.slots || [];
    let used = 0;
    slots.forEach((s, i) => { if (s && s.type !== -1) { used += 1; console.log(`  slot ${i}: ${s.name} x${s.count}`); } });
    console.log(`  непустых слотов: ${used}`);

    console.log('\n=== ПАКЕТЫ ПРЕДМЕТОВ/ОКОН ===');
    interesting.slice(0, 30).forEach(l => console.log('  ' + l));
    if (!interesting.length) console.log('  таких пакетов не было');

    process.exit(0);
}, 25000);