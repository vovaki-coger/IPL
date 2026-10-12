// Drives the server lobby: takes the compass, opens the selector and joins a
// world. Slots are matched by item name rather than hardcoded indices,
// because the lobby reshuffles its layout between versions and pages.
// The lobby names its entries differently depending on the server that was
// picked: the survival server lists "гриф#9(1.16.5)", the newer one lists
// "bedrock #1(1.21.11)". A scenario pins the server plus whatever distinguishes
// the wanted world, so nobody has to type names by hand.
// Matching on a plain "гриф" substring picked "bedrock(1.21.11)", because that
// entry's description contains the word "гриферского". Servers are therefore
// matched from the start of their name.
const SCENARIOS = {
    'grif-1.21.11': {
        label: 'Гриф выживание 1.21.11',
        serverPrefix: 'гриф выживание',
        worldVersionMatch: '1.21.11'
    },
    'grif-1.16.5': {
        label: 'Гриф выживание 1.16.5',
        serverPrefix: 'гриф выживание',
        worldVersionMatch: '1.16.5'
    },
    'mega-grif-1.16.5': {
        label: 'Мега гриф 1.16.5',
        serverPrefix: 'мега гриф',
        worldVersionMatch: '1.16.5'
    },
    'bedrock-1.21.11': {
        label: 'Bedrock (мобильный) 1.21.11',
        serverPrefix: 'bedrock',
        worldVersionMatch: '1.21.11'
    },
    'grif-any': {
        label: 'Гриф выживание — любая версия',
        serverPrefix: 'гриф выживание',
        worldVersionMatch: ''
    }
};

// Fixed parts of the lobby flow that are the same on every scenario.
const FIXED = {
    allowedHosts: 'mc.reallyworld.me',
    serverMenuTitle: 'Выбор сервера',
    worldMenuTitle: 'Выбор мира',
    nextPageLabel: 'Следующая страница'
};

export default class AuthorizedWorldMenu {
    constructor() {
        this.name = 'Authorized World Menu';
        this.description = 'Берёт компас, открывает меню лобби и выбирает мир по названию.';
        this.color = 'b';
        this.settings = {
            scenario: {
                type: 'select',
                label: 'Сценарий входа',
                value: 'grif-1.21.11',
                options: Object.entries(SCENARIOS).map(([value, item]) => ({
                    value,
                    label: item.label
                }))
            },
            worldNumber: {
                type: 'number',
                label: 'Номер грифа (0 = любой)',
                value: 1
            },
            retryCooldownMs: {
                type: 'number',
                label: 'Пауза между попытками (мс)',
                value: 5000
            },
            delayMs: {
                type: 'number',
                label: 'Задержка между кликами (мс)',
                value: 1200
            },
            maxPages: {
                type: 'number',
                label: 'Максимум страниц перелистывания',
                value: 5
            }
        };
        this.timers = new Set();
        this.retryTimer = null;
        this.retryCount = 0;
        this.lastUseAt = 0;
        this.pagesScanned = 0;
        this.lastAttemptAt = 0;
        this.worldChosen = false;
    }

    findCompass() {
        const items = this.bot?.inventory?.items?.() || [];
        return items.find(item => item && item.name === 'compass');
    }

