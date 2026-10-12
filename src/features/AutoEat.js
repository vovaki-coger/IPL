import { BaseFeature } from './BaseFeature.js';
// mineflayer-auto-eat@5 is a pure ESM package ("type": "module"). require()
// throws ERR_REQUIRE_ESM on Node < 20.19 and killed the whole process at
// startup, because this import is reached through FeatureManager.
import { loader as autoEatLoader } from 'mineflayer-auto-eat';

export class AutoEat extends BaseFeature {
    init() {
        this.enabled = this.botClient.config.autoEat || false;
        const bot = this.botClient.bot;

        const load = () => {
            try {
                if (!bot.autoEat) {
                    bot.loadPlugin(autoEatLoader);
                }

                if (bot.autoEat) {
                    // Options live in `opts` and are merged via setOpts().
                    // There is no `startAt` in this version - the thresholds
                    // are minHunger / minHealth.
                    bot.autoEat.setOpts({
                        priority: 'foodPoints',
                        minHunger: 14,
                        minHealth: 14,
                        bannedFood: []
                    });
                    // Restore enabled state from config
                    if (this.enabled) {
                        bot.autoEat.enableAuto();
                    }
                }
            } catch (err) {
                this.botClient.log(`AutoEat plugin failed to load: ${err.message}`, 'error');
            }
        };

        if (bot.entity) load();
        else bot.once('spawn', load);
    }

    toggle(enabled) {
        this.enabled = enabled;
        const bot = this.botClient.bot;
        if (bot && bot.autoEat) {
            if (enabled) {
                bot.autoEat.enableAuto();
                this.botClient.log('AutoEat enabled.', 'success');
            } else {
                bot.autoEat.disableAuto();
                this.botClient.log('AutoEat disabled.', 'info');
            }
        }
    }

    enable() {
        this.toggle(true);
    }

    disable() {
        this.toggle(false);
    }
}
