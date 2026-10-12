// Is the captcha link bound to the session IP?
// Connect THROUGH a proxy, then fetch that link from the proxy IP and from the
// home IP. If they differ, the server is checking where the link was opened.
import mineflayer from 'mineflayer';
import { SocksClient } from 'socks';
import { ProxyAgent } from 'proxy-agent';
import https from 'https';

const host = 'mc.reallyworld.me';
const port = 25565;

const raw = await (await fetch('https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', { timeout: 15000 })).text();
const list = raw.split(/\r?\n/).map(s => s.trim()).filter(s => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(s));

const probe = (proxy, timeout = 5000) => new Promise((resolve) => {
    const [h, p] = proxy.split(':');
    SocksClient.createConnection({
        proxy: { host: h, port: +p, type: 5 },
        command: 'connect', destination: { host, port }, timeout
    }, () => resolve(true));
});

let proxy = null;
for (const p of list) { if (await probe(p)) { proxy = p; break; } }
if (!proxy) { console.log('живых прокси нет'); process.exit(1); }
console.log('прокси бота:', proxy);

const [pHost, pPort] = proxy.split(':');
let link = null;

const bot = mineflayer.createBot({
    username: `Bind${Date.now() % 100000}`,
    host, port, version: '26.1', auth: 'offline', connectTimeout: 15000,
    connect: (client) => SocksClient.createConnection({
        proxy: { host: pHost, port: +pPort, type: 5 },
        command: 'connect', destination: { host, port }, timeout: 12000
    }, (err, info) => err ? client.emit('error', err) : (client.setSocket(info.socket), client.emit('connect')))
});
bot.on('messagestr', (m) => {
    if (link) return;
    const u = String(m).match(/https?:\/\/\S+/);
    if (u) { link = u[0].replace(/[.,)\]]+$/, ''); console.log('ссылка получена:', link); }
});
bot.on('error', () => { });

function fetchVia(url, proxyUrl) {
    return new Promise((resolve) => {
        const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0' }, timeout: 20000 };
        if (proxyUrl) opts.agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
        const req = https.get(url, opts, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({
                status: res.statusCode,
                title: (body.match(/<title>([^<]*)<\/title>/i) || [])[1] || '(нет title)',
                turnstile: /challenges\.cloudflare\.com\/turnstile/i.test(body)
            }));
        });
        req.on('error', e => resolve({ error: e.message }));
    });
}

setTimeout(async () => {
    console.log('\n=== A) ссылка открыта С IP прокси (тот же, что у сессии) ===');
    console.log(await fetchVia(link, `socks5://${pHost}:${pPort}`));
    console.log('\n=== B) та же ссылка открыта С ДОМАШНЕГО IP (другой IP) ===');
    console.log(await fetchVia(link, null));
    process.exit(0);
}, 40000);