    init(bot, api) {
        this.bot = bot;
        this.api = api;
        this.config = {
            ...FIXED,
            ...this.scenario,
            scenario: 'grif-1.21.11',
            worldNumber: 1,
            maxPages: 5,
            retryCooldownMs: 5000,
            delayMs: 1200,
            ...this.config
        };
        // The wrapper's saved config lives on the wrapper, not on the plugin
        // instance, so it has to be pulled in explicitly or every setting falls
        // back to the defaults above.
        const saved = this.api?.botClient?.config?.plugins?.['Authorized World Menu']?.config;
        if (saved && typeof saved === 'object') {
            Object.assign(this.config, saved);
        }
        // Re-apply the scenario so stale strings from an older config cannot
        // survive a switch.
        Object.assign(this.config, this.scenario);

        this.api.on('windowOpen', window => this.handleWindow(window));
        this.api.on('windowClose', () => {
            this.clearTimers();
            // The menu can be reopened later, so reset the paging counter and
            // let the retry loop pick the compass up again.
            this.pagesScanned = 0;
            this.clearRetry();
            this.scheduleRetry();
        });
        this.api.on('playerSpawn', () => {
            // Velocity sends a spawn on every proxy transfer, so this also fires
            // when we are already standing on the grif. Re-running the menu then
            // sends us back to the hub, which looked exactly like a kick.
            // The grif NPC markers are proof we arrived, so trust them.
            if (this.grifMarkersSeen) {
                this.api.log('Спавн на грифе, повтор сценария не нужен.', 'info');
                this.worldChosen = true;
                if (this.transferWatchdog) {
                    clearTimeout(this.transferWatchdog);
                    this.transferWatchdog = null;
                }
                return;
            }
            // Same as onSpawn: a reconnect after a kick starts over in the lobby.
            this.worldChosen = false;
            this.pagesScanned = 0;
            if (this.transferWatchdog) {
                clearTimeout(this.transferWatchdog);
                this.transferWatchdog = null;
            }
            this.start({ immediate: true });
        });
        // The lobby sends no chunk data, so chat is the only signal about what
        // the server actually does with our clicks.
        // Bound straight on the bot: BotClient does not re-emit entitySpawn, so the
        // api listener never fired and the transfer was never detected.
        this.bot?.on('entitySpawn', (entity) => {
            const label = String(entity?.username || '').toLowerCase();
            if (!label) return;
            if (GRIF_MARKERS.some(marker => label.includes(marker))) {
                this.grifMarkersSeen = true;
            }
        });
        this.api.on('messagestr', message => {
            const text = String(message).replace(/\s+/g, ' ').trim();
            if (text) this.api.log(`Чат: ${text}`, 'info');
        });
        // The compass can arrive later than spawn (hub reward, pickup, trade), and
        // each arrival is a fresh reason to walk the lobby menu again.
        this.api.on('inventoryUpdate', () => this.start({ immediate: true }));

        // Events are not a guarantee: a compass can land in the hotbar through
        // a swap, a pickup or a plugin without a clean inventoryUpdate. This
        // watches the hotbar on a timer so the scenario starts the moment a
        // compass is there, not only on connect or spawn.
        this.watchTimer = setInterval(() => {
            if (this.worldChosen) return;
            if (this.bot?.currentWindow) return;
            if (!this.findCompass()) return;
            // Already standing on the grif with the compass still in the hotbar:
            // there is nothing left to run, and repeating the menu just spammed it.
            if (this.grifMarkersSeen || onTargetWorld(this.bot)) return;
            this.start({ immediate: true });
        }, 2000);
        this.watchTimer.unref?.();
    }

    onConfigUpdate(config) {
        this.config = {
            ...this.config,
            ...config,
            maxPages: Math.max(1, Number(config.maxPages) || 5),
            retryCooldownMs: Math.max(1000, Number(config.retryCooldownMs) || 5000),
            delayMs: Math.max(400, Number(config.delayMs) || 1200)
        };
        // Switching the scenario has to re-derive the search strings.
        Object.assign(this.config, this.scenario);
    }

    /** Resolve the chosen scenario into concrete search strings. */
    get scenario() {
        const key = String(this.config?.scenario || 'grif-1.21.11');
        return SCENARIOS[key] || SCENARIOS['grif-1.21.11'];
    }

    onSpawn() {
        // Same reason as the playerSpawn handler: a transfer also produces a
        // spawn, and resetting here would send a bot that already made it to
        // the grif straight back to the hub.
        if (this.grifMarkersSeen) {
            this.worldChosen = true;
            this.clearTimers();
            this.clearRetry();
            return;
        }
        // After a kick or a server reload the proxy drops the bot back into the
        // lobby. Resetting here makes the compass scenario run again instead of
        // staying finished from the previous session.
        this.worldChosen = false;
        this.pagesScanned = 0;
        this.clearTimers();
        this.clearRetry();
        this.retryCount = 0;
        this.lastUseAt = 0;
        this.grifMarkersSeen = false;
        if (this.transferWatchdog) {
            clearTimeout(this.transferWatchdog);
            this.transferWatchdog = null;
        }
        this.start({ immediate: true });
    }

