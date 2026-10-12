import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
    username: process.argv[2] || 'DiagBot9',
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;
let maps = 0;
const seen = new Set();

bot._client.on('packet', (packet, meta) => {
    const n = meta?.name;
    if (!n) return;
    if (n === 'map') { maps += 1; return; }

    if (['set_title', 'set_title_subtitle', 'set_title_text', 'set_action_bar_text',
         'boss_bar', 'system_chat', 'player_chat'].includes(n)) {
        const text = JSON.stringify(packet).slice(0, 300);
        if (seen.has(text)) return;
        seen.add(text);
        console.log(t(), n.toUpperCase(), text);
    }
});

bot.on('spawn', () => console.log(t(), '*** SPAWN ***', bot.entity?.position));
bot.on('windowOpen', w => console.log(t(), '*** WINDOW_OPEN ***', JSON.stringify(w.title).slice(0, 200)));
bot.on('messagestr', m => console.log(t(), 'MSG', JSON.stringify(String(m).slice(0, 200))));
bot.on('kicked', r => console.log(t(), 'KICK', JSON.stringify(r).slice(0, 200)));
bot.on('end', r => console.log(t(), 'END', String(r)));

setTimeout(() => {
    console.log(t(), `ИТОГ: карт=${maps}, спавн=${!!bot.entity}, позиция=${bot.entity?.position}`);
    bot.quit();
    process.exit(0);
}, 120000);