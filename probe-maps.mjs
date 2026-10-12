import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
    username: process.argv[2] || 'DiagBot7',
    host: 'gg.bomjpvp.top',
    port: 25565,
    version: '26.1',
    auth: 'offline'
});

let n = 0;
bot._client.on('packet', (packet, meta) => {
    if (meta?.name !== 'map') return;
    n += 1;
    const data = packet.data;
    const bytes = data ? (Buffer.isBuffer(data) ? data.length : String(data).length) : 0;
    const keys = Object.keys(packet).join(',');
    console.log(
        `#${String(n).padStart(2)} id=${packet.itemDamage} cols=${packet.columns} rows=${packet.rows} ` +
        `x=${packet.x} y=${packet.y} bytes=${bytes} scale=${packet.scale} dim=${packet.dimension} ` +
        `locked=${packet.locked} | ${keys}`
    );
});

setTimeout(() => { bot.quit(); process.exit(0); }, 15000);