    start(options = {}) {
        if (this.worldChosen) return;
        if (this.bot?.currentWindow) return;
        if (!this.isAllowedServer()) return;

        const compass = this.findCompass();
        if (!compass) {
            this.api.log(`Компас не найден. В инвентаре: ${this.itemNames().join(', ') || 'пусто'}.`, 'info');
            this.scheduleRetry();
            return;
        }

        // A compass showing up in the inventory is the trigger the user asked
        // for, so act right away instead of waiting out a backoff that had
        // grown while the bot was still holding nothing.
        if (options.immediate) {
            this.clearRetry();
            this.retryCount = 0;
        }

        // Keep retrying on a timer. Relying on inventoryUpdate alone stalled the
        // sequence: the bot spawned before the hub was ready, the first use was
        // swallowed, and no inventory change ever came to trigger another try.
        this.scheduleRetry();

        // onSpawn and inventoryUpdate can fire in the same tick; two use_item
        // packets made the hub open and immediately reopen the menu.
        if (this.attempting) return;
        // Using the compass updates the inventory, which fires inventoryUpdate
        // again. Without this floor the bot pressed it in a tight loop — 12
        // times in one second — which is exactly what a cheat detector looks for.
        const sinceLastUse = Date.now() - this.lastUseAt;
        if (sinceLastUse < 5000) return;

        this.attempting = true;
        this.lastUseAt = Date.now();
        const release = setTimeout(() => { this.attempting = false; }, 1500);
        release.unref?.();
        this.openCompassMenu();
    }

    scheduleRetry() {
        if (this.retryTimer) return;
        // Backing off matters: hammering use_item every few seconds forever is
        // exactly the packet pattern a cheat detector looks for.
        const step = Math.min(12, this.retryCount);
        this.retryCount += 1;
        const delay = Math.min(120_000, this.config.retryCooldownMs * Math.pow(1.6, step));
        this.api.log(`Планирую повтор через ${Math.round(delay / 1000)} с.`, 'info');
        const timer = setTimeout(() => {
            this.retryTimer = null;
            this.start();
        }, delay);
        timer.unref?.();
        this.retryTimer = timer;
    }

    clearRetry() {
        if (!this.retryTimer) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }

    itemNames() {
        return (this.bot?.inventory?.items?.() || []).map(item => item?.name).filter(Boolean);
    }

    async openCompassMenu() {
        if (!this.bot?.entity || !this.bot?.inventory || this.bot.currentWindow) return;
        const compass = this.findCompass();
        if (!compass) return;

        try {
            await this.bot.equip(compass, 'hand');
            // The hub ignores a click that arrives before the server has
            // acknowledged the item switch.
            await new Promise(resolve => setTimeout(resolve, 400));
            if (this.bot.currentWindow) return;
            this.bot.activateItem();
            this.api.log(`Компас в руке (${this.bot.heldItem?.name || 'нет'}), отправляю use_item.`, 'info');
        } catch (error) {
            this.api.log(`Не удалось открыть меню компасом: ${error.message}`, 'warning');
        }
    }

    handleWindow(window) {
        this.clearRetry();
        if (!window) return;
        // The same menu can be announced twice when two clicks land together.
        if (this.lastWindowId === window.id) return;
        this.lastWindowId = window.id;
        const title = normalizeTitle(window?.title);
        this.api.log(`Окно: "${title}" (raw: ${JSON.stringify(window?.title)}), слотов: ${window?.slots?.length ?? 0}.`, 'info');
        if (!window?.slots?.length || this.worldChosen) return;
        if (!title) return;

        // In manual mode the dashboard shows the real menu entries and the user
        // picks one, so no guessing about names or slot numbers is involved.
        if (matches(title, this.config.serverMenuTitle)) {
            this.schedule(() => this.pickServer(window), this.config.delayMs);
            return;
        }

        if (matches(title, this.config.worldMenuTitle)) {
            this.schedule(() => this.pickWorld(window), this.config.delayMs);
        }
    }

    pickServer(window) {
        if (!this.isOpen(window)) return;

        const wanted = String(this.config.serverPrefix || '').trim().toLowerCase();
        const version = String(this.config.worldVersionMatch || '').trim().toLowerCase();

        let slot = wanted ? findServerSlot(window, wanted, version) : -1;
        if (slot < 0 && version) slot = findServerSlot(window, wanted, '');

        this.api.log(`Пункты меню сервера: ${describe(window)}`, 'info');

        if (slot < 0) {
            this.api.log(`В меню сервера нет сервера '${wanted}'. Список: ${describe(window)}`, 'warning');
            return;
        }
        this.clickSlot(window, slot, `сервер '${slotLabel(window.slots[slot]) || wanted}'`);
    }

