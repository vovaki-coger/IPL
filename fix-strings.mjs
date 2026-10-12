import fs from 'fs';

const file = 'public/app.js';
const lines = fs.readFileSync(file, 'utf8').split('\n');

// line number (1-based) -> corrected source line
const fixes = {
    1754: "        if (mapPaneCoords) mapPaneCoords.textContent = 'ПКМ по карте - повернуть её на 90°';",
    1787: "        placeholder.textContent = 'Карты пока нет';",
    1804: "        `${orderedMapIds(latestManualWindow).length} карт · ПКМ - повернуть · Esc - закрыть`;",
    1869: "        note.textContent = 'Ожидаю данные изображения от сервера…';"
};

for (const [num, text] of Object.entries(fixes)) {
    lines[Number(num) - 1] = text;
}

fs.writeFileSync(file, lines.join('\n'), 'utf8');
console.log('исправлено строк:', Object.keys(fixes).join(', '));
const rest = lines.filter(l => /Р[Р-џ]/.test(l));
console.log('осталось битых строк:', rest.length);
rest.forEach(l => console.log('  ' + l.trim().slice(0, 90)));