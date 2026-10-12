export default class AutoClicker {
    constructor() {
        this.name = 'Auto Clicker';
        this.description = 'Периодически выполняет выбранное действие бота с заданным интервалом.';
        this.color = 'e';
        this.settings = {
            intervalMs: { type: 'number', label: 'Интервал (мс)', value: 1000 },
            clickType: { type: 'string', label: 'Действие (left/right)', value: 'left' }
        };
        this.lastClickAt = 0;
    }

    init(bot, api) {
        this.bot = bot;
        this.api = api;
        this.config = {
            intervalMs: 1000,
            clickType: 'left',
            ...this.config
        };
    }

    onConfigUpdate(config) {
        this.config = {
            ...this.config,
            ...config,
            intervalMs: Math.max(100, Number(config.intervalMs) || 1000),
            clickType: config.clickType === 'right' ? 'right' : 'left'
        };
    }

    onTick() {
        if (!this.bot?.entity || !this.bot?._client?.connected) return;
        const now = Date.now();
        if (now - this.lastClickAt < this.config.intervalMs) return;
        this.lastClickAt = now;

        try {
            if (this.config.clickType === 'right') {
                this.bot.activateItem();
            } else {
                this.bot.swingArm('right');
            }
        } catch (error) {
            this.api.log(`Click failed: ${error.message}`, 'warning');
        }
    }

    disable() {
        this.lastClickAt = 0;
    }
}