    pickWorld(window) {
        if (!this.isOpen(window)) return;

        const version = String(this.config.worldVersionMatch || '').trim().toLowerCase();
        const number = Math.max(0, parseInt(this.config.worldNumber, 10) || 0);
        // Lobby entries read "гриф#9(1.16.5)" on one server and "bedrock #1(1.21.11)"
        // on another, so matching is done on the number and version rather than
        // on a whole name string.
        const slot = findWorldSlot(window, number, version);

        if (slot >= 0) {
            const label = number
                ? `мир #${number}${version ? ' ' + version : ''}`
                : `мир (любой)${version ? ' ' + version : ''}`;
            this.clickSlot(window, slot, label, 0, false);
            // Remembered so the loop does not restart after the teleport.
            this.worldChosen = true;
            // If the proxy never moved us to another world, playerSpawn never
            // fires to clear this. Retrying once after a minute is the difference
            // between a bot that gives up and one that recovers on its own.
            this.transferWatchdog = setTimeout(() => {
                this.transferWatchdog = null;
                if (!this.worldChosen) return;
                // The world markers are already on screen: the transfer worked
                // and the wait was pointless. Re-running here is what made the
                // bot look slow and doubled up on the menu.
                if (this.grifMarkersSeen || onTargetWorld(this.bot)) {
                    this.api.log('Бот уже на целевом мире, повтор не нужен.', 'info');
                    return;
                }
                this.api.log('Перехода на мир не произошло, повторяю сценарий.', 'warning');
                this.worldChosen = false;
                this.lastUseAt = 0;
                this.retryCount = 0;
                this.pagesScanned = 0;
                this.start({ immediate: true });
            }, 90_000);
            this.transferWatchdog.unref?.();
            // A plain left click was ignored by the lobby, so try the other
            // click variants a vanilla client can send.
            this.schedule(() => {
                if (!this.bot?.currentWindow) return;
                this.clickSlot(window, slot, `${label} (ПКМ)`, 1, false);
            }, 4000);
            this.schedule(() => {
                if (!this.bot?.currentWindow) return;
                this.clickSlot(window, slot, `${label} (Shift)`, 0, true);
            }, 8000);
            return;
        }

        const nextLabel = String(this.config.nextPageLabel || '').trim().toLowerCase();
        const nextSlot = nextLabel ? findSlot(window, nextLabel) : -1;
        this.pagesScanned += 1;

        if (nextSlot >= 0 && this.pagesScanned < this.config.maxPages) {
            this.api.log(`Мир на этой странице не найден, листаю дальше (стр. ${this.pagesScanned}).`, 'info');
            this.clickSlot(window, nextSlot, `страница ${this.pagesScanned + 1}`);
            this.schedule(() => this.start(), this.config.delayMs * 2);
            return;
        }

        this.api.log(`Гриф #${number} не найден за ${this.pagesScanned} страниц(ах). Список: ${describe(window)}`, 'warning');
    }

    clickSlot(window, slot, stepName, button = 0, shift = false) {
        if (!this.isOpen(window)) return;
        try {
            this.bot.clickWindow(slot, button, shift ? 1 : 0);
            this.api.log(`Клик: ${stepName}, слот ${slot}${button ? ', ПКМ' : ''}${shift ? ', Shift' : ''}.`, 'info');
        } catch (error) {
            this.api.log(`Клик '${stepName}' не удался: ${error.message}`, 'warning');
        }
    }

    isOpen(window) {
        if (!this.bot?.currentWindow || this.bot.currentWindow !== window) {
            this.api.log('Шаг пропущен: меню уже закрылось.', 'warning');
            return false;
        }
        return true;
    }

    isAllowedServer() {
        // bot.host is never assigned by mineflayer, so the configured host is
        // the only reliable source. Reading bot.host made the allowlist fail
        // and the whole plugin never ran.
        const host = String(
            this.api?.botClient?.config?.host || this.bot?.host || ''
        ).toLowerCase();
        const allowlist = String(this.config.allowedHosts || '')
            .split(/[,\n]/)
            .map(value => value.trim().toLowerCase())
            .filter(Boolean);
        return Boolean(host && allowlist.includes(host));
    }

    schedule(callback, delay) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            callback();
        }, delay);
        this.timers.add(timer);
    }

    clearTimers() {
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
    }

    disable() {
        this.clearTimers();
        this.clearRetry();
        if (this.watchTimer) {
            clearInterval(this.watchTimer);
            this.watchTimer = null;
        }
        if (this.transferWatchdog) {
            clearTimeout(this.transferWatchdog);
            this.transferWatchdog = null;
        }
        this.pagesScanned = 0;
        this.worldChosen = false;
    }
}

