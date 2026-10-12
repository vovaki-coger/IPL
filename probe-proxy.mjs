// Connect to the server through a SOCKS5 proxy and report the captcha,
// then try to open the verification link from the SAME proxy IP.
//   node probe-proxy.mjs <ник> <хост> <порт> <socksHost:socksPort>
import axios from 'axios';
import mineflayer from 'mineflayer';
import { ProxyAgent } from 'proxy-agent';
import { SocksClient } from 'socks';

const [, , username, host, portArg, proxyArg] = process.argv;
const port = parseInt(portArg || '25565', 10);
const [proxyHost, proxyPort] = (proxyArg || '').split(':');
if (!proxyHost) {
    console.log('usage: node probe-proxy.mjs <ник> <хост> <порт> <socks:socksPort>');
    process.exit(1);
}
const proxyUrl = `socks5://${proxyHost}:${proxyPort}`;

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;

const botOptions = {
    username,
    host,
    port,
    version: '26.1',
    auth: 'offline',
    connectTimeout: 30000,
    agent: new ProxyAgent({ getProxyForUrl: () => proxyUrl })
};

botOptions.connect = (client) => {
    console.log(t(), `SOCKS: соединяюсь через ${proxyUrl}`);
    SocksClient.createConnection({
        proxy: { host: proxyHost, port: parseInt(proxyPort, 10), type: 5 },
        command: 'connect',
        destination: { host: client.host || host, port },
        timeout: 20000
    }, (err, info) => {
        if (err) {
            console.log(t(), 'SOCKS ОШИБКА:', err.message);
            client.emit('error', err);
            return;
        }
        info.socket.on('error', (e) => console.log(t(), 'сокет:', e.message));
        client.setSocket(info.socket);
        client.emit('connect');
    });
};

const bot = mineflayer.createBot(botOptions);
const links = [];

bot.on('login', () => console.log(t(), 'ЛОГИН прошёл'));
bot.on('spawn', () => console.log(t(), 'СПАВН'));
bot.on('messagestr', (m) => {
    const text = String(m);
    console.log(t(), 'MSG', text.replace(/\n+/g, ' | ').slice(0, 300));
    const found = text.match(/https?:\/\/[^\s]+/g);
    if (found) found.forEach(u => links.push(u));
});
bot.on('kicked', (r) => console.log(t(), 'КИК', JSON.stringify(r).slice(0, 200)));
bot.on('error', (e) => console.log(t(), 'ОШИБКА', e.message));

setTimeout(async () => {
    console.log('\n=== НАЙДЕННЫЕ ССЫЛКИ ===');
    if (!links.length) console.log('  ссылок в чате не было');
    for (const link of [...new Set(links)]) {
        console.log(`  ${link}`);
        try {
            const res = await axios.get(link, {
                timeout: 12000,
                proxy: false,
                httpsAgent: new ProxyAgent({ getProxyForUrl: () => proxyUrl }),
                httpAgent: new ProxyAgent({ getProxyForUrl: () => proxyUrl }),
                validateStatus: () => true,
                maxRedirects: 5
            });
            const body = String(res.data || '');
            console.log(`    HTTP ${res.status}, ${body.length} байт`);
            const verdict = /captcha|verify|error|denied|невер/i.test(body) ? 'возможно нужен браузер/JS' : 'похоже на успех';
            console.log(`    вердикт: ${verdict}`);
        } catch (err) {
            console.log(`    ошибка запроса: ${err.message}`);
        }
    }
    process.exit(0);
}, 45000);