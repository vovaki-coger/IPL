// One single attempt, no proxy: connect from home IP, capture the captcha link,
// then fetch that same link from home IP and report what the site answers.
import mineflayer from 'mineflayer';
import https from 'https';

const bot = mineflayer.createBot({
    username: `HomeTest${Date.now() % 100000}`,
    host: 'mc.reallyworld.me',
    port: 25565,
    version: '26.1',
    auth: 'offline',
    connectTimeout: 20000
});

let link = null;
let done = false;

bot.on('messagestr', (m) => {
    const text = String(m);
    const u = text.match(/https?:\/\/\S+/);
    if (u) {
        link = u[0].replace(/[.,)\]]+$/, '');
        console.log(`\n[СЕРВЕР] ${text.slice(0, 120)}`);
        console.log(`[ССЫЛКА] ${link}`);
    } else if (text.trim()) {
        console.log(`[ЧАТ] ${text.slice(0, 120)}`);
    }
});
bot.on('kicked', r => console.log('[КИК]', JSON.stringify(r).slice(0, 200)));
bot.on('error', e => console.log('[ОШИБКА]', e.message));
bot.on('end', () => console.log('[СЕРВЕР] закрыл соединение'));

function probe(url) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36' },
            timeout: 20000
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({
                status: res.statusCode,
                len: body.length,
                title: (body.match(/<title>([^<]*)<\/title>/i) || [])[1] || '(нет title)',
                turnstile: /challenges\.cloudflare\.com\/turnstile/i.test(body)
            }));
        });
        req.on('error', e => resolve({ error: e.message }));
    });
}

setTimeout(async () => {
    if (done) return;
    done = true;
    console.log('\n================ РЕЗУЛЬТАТ ================');
    if (!link) {
        console.log('ссылку поймать не удалось');
    } else {
        console.log('запрашиваю ссылку С ТОГО ЖЕ IP (домашнего):');
        console.log(await probe(link));
        console.log('\nжду 20 сек и проверяю ту же ссылку ещё раз (устарела ли):');
        await new Promise(r => setTimeout(r, 20000));
        console.log(await probe(link));
    }
    process.exit(0);
}, 30000);