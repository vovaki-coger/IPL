// BotFilter gives the captcha map as a real inventory item (slot 36),
// not as a GUI window. Dump the inventory to see what the bot actually holds.
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
    username: process.argv[2] || 'DiagBot11',
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;

const dump = (where) => {
    const items = bot.inventory?.items() || [];
    console.log(t(), `${where}: предметов=${items.length}`);
    items.forEach((item, i) => {
        const comps = item.components || item.nbt || {};
        let extra = '';
        try {
            const json = JSON.stringify(comps);
            if (/map|custom|lore|name/i.test(json)) extra = ' | ' + json.slice(0, 400);
        } catch { }
        console.log(`    slot=${item.slot} ${item.name} x${item.count} id=${item.type}${extra}`);
    });
};

bot.on('spawn', () => { console.log(t(), 'SPAWN', bot.entity?.position); setTimeout(() => dump('через 2с после спавна'), 2000); });
bot.on('messagestr', m => console.log(t(), 'MSG', String(m).slice(0, 150)));
bot.on('kicked', r => { console.log(t(), 'KICK', JSON.stringify(r).slice(0, 200)); dump('в момент кика'); });

setTimeout(() => { dump('итог'); bot.quit(); process.exit(0); }, 100000);