// Does the server just want the player to hold still? Compare strategies:
// A) default physics, B) physics disabled, C) physics disabled + no look packets.
import mineflayer from 'mineflayer';
import { SocksClient } from 'socks';

const host = 'mc.reallyworld.ru';
const port = 25565;

const list = (await (await fetch('https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', { timeout: 15000 })).text())
    .split('\n').map(s => s.trim()).filter(s => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(s));

const tunnel = (proxy, timeout = 5000) => new Promise((resolve) => {
    const [h, p] = proxy.split(':');
    SocksClient.createConnection({
        proxy: { host: h, port: parseInt(p, 10), type: 5 },
        command: 'connect', destination: { host, port }, timeout
    }, (e) => resolve(!e));
});

function run(proxy, mode) {
    const [pHost, pPort] = proxy.split(':');
    return new Promise((resolve) => {
        const start = Date.now();
        const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;
        const rep = { mode, proxy, teleports: 0, spawn: false, kick: null, chat: [], moves: 0, looks: 0 };

        const options = {
            username: `Strat${Date.now() % 100000}`, host, port,
            version: '26.1', auth: 'offline', connectTimeout: 15000
        };
        options.connect = (client) => {
            SocksClient.createConnection({
                proxy: { host: pHost, port: parseInt(pPort, 10), type: 5 },
                command: 'connect',
                destination: { host: client.host || host, port }, timeout: 12000
            }, (err, info) => {
                if (err) { client.emit('error', err); return; }
                client.setSocket(info.socket);
                client.emit('connect');
            });
        };

        const bot = mineflayer.createBot(options);

        bot.on('spawn', () => {
            rep.spawn = true;
            console.log(t(), `  [${mode}] СПАВН!`, bot.entity?.position);
        });

        bot.on('messagestr', (m) => {
            const s = String(m).replace(/\n+/g, ' | ');
            rep.chat.push(s.slice(0, 120));
            console.log(t(), `  [${mode}] MSG`, s.slice(0, 200));
        });
        bot.on('kicked', (r) => {
            rep.kick = String(JSON.stringify(r)).slice(0, 300);
            console.log(t(), `  [${mode}] КИК:`, rep.kick.slice(0, 250));
        });
        bot.on('error', () => { });

        bot._client.on('packet', (data, meta) => {
            if (meta?.name === 'position' && data?.teleportId !== undefined) rep.teleports += 1;
        });

        // count what WE send
        const write = bot._client.write.bind(bot._client);
        bot._client.write = (name, data) => {
            if (name === 'position' || name === 'position_look') rep.moves += 1;
            if (name === 'look') rep.looks += 1;
            return write(name, data);
        };

        setTimeout(() => {
            if (mode === 'noPhysics' || mode === 'noPhysicsNoLook') bot.physicsEnabled = false;
            if (mode === 'noPhysicsNoLook') {
                bot._client.write = (name, data) => (name === 'look' ? undefined : write(name, data));
            }
            console.log(`  [${mode}] применяю режим на ${Date.now()}`);
        }, 1500);

        setTimeout(() => { try { bot.quit(); } catch { } resolve(rep); }, 26000);
    });
}

const live = [];
for (const proxy of list) {
    if (await tunnel(proxy)) { live.push(proxy); if (live.length >= 3) break; }
}
console.log(`живых прокси: ${live.length}`);

for (const proxy of live) {
    for (const mode of ['default', 'noPhysics', 'noPhysicsNoLook']) {
        console.log(`\n### ${proxy} / ${mode}`);
        const r = await run(proxy, mode);
        console.log(`  РЕЗУЛЬТАТ [${mode}] spawn=${r.spawn} телепортов=${r.teleports} наших movement=${r.moves} look=${r.looks}`);
        if (r.kick) console.log(`  кик: ${r.kick.slice(0, 200)}`);
        if (r.spawn) { console.log('\n>>> СПАВН ЕСТ'); process.exit(0); }
    }
}