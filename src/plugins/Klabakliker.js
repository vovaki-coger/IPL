export default class Klabakliker {
    constructor() {
        this.name = 'Klabakliker';
        this.description = 'Кликер по интервалу. Раз в N мс дёргает руку, ни на кого не наводя.';
        this.color = '6';
        this.settings = {
            clickIntervalMs: { type: 'number', label: 'Интервал (мс)', value: 100 },
            enabled: { type: 'boolean', label: 'Кликер включён', value: false }
        };
        this.lastClickTime = 0;
    }

    init(bot, api) {
        this.bot = bot;
        this.api = api;
        // init() is called as (bot, api) only. PluginManager fills
        // wrapper.config but never passes it on, so the saved values were
        // dropped and the plugin always ran on defaults. Reading them off the
        // wrapper here is the only place they survive.
        const saved = api?.pluginWrapper?.config || {};
        this.config = this._normalize({ clickIntervalMs: 100, ...saved });
        this.lastClickTime = 0;
    }

    _normalize(config) {
        return {
            // Same clamp the original mod used: 20ms-5000ms.
            clickIntervalMs: Math.max(20, Math.min(5000, Number(config.clickIntervalMs) || 100)),
            enabled: Boolean(config.enabled)
        };
    }

    onConfigUpdate(config) {
        this.config = this._normalize({ ...this.config, ...config });
    }

    onTick() {
        if (!this.config.enabled) return;
        if (!this.bot?.entity) return;
        // The mod skipped clicking while a screen was open; an open window is
        // the headless equivalent.
        if (this.bot.currentWindow) return;

        const now = Date.now();
        if (now - this.lastClickTime < this.config.clickIntervalMs) return;
        this.lastClickTime = now;

        // Pure interval clicker: no target lookup, no lookAt, no damage. The
        // hand swings into empty air every N ms.
        try {
            this.bot.swingArm('right');
        } catch (error) {
            this.api.log(`Klabakliker: ${error.message}`, 'warning');
        }
    }

    disable() {
        this.config.enabled = false;
        this.lastClickTime = 0;
    }
}