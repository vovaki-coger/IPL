// The captcha maps arrive as spawned display entities. Their metadata should
// carry the map item - possibly with a custom name or lore holding the answer.
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
    username: process.argv[2] || 'DiagBot16',
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

const start = Date.now();
const t = () => `[${((Date.now() - start) / 1000).toFixed(1)}s]`;
let shown = 0;

bot._client.on('packet', (packet, meta) => {
    if (meta?.name === 'spawn_entity' && shown < 3) {
        shown += 1;
        console.log(t(), 'SPAWN_ENTITY', JSON.stringify(packet).slice(0, 300));
    }
    if (meta?.name === 'registry_data' && shown < 3 && !packet.id) {
        // entity types registry can explain what is being spawned
    }
    if (meta?.name === 'entity_metadata' && shown < 40) {
        const text = JSON.stringify(packet);
        if (/item|map|name|lore|held|slot/i.test(text)) {
            console.log(t(), 'ENTITY_METADATA', text.slice(0, 900));
            shown += 1;
        }
    }
});

bot.on('spawn', () => {
    console.log(t(), 'SPAWN игрока');
    setTimeout(() => {
        console.log('\n=== СУЩНОСТИ В МИРЕ ===');
        const list = Object.values(bot.entities || {}).slice(0, 40);
        for (const e of list) {
            let extra = '';
            try {
                const json = JSON.stringify(e.metadata || e.metadataRaw || {});
                extra = json.slice(0, 300);
            } catch { }
            console.log(`  id=${e.id} type=${e.type} name=${e.name || e.displayName || ''} pos=${e.position} meta=${extra}`);
        }
        process.exit(0);
    }, 8000);
});

setTimeout(() => process.exit(0), 30000);