// How long does the bot survive on a direct home-IP connection?
// Free proxies died in ~30-60s; if this holds for minutes, the dead-link
// problem was never about the URL at all.
import mineflayer from 'mineflayer';

const start = Date.now();
const elapsed = () => `${Math.round((Date.now() - start) / 1000)}s`;

const bot = mineflayer.createBot({
    username: `Hold${Date.now() % 100000}`,
    host: 'mc.reallyworld.me',
    port: 25565,
    version: '26.1',
    auth: 'offline',
    connectTimeout: 20000
});

let kickReason = null;
bot.on('messagestr', (m) => {
    const t = String(m).replace(/\s+/g, ' ');
    if (!/^\s*https?:/.test(t) && t.trim()) console.log(`[${elapsed()}] [ЧАТ] ${t.slice(0, 100)}`);
});
bot.on('spawn', () => console.log(`[${elapsed()}] ЗАШЁЛ В ИГРУ`));
bot.on('kicked', (r) => { kickReason = JSON.stringify(r).slice(0, 200); console.log(`[${elapsed()}] КИК: ${kickReason}`); });
bot.on('end', (r) => console.log(`[${elapsed()}] СЕРВЕР ОБОРВАЛ: ${r}`));
bot.on('error', (e) => console.log(`[${elapsed()}] ОШИБКА: ${e.message}`));

setTimeout(() => {
    console.log(`\n=== итог: ${elapsed()} ===`);
    console.log(kickReason ? `бот выкинут: ${kickReason}` : 'бот держится, выкинут не был');
    process.exit(0);
}, 180000);