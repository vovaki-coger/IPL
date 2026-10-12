// Regression test: the math solver must not fire on ordinary server chatter.
import AntiAntiBot from './src/plugins/Anti-AntiBot.js';

const sent = [];
const logs = [];
const botClient = { username: 'T', config: {}, log: m => logs.push(m), emit: () => { } };
const bot = { on: () => { }, removeListener: () => { }, chat: m => sent.push(m) };
const api = {
    bot, botClient, log: m => logs.push(m), chat: m => sent.push(m),
    reconnect: () => { }, on: () => api
};

const p = new AntiAntiBot();
p.init(bot, api);
p.enabled = true;

const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
    if (ok) { pass++; console.log(`  OK   ${name}`); }
    else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

console.log('\n1. Реальная капча решается');
sent.length = 0;
await p.handleChat('Solve: 12 + 7', true);
await wait(3600);
check('ответил 19', sent.includes('19'), JSON.stringify(sent));

console.log('\n2. Обычные сообщения сервера НЕ трогаются');
const chatter = [
    'Проверка 9 - 810',
    'Выполнено 9 - 810 действий',
    'Позиция: 3 - 5769, 12',
    'verify progress 5 - 100',
    'Captcha загружается, 2 - 8',
    'Счёт 9 - 810 обновлён'
];
for (const m of chatter) {
    sent.length = 0;
    await p.handleChat(m, true);
    await wait(60);
    check(`молчит на "${m}"`, sent.length === 0, JSON.stringify(sent));
}

console.log('\n3. Повторная капча не спамит');
sent.length = 0;
await p.handleChat('Solve: 12 + 7', true);
await wait(300);
check('второй раз промолчал (кулдаун)', sent.length === 0, JSON.stringify(sent));

console.log('\n4. Реальные форматы капч');
const cases = [
    ['What is 8 + 9?', '17'],
    ['answer 6 * 7', '42'],
    ['Solve 10 - 3 = ?', '7']
];
for (const [msg, want] of cases) {
    sent.length = 0;
    p.lastMathAnswer = 0;
    await p.handleChat(msg, true);
    await wait(3600);
    check(`"${msg}" -> ${want}`, sent.includes(want), JSON.stringify(sent));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);