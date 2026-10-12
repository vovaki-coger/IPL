// Диагностика входа: голый mineflayer-бот, печатает КАЖДОЕ событие с таймингом.
// Запуск: node diagnose-join.mjs <ник> <хост> [порт] [версия]
import mineflayer from 'mineflayer';

const [, , username, host, portArg, versionArg] = process.argv;
if (!username || !host) {
    console.log('Использование: node diagnose-join.mjs <ник> <хост> [порт] [версия]');
    process.exit(1);
}
const port = parseInt(portArg || '25565', 10);
const version = versionArg || '26.1';

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;
const log = (tag, ...rest) => console.log(t(), tag, ...rest);

log('CONNECT', `ник=${username} хост=${host}:${port} версия=${version}`);

const bot = mineflayer.createBot({
    username,
    host,
    port,
    version,
    auth: 'offline',
    connectTimeout: 30000
});

bot.on('login', () => log('LOGIN', 'сервер принял логин'));
bot.on('spawn', () => log('SPAWN', '!!! ИГРОВОЕ СОСТОЯНИЕ !!!'));
bot.on('message', (jsonMsg, position) => {
    let text = '';
    try { text = jsonMsg.toString(); } catch { return; }
    log('MESSAGE', `[${position}]`, JSON.stringify(text).slice(0, 300));
});
bot.on('chat', (user, msg) => log('PLAYER_CHAT', user, JSON.stringify(String(msg)).slice(0, 200)));
bot.on('whisper', (user, msg) => log('WHISPER', user, String(msg).slice(0, 200)));
bot.on('windowOpen', (w) => log('WINDOW_OPEN', 'title=', JSON.stringify(w.title).slice(0, 200)));
bot.on('entitySpawn', (e) => {
    if (e.type === 'player' && e.username !== username) log('PLAYER_SPAWN', e.username);
});
bot.on('kicked', (reason) => log('KICKED', JSON.stringify(reason).slice(0, 500)));
bot.on('error', (err) => log('ERROR', err.message));
bot.on('end', (reason) => log('END', String(reason)));
bot.on('timeout', () => log('TIMEOUT', 'нет ответа от сервера'));

bot.on('login', () => {
    log('INFO', 'жду spawn 90 секунд, слушаю всё подряд...');
});

setTimeout(() => {
    if (bot.entity) {
        log('ИТОГ', 'СПАВН ЕСТ, всё хорошо. Позиция', bot.entity.position);
    } else {
        log('ИТОГ', 'СПАВНА НЕ БЫЛО - сервер держит бота на логине');
    }
    bot.quit();
    process.exit(0);
}, 90000);