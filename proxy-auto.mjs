// Find a live SOCKS5 proxy AND log in through it in one pass, because free
// proxies usually die within minutes of being listed.
//   node proxy-auto.mjs <ник> <хост> <порт> [сколькоПроверить]
import axios from 'axios';
import mineflayer from 'mineflayer';
import { ProxyAgent } from 'proxy-agent';
import { SocksClient } from 'socks';

const [, , username, host, portArg, limitArg] = process.argv;
const port = parseInt(portArg || '25565', 10);
const limit = parseInt(limitArg || '400', 10);

const SOURCE = 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt';

console.log(`беру список SOCKS5 и ищу живой для ${host}:${port}...`);
const list = (await (await fetch(SOURCE, { timeout: 15000 })).text())
    .split('\n').map(s => s.trim()).filter(s => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(s));
console.log(`в списке ${list.length}, проверю ${limit}`);

function tunnelTest(proxy, timeout = 5000) {
    return new Promise((resolve) => {
        const [pHost, pPort] = proxy.split(':');
        SocksClient.createConnection({
            proxy: { host: pHost, port: parseInt(pPort, 10), type: 5 },
            command: 'connect',
            destination: { host, port },
            timeout
        }, (err) => resolve(!err));
    });
}

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(0)}s]`;

async function tryLogin(proxy) {
    const [pHost, pPort] = proxy.split(':');
    const proxyUrl = `socks5://${proxyHostPort(proxy)}`;
    return new Promise((resolve) => {
        const options = {
            username, host, port, version: '26.1', auth: 'offline', connectTimeout: 15000
        };
        try {
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
        } catch { /* ignore */ }

        let done = false;
        const finish = (result) => { if (!done) { done = true; try { bot.quit(); } catch { } resolve(result); } };

        const bot = mineflayer.createBot(options);
        bot.on('login', () => console.log(t(), `  ${proxy} -> ЛОГИН ОК`));
        bot.on('messagestr', (m) => {
            const text = String(m).replace(/\n+/g, ' | ');
            console.log(t(), `  MSG ${text.slice(0, 200)}`);
            const link = text.match(/https?:\/\/[^\s]+/);
            if (link) {
                finish({ proxy, link: link[0] });
            }
        });
        bot.on('spawn', () => console.log(t(), `  ${proxy} -> СПАВН`));
        bot.on('error', () => finish(null));
        bot.on('kicked', (r) => console.log(t(), `  ${proxy} -> КИК ${String(JSON.stringify(r)).slice(0, 120)}`));
        setTimeout(() => finish(null), 20000);
    });
}

function proxyHostPort(proxy) {
    return proxy.replace('socks5://', '');
}

let checked = 0;
for (const proxy of list.slice(0, limit)) {
    checked += 1;
    if (!(await tunnelTest(proxy))) continue;
    const result = await tryLogin(proxy);
    if (result) {
        console.log(`\n=== ЖИВОЙ ПРОКСИ: ${result.proxy} ===`);
        console.log(`ссылка капчи: ${result.link}`);
        // try to open it from the same proxy IP
        const [pHost, pPort] = result.proxy.split(':');
        try {
            const agent = new ProxyAgent({ getProxyForUrl: () => `socks5://${pHost}:${pPort}` });
            const res = await axios.get(result.link, {
                timeout: 12000, maxRedirects: 5, validateStatus: () => true,
                httpsAgent: agent, httpAgent: agent
            });
            console.log(`HTTP ${res.status}, ${String(res.data || '').length} байт`);
            console.log('--- ТЕЛО ОТВЕТА ---');
            console.log(String(res.data || '').slice(0, 1200));
            console.log('--- КОНЕЦ ---');
        } catch (e) {
            console.log(`запрос ссылки: ${e.message}`);
        }
        process.exit(0);
    }
    if (checked % 50 === 0) console.log(t(), `  ...проверено ${checked}`);
}
console.log(`\nживых не нашлось из ${checked}`);
process.exit(1);

function proxyHostPortUnused() {}