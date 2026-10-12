// The server says "pictures can be rotated by clicking on them".
// Try interacting with the display entities and watch for any reaction.
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
    username: process.argv[2] || 'ClickProbe1',
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;
let clicked = 0;

bot.on('messagestr', (m) => console.log(t(), 'MSG', String(m).replace(/\n+/g, ' | ').slice(0, 220)));

const displays = [];
bot.on('entitySpawn', (e) => {
    if (e.type === 73 || /display/i.test(e.name || '')) displays.push(e);
});

setTimeout(() => {
    console.log(t(), `сущностей-дисплеев: ${displays.length}`);
    if (!displays.length) { console.log('нет дисплеев'); process.exit(0); }

    const target = displays[0];
    console.log(t(), `цель: id=${target.id} pos=${target.position}`);

    const sweep = () => {
        if (!bot.entity) return;
        try {
            bot.look(target.position.offset(0, 0.5, 0), true);
            bot.attack(target);
            clicked += 1;
        } catch (e) {
            console.log(t(), 'ошибка клика:', e.message);
        }
        if (clicked < 20) setTimeout(sweep, 300);
        else console.log(t(), 'кликов отправлено:', clicked);
    };
    sweep();
}, 5000);

bot.on('kicked', (r) => console.log(t(), 'KICK', JSON.stringify(r).slice(0, 150)));
setTimeout(() => process.exit(0), 45000);