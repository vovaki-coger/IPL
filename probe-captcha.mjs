// Что именно сервер кладёт в сообщение капчи: есть ли там карта (map item)?
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
    username: process.argv[2] || 'DiagBot2',
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;

bot.on('spawn', () => console.log(t(), 'SPAWN'));

let dumped = 0;
bot.on('message', (jsonMsg, position) => {
    let text = '';
    try { text = jsonMsg.toString(); } catch { return; }
    if (!/символ|картинк|капч|BOMJ/i.test(text)) return;
    if (dumped++ > 2) return;
    console.log('='.repeat(70));
    console.log(t(), 'MESSAGE position =', position);
    console.log('TEXT:', JSON.stringify(text));
    console.log('--- СЫРОЙ JSON ---');
    try {
        console.log(JSON.stringify(jsonMsg, null, 1).slice(0, 4000));
    } catch (e) {
        console.log('не сериализуется:', e.message);
    }
});

bot.on('windowOpen', w => console.log(t(), 'WINDOW_OPEN', JSON.stringify(w.title).slice(0, 200)));
bot.on('kicked', r => console.log(t(), 'KICK', JSON.stringify(r).slice(0, 300)));

setTimeout(() => { bot.quit(); process.exit(0); }, 25000);