function normalizeTitle(title) {
    if (title === null || title === undefined) return '';
    if (typeof title === 'string') return stripColor(title).trim();
    if (typeof title === 'number' || typeof title === 'boolean') return String(title);
    if (Array.isArray(title)) return title.map(normalizeTitle).join('').trim();
    if (typeof title !== 'object') return '';

    // prismarine-nbt wraps everything as { type, value }. The lobby sent its
    // menu title that way, so the old plain { text, extra } walk produced an
    // empty string and the GUI sequence silently matched nothing.
    const type = title.type;
    if (type === 'compound' || type === 'list') return normalizeTitle(title.value);
    if (type) return title.value === undefined ? '' : String(title.value);
    if (title.text !== undefined) {
        const own = normalizeTitle(title.text);
        const extra = title.extra ? normalizeTitle(title.extra) : '';
        return `${own}${extra}`.trim();
    }
    if (title.value !== undefined) return normalizeTitle(title.value);
    return Object.keys(title).map(key => normalizeTitle(title[key])).join('').trim();
}

function stripColor(text) {
    return String(text).replace(/§[0-9a-fk-or]/gi, '');
}

/** Display text of a slot item: custom name first, then the item id. */
function slotLabel(item) {
    if (!item) return '';
    const parts = [];
    for (const value of [item.customName, item.displayName]) {
        const text = normalizeTitle(value);
        if (text) { parts.push(text); break; }
    }
    for (const value of [item.customLore, item.displayLore]) {
        if (Array.isArray(value)) {
            const lore = value.map(normalizeTitle).filter(Boolean).join(' ');
            if (lore) { parts.push(lore); break; }
        }
    }
    if (!parts.length && item.name) parts.push(item.name);
    return stripColor(parts.join(' ')).trim().toLowerCase();
}

/**
 * Finds a server entry by the start of its name plus optional version.
 * A plain substring match is not usable here: "гриф" appears inside
 * "гриферского" in the bedrock entry's description.
 */
function findServerSlot(window, prefix, version = '') {
    for (let index = 0; index < window.slots.length; index += 1) {
        const label = slotLabel(window.slots[index]);
        if (!label) continue;
        if (!label.startsWith(prefix)) continue;
        if (version && !label.includes(version)) continue;
        return index;
    }
    return -1;
}

/**
 * Finds a lobby world entry by its number and version.
 * Labels look like "гриф#9(1.16.5) онлайн:94/150" or "bedrock #1(1.21.11)".
 * The trailing bracket matters: matching "#1" naively also hits "гриф#10".
 */
// NPC that only exist on the grif world. A proxy transfer does not re-spawn the
// player, so playerSpawn never fires and the watchdog had no way to tell
// "arrived" from "click did nothing".
const GRIF_MARKERS = ['рынок', 'аукцион', 'шахтер'];

function onTargetWorld(bot) {
    for (const entity of Object.values(bot?.entities || {})) {
        const label = String(entity.username || '').toLowerCase();
        if (GRIF_MARKERS.some(marker => label.includes(marker))) return true;
    }
    return false;
}


function findWorldSlot(window, number, version = '') {
    for (let index = 0; index < window.slots.length; index += 1) {
        const label = slotLabel(window.slots[index]);
        if (!label) continue;
        // Drop spaces so "bedrock #1" and "гриф#1" both match "#1".
        const flat = label.replace(/\s+/g, '');
        if (version && !flat.includes(version)) continue;
        if (!number) {
            // Any world at all: still has to look like one.
            if (/#\d*\(/.test(flat)) return index;
            continue;
        }
        if (flat.includes(`#${number}(`)) return index;
    }
    return -1;
}

function findSlot(window, needle, secondNeedle = '') {
    const target = String(needle || '').trim().toLowerCase();
    if (!target) return -1;
    const extra = String(secondNeedle || '').trim().toLowerCase();
    for (let index = 0; index < window.slots.length; index += 1) {
        const label = slotLabel(window.slots[index]);
        if (!label || !label.includes(target)) continue;
        if (extra && !label.includes(extra)) continue;
        return index;
    }
    return -1;
}

function describe(window) {
    return window.slots
        .map((item, index) => (slotLabel(item) ? `${index}=${slotLabel(item)}` : null))
        .filter(Boolean)
        .slice(0, 30)
        .join(' | ') || 'пусто';
}

function matches(title, expected) {
    const target = String(expected || '').trim().toLowerCase();
    return target.length > 0 && String(title || '').toLowerCase().includes(target);
}