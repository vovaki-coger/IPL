// Renders what the bot can see into a PNG on demand.
//
// A headless bot has no framebuffer, so there is nothing to screenshot. This
// walks the block data the bot already has and draws a top-down map of the
// columns around it: the topmost solid block per column, coloured by type.
// It works on any protocol version, including ones the 3D viewer cannot load.
import { createCanvas } from 'canvas';

// Block name -> colour. Only the blocks you actually meet in a hub matter;
// everything else falls back to a stable hash below.
const NAMED_COLORS = {
    air: null,
    grass_block: 0x5d9c4a, grass: 0x5d9c4a, short_grass: 0x5d9c4a, tall_grass: 0x5d9c4a, fern: 0x5d9c4a,
    dirt: 0x79553a, coarse_dirt: 0x79553a, rooted_dirt: 0x79553a, podzol: 0x6b4c2e, mud: 0x4a3728,
    stone: 0x7d7d7d, deepslate: 0x4a4a4a, cobblestone: 0x808080, cobbled_deepslate: 0x555555,
    andesite: 0x8f8f8f, diorite: 0xb0b0b0, granite: 0x9a6b5b, tuff: 0x6d6a63,
    sand: 0xdbd3a0, sandstone: 0xdbd3a0, red_sand: 0xbe6a2a,
    gravel: 0x8c8c8c, clay: 0xa0a7b4, snow: 0xf0f5f5, ice: 0x8ab4f8,
    oak_log: 0x6b4f2a, birch_log: 0xd7cb8d, spruce_log: 0x4a3b22, jungle_log: 0x5a4526,
    acacia_log: 0x6b5230, dark_oak_log: 0x3f2f1c, cherry_log: 0xd7a9a0, mangrove_log: 0x5b3b29,
    oak_leaves: 0x3d7a2e, birch_leaves: 0x86b85e, spruce_leaves: 0x2e5a35, jungle_leaves: 0x347a2c,
    cherry_leaves: 0xe0a8b8, acacia_leaves: 0x4f7a3a, mangrove_leaves: 0x3c6b45,
    oak_planks: 0xa2825a, birch_planks: 0xc8b47a, spruce_planks: 0x7a5c3a, dark_oak_planks: 0x5a4128,
    water: 0x2b5fd4, lava: 0xd46a1e,
    glass: 0xbfe4ee, white_stained_glass: 0xe8f2f7, black_concrete: 0x1a1a20,
    obsidian: 0x14101f, bedrock: 0x565656,
    gold_block: 0xf9e04f, iron_block: 0xd8d8d8, diamond_block: 0x62e8e0, emerald_block: 0x2fd35a,
    netherrack: 0x6d2c2c, nether_bricks: 0x3a1c1c, end_stone: 0xdcd88c, end_stone_bricks: 0xd6d59a,
    glowstone: 0xf5d97a, sea_lantern: 0xc8dcc4,
    quartz_block: 0xece9e2, sandstone_bricks: 0xdbd3a0, stone_bricks: 0x7a7a7a,
    mossy_cobblestone: 0x6f7a5c, cracked_stone_bricks: 0x767676, chiseled_stone_bricks: 0x7d7d7d,
    prismarine: 0x5f8a76, dark_prismarine: 0x3e5f52,
    lantern: 0xd8a24a, torch: 0xd8a24a,
    bookshelf: 0x7a5c3a, crafting_table: 0x8a6a3a, furnace: 0x6a6a6a,
    spawner: 0x2c3340, beacon: 0x74e8d0,
    terracotta: 0x9a5c42, white_concrete: 0xd9dbdc, gray_concrete: 0x555a5f, lime_concrete: 0x61b250
};

// Blocks that are see-through should not count as "the top of the column".
const TRANSPARENT = /^(air|cave_air|void_air|water|lava|glass|_stained_glass|short_grass|tall_grass|fern|oak_leaves|birch_leaves|spruce_leaves|jungle_leaves|cherry_leaves|acacia_leaves|mangrove_leaves|torch|lantern|snow)$/;

function hashColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    // Keep it mid-bright and slightly desaturated so the map stays readable.
    const base = 90 + (hash % 110);
    const jitter = ((hash >> 8) % 40);
    return ((base + jitter) << 16) | ((base + (jitter >> 1)) << 8) | (base - jitter);
}

function colorFor(block) {
    if (!block || !block.name) return 0x101014;
    if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, block.name)) return NAMED_COLORS[block.name];
    return hashColor(block.name);
}

function isSolid(block) {
    return Boolean(block) && block.boundingBox !== 'empty' && !TRANSPARENT.test(block.name);
}

/**
 * @param {object} bot   live mineflayer bot
 * @param {object} [opts] { radius, scale, height, depth }
 * @returns {{ buffer: Buffer, meta: object }}
 */
export function renderTopDown(bot, opts = {}) {
    const radius = Math.max(4, Math.min(96, Number(opts.radius) || 40));
    const scale = Math.max(2, Math.min(12, Number(opts.scale) || 6));
    const span = radius * 2 + 1;
    const top = Math.floor(bot.entity.position.y) + (Number(opts.height) || 40);
    const bottom = Math.floor(bot.entity.position.y) - (Number(opts.depth) || 32);

    const baseX = Math.floor(bot.entity.position.x);
    const baseZ = Math.floor(bot.entity.position.z);

    const canvas = createCanvas(span * scale, span * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    let unloaded = 0;
    let highest = null;

    for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
            const px = baseX + dx;
            const pz = baseZ + dz;
            let found = null;

            for (let y = top; y >= bottom; y -= 1) {
                const block = bot.blockAt(px, y, pz);
                if (block === null || block === undefined) { unloaded += 1; break; }
                if (isSolid(block)) { found = block; break; }
            }
            if (!found) continue;
            if (highest === null || found.boundingBox === 'block') highest = found.name;

            const rgb = colorFor(found);
            ctx.fillStyle = `#${rgb.toString(16).padStart(6, '0')}`;
            // Canvas Y grows downward, world Z grows south. Flip so north is up.
            ctx.fillRect((dx + radius) * scale, (radius - dz) * scale, scale, scale);
        }
    }

    // Grid every 8 blocks gives the eye something to measure distance against.
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= span; i += 8) {
        const p = i * scale + 0.5;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, span * scale); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(span * scale, p); ctx.stroke();
    }

    // The bot itself.
    const cx = radius * scale + scale / 2;
    const cy = radius * scale + scale / 2;
    const yaw = bot.entity.yaw || 0;
    // Facing vector matches the canvas flip above.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);

    ctx.strokeStyle = '#ffd54a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + fx * scale * 3, cy + fz * scale * 3);
    ctx.stroke();

    ctx.fillStyle = '#ffd54a';
    ctx.beginPath();
    ctx.arc(cx, cy, scale * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, span * scale, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = '13px sans-serif';
    ctx.fillText(
        `x ${baseX}  y ${Math.floor(bot.entity.position.y)}  z ${baseZ}   ${span}x${span}   unloaded: ${unloaded}`,
        6, 15
    );

    return {
        buffer: canvas.toBuffer('image/png'),
        meta: { radius, scale, x: baseX, y: Math.floor(bot.entity.position.y), z: baseZ, unloaded, highest }
    };
}