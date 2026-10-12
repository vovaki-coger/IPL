import mc from 'minecraft-protocol';

const host = process.argv[2] || 'gg.bomjpvp.top';
const port = parseInt(process.argv[3] || '25565', 10);

const done = (code) => process.exit(code);
setTimeout(() => { console.log('TIMEOUT'); done(1); }, 15000);

try {
    const data = await new Promise((resolve, reject) => {
        mc.ping({ host, port, closeTimeout: 10000 }, (err, res) => err ? reject(err) : resolve(res));
    });
    console.log(JSON.stringify({
        host,
        port,
        version: data.version,
        players: data.players,
        description: data.description
    }, null, 2));
    done(0);
} catch (e) {
    console.log('PING FAILED:', e.message);
    done(1);
}