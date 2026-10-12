// Are captcha links one-time and short-lived, or reused? Log every link with
// timestamps and re-check the first one at the end.
import mineflayer from 'mineflayer';
import { SocksClient } from 'socks';
import https from 'https';

const host = 'mc.reallyworld.me';
const port = 25565;

const list = (await (await fetch('https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', { timeout: 15000 })).text())
    .split(/\r?\n/).map(s => s.trim()).filter(s => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(s));

const tunnel = (proxy, timeout = 5000) => new Promise((resolve) => {
    const [h, p] = proxy.split(':');
    SocksClient.createConnection({
        proxy: { host: h, port: parseInt(p, 10), type: 5 },
        command: 'connect', destination: { host, port }, timeout
    }, (e) => resolve(!e));
});

let proxy = null;
for (const p of list) { if (await tunnel(p)) { proxy = p; break; } }
if (!proxy) { console.log('живых прокси нет'); process.exit(1); }
console.log('прокси:', proxy);

const [pHost, pPort] = proxy.split(':');
const start = Date.now();
const links = [];

const bot = mineflayer.createBot({
    username: `LinkTest${Date.now() % 100000}`, host, port,
    version: '26.1', auth: 'offline', connectTimeout: 15000,
    connect: (client) => {
        SocksClient.createConnection({
            proxy: { host: pHost, port: parseInt(pPort, 10), type: 5 },
            command: 'connect',
            destination: { host: client.host || host, port }, timeout: 12000
        }, (err, info) => {
            if (err) { client.emit('error', err); return; }
            client.setSocket(info.socket);
            client.emit('connect');
        });
    }
});

bot.on('messagestr', (m) => {
    for (const u of String(m).match(/https?:\/\/\S+/g) || []) {
        const found = links.find(l => l.url === u);
        if (found) { found.repeat = (found.repeat || 1) + 1; }
        else { links.push({ url: u, at: ((Date.now() - start) / 1000).toFixed(1) }); console.log(`  [${((Date.now() - start) / 1000).toFixed(1)}s] НОВАЯ ссылка: ${u}`); }
    }
});
bot.on('kicked', r => console.log('  КИК:', String(JSON.stringify(r)).slice(0, 120)));
bot.on('error', () => { });

function check(url) {
    return new Promise((resolve) => {
        const agent = new (await import('proxy-agent')).ProxyAgent({ getProxyForUrl: () => `socks5://${pHost}:${pPort}` });
        https.get(url, { agent, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, len: body.length, head: body.slice(0, 80) }));
        }).on('error', e => resolve({ error: e.message }));
    });
}

setTimeout(async () => {
    console.log(`\nвсего уникальных ссылок: ${links.length}`);
    links.forEach(l => console.log(`  ${l.at}s${l.repeat ? ` (повторов: ${l.repeat})` : ''} ${l.url}`));
    if (links.length) {
        console.log('\n--- проверяю ПЕРВУЮ (самую старую) ссылку сейчас ---');
        console.log(await check(links[0].url));
        console.log('--- проверяю ПОСЛЕДНЮЮ (свежую) ---');
        console.log(await check(links[links.length - 1].url));
    }
    process.exit(0);
}, 70000);