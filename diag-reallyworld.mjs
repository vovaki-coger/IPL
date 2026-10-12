// Full handshake diagnostic through live proxies: does the server run a
// movement/falling check before the captcha, and what is the kick reason?
import mineflayer from 'mineflayer';
import { SocksClient } from 'socks';

const host = 'mc.reallyworld.ru';
const port = 25565;

const list = (await (await fetch('https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', { timeout: 15000 })).text())
    .split('\n').map(s => s.trim()).filter(s => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(s));
console.log(`кандидатов: ${list.length}`);

const tunnel = (proxy, timeout = 5000) => new Promise((resolve) => {
    const [h, p] = proxy.split(':');
    SocksClient.createConnection({
        proxy: { host: h, port: parseInt(p, 10), type: 5 },
        command: 'connect', destination: { host, port }, timeout
    }, (err) => resolve(!err));
});

function diagnose(proxy) {
    const [pHost, pPort] = proxy.split(':');
    return new Promise((resolve) => {
        const start = Date.now();
        const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;
        const report = { proxy, teleports: 0, ourPositions: [], chat: [], kick: null, spawn: false, login: false };

        const options = {
            username: `Diag${Date.now() % 100000}`, host, port,
            version: '26.1', auth: 'offline', connectTimeout: 15000
        };
        options.connect = (client) => {
            SocksClient.createConnection({
                proxy: { host: pHost, port: parseInt(pPort, 10), type: 5 },
                command: 'connect',
                destination: { host: client.host || host, port },
                timeout: 12000
            }, (err, info) => {
                if (err) { client.emit('error', err); return; }
                client.setSocket(info.socket);
                client.emit('connect');
            });
        };

        let bot;
        try { bot = mineflayer.createBot(options); }
        catch (e) { resolve({ ...report, kick: 'createBot failed: ' + e.message }); return; }

        bot.on('login', () => { report.login = true; console.log(t(), '  ЛОГИН'); });
        bot.on('spawn', () => { report.spawn = true; console.log(t(), '  СПАВН', bot.entity?.position); });

        bot._client.on('packet', (data, meta) => {
            if (meta?.name === 'position' && data?.teleportId !== undefined) {
                report.teleports += 1;
                console.log(t(), `  СЕРВЕР-ТЕЛЕПОРТ y=${data.y} x=${data.x} z=${data.z} teleportId=${data.teleportId}`);
            }
        });

        // our own outgoing movement, to see whether it looks like a real fall
        bot._client.on('packet', (data, meta) => {
            if (meta?.name === 'position' && data?.teleportId === undefined && report.ourPositions.length < 14) {
                report.ourPositions.push(Number(data.y).toFixed(4));
            }
        }, true);

        bot.on('messagestr', (m) => {
            const s = String(m).replace(/\n+/g, ' | ');
            report.chat.push(s.slice(0, 160));
            console.log(t(), '  MSG', s.slice(0, 200));
        });
        bot.on('kicked', (r) => {
            report.kick = String(JSON.stringify(r)).slice(0, 400);
            console.log(t(), '  КИК:', report.kick.slice(0, 300));
        });
        bot.on('error', () => { });
        setTimeout(() => { try { bot.quit(); } catch { } resolve(report); }, 30000);
    });
}

let checked = 0;
for (const proxy of list) {
    checked += 1;
    if (!(await tunnel(proxy))) continue;
    console.log(`\n### пробую ${proxy}`);
    const r = await diagnose(proxy);
    console.log(`  итог: login=${r.login} spawn=${r.spawn} телепортов=${r.teleports}`);
    console.log(`  наши y: ${r.ourPositions.join(' ')}`);
    console.log(`  кик: ${r.kick || 'нет'}`);
    if (r.spawn || r.kick) {
        console.log('\n=== ПРОКСИ С РЕЗУЛЬТАТОМ:', proxy, '===');
        process.exit(0);
    }
    if (checked > 600) break;
}