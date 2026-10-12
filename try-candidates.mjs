// Try a list of candidate answers, each on a fresh connection, and report
// exactly what the server replies. Usage:
//   node try-candidates.mjs "BOMJPVP" "bomjpvp" "BOMJPVP.TOP" "top"
import mineflayer from 'mineflayer';

const candidates = process.argv.slice(2);
const WAIT = 26000;

function attempt(answer, index) {
    return new Promise((resolve) => {
        const bot = mineflayer.createBot({
            username: `Cand${Date.now() % 100000}`,
            host: 'gg.bomjpvp.top',
            port: 25565,
            version: '26.1',
            auth: 'offline'
        });
        let sent = false;
        let reply = '';
        let done = false;

        const finish = (verdict) => {
            if (done) return;
            done = true;
            try { bot.quit(); } catch { }
            resolve({ answer, reply: reply.trim().replace(/\n/g, ' | '), verdict });
        };

        bot.on('messagestr', (m) => {
            reply += `${String(m).replace(/\n+/g, ' ')} `;
            if (/провал|неверн/i.test(String(m)) && sent) finish('НЕВЕРНО');
            if (/принят|успеш|верно|правильн|проверк.*прошл/i.test(String(m)) && sent) finish('ПРИНЯТО');
        });
        bot.on('kicked', (r) => { if (sent) finish(`КИК: ${String(JSON.stringify(r)).slice(0, 90)}`); });

        setTimeout(() => {
            if (!sent) {
                sent = true;
                reply = '';
                try { bot.chat(answer); } catch (e) { finish('ОШИБКА ЧАТА ' + e.message); }
            }
        }, 8000);

        setTimeout(() => finish(sent ? 'таймаут' : 'кик до ответа'), WAIT);
    });
}

for (let i = 0; i < candidates.length; i += 1) {
    const r = await attempt(candidates[i], i);
    console.log(`\n>>> "${r.answer}"  =>  ${r.verdict}`);
    if (r.reply) console.log(`    сервер: ${r.reply.slice(0, 200)}`);
}