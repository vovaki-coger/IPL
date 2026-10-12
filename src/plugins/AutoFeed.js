export default class AutoFeed {
    constructor() {
        this.name = 'Auto Feed';
        this.description = 'Поддерживает сытость через /feed или еду из левой руки.';
        this.color = 'a';
        this.settings = {
            mode: { type: 'string', label: 'Режим (command/eat)', value: 'eat' },
            threshold: { type: 'number', label: 'Порог сытости', value: 14 },
            cooldownMs: { type: 'number', label: 'Перерыв (мс)', value: 8000 }
        };
        this.lastFeedAt = 0;
        this.feeding = false;
    }

    init(bot, api) {
        this.bot = bot;
        this.api = api;
        this.config = {
            mode: 'eat',
            threshold: 14,
            cooldownMs: 8000,
            ...this.config
        };
    }

    onConfigUpdate(config) {
        this.config = {
            ...this.config,
            ...config,
            threshold: Math.max(1, Math.min(20, Number(config.threshold) || 14)),
            cooldownMs: Math.max(3000, Number(config.cooldownMs) || 8000),
            mode: config.mode === 'command' ? 'command' : 'eat'
        };
    }

    async onTick() {
        if (this.feeding || !this.bot?.entity || !this.bot?._client?.connected) return;
        if (Number(this.bot.food) >= this.config.threshold) return;
        if (Date.now() - this.lastFeedAt < this.config.cooldownMs) return;

        this.lastFeedAt = Date.now();
        this.feeding = true;
        try {
            if (this.config.mode === 'command') {
                this.bot.chat('/feed');
                this.api.log('Sent /feed because food level is low.', 'info');
                return;
            }

            const item = this.findFood();
            if (!item) {
                this.api.log('No food item found in inventory.', 'warning');
                return;
            }

            await this.bot.equip(item, 'off-hand');
            this.bot.activateItem();
            this.api.log(`Eating ${item.displayName || item.name} from the left hand.`, 'info');
        } catch (error) {
            this.api.log(`Auto Feed failed: ${error.message}`, 'warning');
        } finally {
            setTimeout(() => {
                this.feeding = false;
            }, 1200);
        }
    }

    findFood() {
        const foodNames = new Set([
            'apple', 'golden_apple', 'enchanted_golden_apple', 'bread',
            'porkchop', 'cooked_porkchop', 'beef', 'cooked_beef',
            'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton',
            'rabbit', 'cooked_rabbit', 'cod', 'cooked_cod',
            'salmon', 'cooked_salmon', 'potato', 'baked_potato',
            'carrot', 'golden_carrot', 'beetroot', 'melon_slice',
            'sweet_berries', 'glow_berries', 'dried_kelp', 'rotten_flesh'
        ]);
        return this.bot.inventory?.items()?.find(item => foodNames.has(item.name)) || null;
    }

    disable() {
        this.feeding = false;
        this.lastFeedAt = 0;
    }
}