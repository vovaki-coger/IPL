const MAX_WINDOW_SLOTS = 90;
const MAP_SIZE = 128;
const MAX_CACHED_MAPS = 16;

function textFromComponent(value, depth = 0) {
    if (depth > 5 || value == null) return '';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 5000) {
            try {
                return textFromComponent(JSON.parse(trimmed), depth + 1);
            } catch {
                return value.slice(0, 320);
            }
        }
        return value.slice(0, 320);
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        return value.map(part => textFromComponent(part, depth + 1)).filter(Boolean).join('');
    }
    if (typeof value !== 'object' || Buffer.isBuffer(value)) return '';

    const current = typeof value.text === 'string'
        ? value.text
        : (typeof value.fallback === 'string' ? value.fallback : '');
    const extras = textFromComponent(value.extra, depth + 1);
    return `${current}${extras}`.slice(0, 320);
}

function findMapId(value, depth = 0, mapContext = false) {
    if (depth > 7 || value == null || Buffer.isBuffer(value)) return null;
    if (typeof value === 'number' || typeof value === 'string') {
        if (!mapContext) return null;
        const id = Number(value);
        return Number.isInteger(id) && id >= 0 ? id : null;
    }
    if (Array.isArray(value)) {
        for (const entry of value.slice(0, 32)) {
            const found = findMapId(entry, depth + 1, mapContext);
            if (found !== null) return found;
        }
        return null;
    }
    if (value instanceof Map) {
        for (const [key, entry] of value.entries()) {
            const keyIsMap = /(^|[:_])map(?:_?id)?$/i.test(String(key));
            const found = findMapId(entry, depth + 1, mapContext || keyIsMap);
            if (found !== null) return found;
        }
        return null;
    }
    if (typeof value !== 'object') return null;

    for (const [key, entry] of Object.entries(value).slice(0, 64)) {
        const keyIsMap = /(^|[:_])map(?:_?id)?$/i.test(key);
        const found = findMapId(entry, depth + 1, mapContext || keyIsMap);
        if (found !== null) return found;
    }
    return null;
}

function findLore(value, depth = 0) {
    if (depth > 7 || value == null || Buffer.isBuffer(value)) return [];
    if (Array.isArray(value)) {
        return value.slice(0, 10).map(textFromComponent).filter(Boolean);
    }
    if (typeof value !== 'object') return [];

    for (const [key, entry] of Object.entries(value).slice(0, 64)) {
        if (/^lore$/i.test(key) || /:lore$/i.test(key)) {
            const found = findLore(entry, depth + 1);
            if (found.length) return found;
        }
        const found = findLore(entry, depth + 1);
        if (found.length) return found;
    }
    return [];
}

export function serializeManualWindow(window) {
    if (!window || !Array.isArray(window.slots)) return null;
    const slots = window.slots.slice(0, MAX_WINDOW_SLOTS).map((item, slot) => {
        if (!item) return null;
        const name = String(item.name || 'unknown_item').slice(0, 100);
        let mapId = findMapId(item.components ?? item.nbt ?? item);
        if (mapId === null && /(^|:)filled_map$/.test(name)) {
            const metadata = Number(item.metadata);
            if (Number.isInteger(metadata) && metadata >= 0) mapId = metadata;
        }
        return {
            slot,
            name,
            label: textFromComponent(item.displayName) || name,
            count: Math.max(1, Math.min(99, Number(item.count) || 1)),
            mapId,
            lore: findLore(item.components ?? item.nbt ?? {}).slice(0, 8)
        };
    });

    return {
        id: Number.isInteger(Number(window.id)) ? Number(window.id) : null,
        title: textFromComponent(window.title) || String(window.type || 'Server window').slice(0, 160),
        type: String(window.type || 'unknown').slice(0, 100),
        slots
    };
}

export function mergeManualMapPacket(mapCache, packet) {
    const mapId = Number(packet?.itemDamage ?? packet?.mapId ?? packet?.map_id);
    const columns = Number(packet?.columns);
    const rows = Number(packet?.rows);
    const x = Number(packet?.x) || 0;
    const y = Number(packet?.y) || 0;
    if (!Number.isInteger(mapId) || mapId < 0 ||
        !Number.isInteger(columns) || !Number.isInteger(rows) ||
        columns < 1 || rows < 1 || x < 0 || y < 0 ||
        x + columns > MAP_SIZE || y + rows > MAP_SIZE) {
        return null;
    }

    let data;
    try {
        data = Buffer.isBuffer(packet.data) ? packet.data : Buffer.from(packet.data || []);
    } catch {
        return null;
    }
    if (data.length < columns * rows) return null;

    const pixels = mapCache.get(mapId) || Buffer.alloc(MAP_SIZE * MAP_SIZE);
    for (let row = 0; row < rows; row += 1) {
        const sourceStart = row * columns;
        const targetStart = (y + row) * MAP_SIZE + x;
        data.copy(pixels, targetStart, sourceStart, sourceStart + columns);
    }
    mapCache.delete(mapId);
    mapCache.set(mapId, pixels);
    while (mapCache.size > MAX_CACHED_MAPS) {
        mapCache.delete(mapCache.keys().next().value);
    }

    return { mapId, pixels: pixels.toString('base64') };
}
