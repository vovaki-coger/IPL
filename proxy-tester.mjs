// Test public SOCKS5 proxies for real Minecraft TCP reachability.
// Mining-flavoured proxies fail on plain HTTP, so every candidate is verified
// by opening an actual TCP tunnel to the game server through it.
//   node proxy-tester.mjs <host> <port> [limit]
import { SocksClient } from 'socks';

const host = process.argv[2] || 'mc.reallyworld.ru';
const port = parseInt(process.argv[3] || '25565', 10);
const limit = parseInt(process.argv[4] || '120', 10);

const SOURCES = [
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=ipport&format=text'
];

async function fetchList() {
    const all = new Set();
    for (const url of SOURCES) {
        try {
            const res = await fetch(url, { timeout: 15000 });
            const text = await res.text();
            let added = 0;
            for (const line of text.split('\n')) {
                const value = line.trim();
                if (/^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(value)) {
                    all.add(value);
                    added += 1;
                }
            }
            console.log(`источник ${url.split('/').slice(-1)[0].slice(0, 30)}: +${added}`);
        } catch (err) {
            console.log(`источник не ответил: ${err.message}`);
        }
    }
    return [...all];
}

function testProxy(proxy, timeoutMs = 6000) {
    return new Promise((resolve) => {
        const [pHost, pPort] = proxy.split(':');
        SocksClient.createConnection({
            proxy: { host: pHost, port: parseInt(pPort, 10), type: 5 },
            command: 'connect',
            destination: { host, port },
            timeout: timeoutMs
        }, (err) => resolve(!err));
    });
}

const all = await fetchList();
console.log(`\nвсего уникальных SOCKS5: ${all.length}`);
const candidates = all.slice(0, limit);
console.log(`проверяю ${candidates.length} на ${host}:${port} ...\n`);

const working = [];
let checked = 0;
const CONCURRENCY = 25;

async function worker() {
    while (candidates.length) {
        const proxy = candidates.shift();
        if (!proxy) return;
        checked += 1;
        const ok = await testProxy(proxy).catch(() => false);
        if (ok) {
            working.push(proxy);
            console.log(`  РАБОТАЕТ  ${proxy}`);
        }
        if (checked % 25 === 0) console.log(`  ...проверено ${checked}, нашли ${working.length}`);
    }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\n=== ИТОГ ===`);
console.log(`проверено: ${checked}`);
console.log(`рабочих: ${working.length}`);
if (working.length) {
    console.log('\nсписок:');
    working.forEach(p => console.log(p));
}
process.exit(0);