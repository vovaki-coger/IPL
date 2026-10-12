// Does typing anything change the server's reaction?
// node try-answer.mjs <ник> <текст> [черезСек]
import mineflayer from 'mineflayer';

const [, , username, answer, delayArg] = process.argv;
const delay = parseInt(delayArg || '6', 10) * 1000;

const bot = mineflayer.createBot({
    username,
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;

bot.on('spawn', () => console.log(t(), 'SPAWN'));
bot.on('messagestr', m => console.log(t(), 'MSG', String(m).replace(/\n/g, ' | ').slice(0, 200)));
bot.on('messagestr', m => {});
bot.on('windowOpen', w => console.log(t(), 'WINDOW', JSON.stringify(w.title).slice(0, 150)));
bot.on('kicked', r => console.log(t(), 'KICK', JSON.stringify(r).slice(0, 250)));

setTimeout(() => {
    console.log(t(), `ПИШУ В ЧАТ: "${answer}"`);
    try { bot.chat(answer); } catch (e) { console.log(t(), 'ОШИБКА ЧАТА:', e.message); }
}, delay);

setTimeout(() => {
    console.log(t(), `ИТОГ: спавн=${!!bot.entity}, предметов=${bot.inventory?.items().length ?? 0}`);
    process.exit(0);
}, 95000);