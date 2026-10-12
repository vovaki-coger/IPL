import axios from 'axios';
import { ConfigLoader } from '../config/ConfigLoader.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Server chat can contain any URL, including ones aimed at the machine running
// these bots. Refuse to fetch anything that resolves inside a private network.
function isPrivateHostname(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
        host.endsWith('.internal') || host === 'metadata.google.internal') {
        return true;
    }
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const [a, b] = ipv4.slice(1).map(Number);
        if ([a, b].some(Number.isNaN)) return true;
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;
    }
    return false;
}

export default class AntiAntiBot {
    constructor() {
        this.name = 'Anti-AntiBot';
        this.description = 'Bypasses XCord, BotSentry, BungeeCord BotFilter, and custom captchas.';
        this.color = 'b';

        this.settings = {
            bypassXCord: { type: 'boolean', label: 'Bypass XCord Checks', value: true },
            bypassBotSentry: { type: 'boolean', label: 'Bypass BotSentry Checks', value: true },
            bypassBotFilter: { type: 'boolean', label: 'Bypass BungeeCord BotFilter', value: true },
            randomizeIdentity: { type: 'boolean', label: 'Randomize Client Identity', value: false },
            // Rotating the view on a fixed 3-7s timer is a classic bot tell: no human
            // produces constant angular deltas at a constant interval, and the
            // server dropped the bot for suspected cheating while it was on.
            jitterMode: { type: 'boolean', label: 'Passive Human Jitter', value: false },
            useBridge: { type: 'boolean', label: 'Use CAPTCHA Bridge', value: true },
            solveMath: { type: 'boolean', label: 'Solve Math Captchas', value: true },
            solveInventory: { type: 'boolean', label: 'Solve Inventory Captchas', value: true },
            autoVisitLinks: { type: 'boolean', label: 'Auto-Open Verification Links', value: true },
            linkTimeoutMs: { type: 'number', label: 'Link Open Timeout (ms)', value: 12000 },
            simulateGravity: { type: 'boolean', label: 'Simulate Gravity (Fake Lobby)', value: false },
            emulateVanillaPackets: { type: 'boolean', label: 'Emulate Vanilla Client Packets', value: true },
            smartBackoffMinutes: { type: 'number', label: 'Denial Backoff (Minutes)', value: 5 }
        };

        this.jitterTimer = null;
        this.jitterTimeout = null;
        this.gravityTimer = null;
        this.tickTimer = null;

        this.spawnTime = 0;
        this.hasLanded = false;
        this.pendingGravity = false;
        this.lastGroundY = null;
        this.consecutiveKicks = 0;
        this.lastKickTime = 0;

        this.enabled = false;
        this.botHandlers = null;
        this.visitedLinks = new Map();
        this.currentMapCode = null;

        this.botFilterState = {
            active: false,
            spawnY: 450,
            spawnX: 7,
            spawnZ: 7,
            velocity: 0,
            currentY: 450,
            packetsSent: 0,
            startTime: 0
        };
    }

    init(bot, api) {
        this.bot = bot;
        this.api = api;
        this.botClient = api?.botClient || null;
    }

    enable() {
        this.enabled = true;

        // 'windowOpen' and 'spawn' are re-emitted by BotClient, so api.on works.
        this.api.on('windowOpen', (window) => this.handleWindow(window));
        this.api.on('spawn', () => this.handleSpawn());

        // BotClient does NOT re-emit 'messagestr' or 'kicked'. Subscribing to
        // them through api.on registered dead listeners and every captcha branch
        // below silently never ran. Bind straight to the mineflayer bot instead.
        this.bindBotListeners();

        if (this.settings.jitterMode.value) {
            this.startJitter();
        }

        if (this.settings.bypassBotFilter.value) {
            this._hookBotFilterPackets();
        }
    }

    disable() {
        this.enabled = false;
        this.unbindBotListeners();
        this._clearAllTimers();
    }

    bindBotListeners() {
        this.unbindBotListeners();
        const bot = this.api.bot;
        if (!bot || typeof bot.on !== 'function') return;

        this.botHandlers = {
            message: (jsonMsg, position) => {
                if (!this.enabled) return;
                if (position === 'game_info') return;
                // toString() keeps the section codes, which the colour captcha needs.
                let text;
                try {
                    text = jsonMsg.toString();
                } catch (e) {
                    return;
                }
                if (!text || !text.trim()) return;
                // Player chat must never trigger auto-answers or commands.
                this.handleChat(text, !jsonMsg.username);
            },
            kicked: (reason) => {
                if (!this.enabled) return;
                this.handleKicked(reason);
            }
        };

        bot.on('message', this.botHandlers.message);
        bot.on('kicked', this.botHandlers.kicked);
    }

    unbindBotListeners() {
        const bot = this.api?.bot;
        if (bot && this.botHandlers && typeof bot.removeListener === 'function') {
            bot.removeListener('message', this.botHandlers.message);
            bot.removeListener('kicked', this.botHandlers.kicked);
        }
        this.botHandlers = null;
    }

    _clearAllTimers() {
        if (this.jitterTimeout) { clearTimeout(this.jitterTimeout); this.jitterTimeout = null; }
        if (this.jitterTimer) { clearInterval(this.jitterTimer); this.jitterTimer = null; }
        if (this.gravityTimer) { clearInterval(this.gravityTimer); this.gravityTimer = null; }
        if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    }

    onConfigUpdate(newConfig) {
        for (const [key, val] of Object.entries(newConfig)) {
            if (this.settings[key]) {
                this.settings[key].value = val;
            }
        }

        if (this.settings.jitterMode.value) {
            this.startJitter();
        } else {
            if (this.jitterTimeout) { clearTimeout(this.jitterTimeout); this.jitterTimeout = null; }
            if (this.jitterTimer) { clearInterval(this.jitterTimer); this.jitterTimer = null; }
        }
    }

    startJitter() {
        if (this.jitterTimer || this.jitterTimeout) return;
        this.jitterTimeout = setTimeout(() => {
            this.jitterTimeout = null;
            if (!this.settings.jitterMode.value) return;
            this.jitterTimer = setInterval(() => {
                if (!this._isBotAlive()) return;
                const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * 0.03;
                let pitch = this.bot.entity.pitch + (Math.random() - 0.5) * 0.02;
                pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
                try { this.bot.look(yaw, pitch, true).catch(() => {}); } catch (e) {}
            }, 3000 + Math.random() * 4000);
        }, 8000 + Math.random() * 4000);
    }

    _hookBotFilterPackets() {
        if (!this.bot?._client) return;
        const client = this.bot._client;

        client.on('position', (data) => {
            if (!this.settings.bypassBotFilter.value) return;

            const teleportId = data.teleportId;
            if (teleportId === undefined || teleportId === null) return;

            const isBotFilter = (teleportId === 9876) ||
                (data.y >= 400 && Math.abs(data.x) < 50 && Math.abs(data.z) < 50);

            if (!isBotFilter) return;

            this.botFilterState.active = true;
            this.botFilterState.spawnX = data.x;
            this.botFilterState.spawnY = data.y;
            this.botFilterState.spawnZ = data.z;
            this.botFilterState.velocity = 0;
            this.botFilterState.currentY = data.y;
            this.botFilterState.packetsSent = 0;
            this.botFilterState.startTime = Date.now();

            this.log(`BotFilter detected (id=${teleportId}, y=${data.y}). Starting bypass...`, 'info');

            setTimeout(() => {
                try {
                    client.write('teleport_confirm', { teleportId: teleportId });
                } catch (e) {}
                this._startBotFilterFall();
            }, 50 + Math.random() * 80);
        });

        this.bot.on('move', () => {
            // The fake lobby must never start on its own: it replaces real
            // physics with packets that look nothing like a genuine fall, and
            // servers that hold players above y=150 would trigger it always.
            if (!this.settings.simulateGravity.value) return;
            if (this.botFilterState.active || !this.settings.bypassBotFilter.value) return;
            if (this.bot.entity.position.y > 150 && !this.pendingGravity && !this.hasLanded) {
                this._handleFakeLobby();
            }
        });
    }

    _startBotFilterFall() {
        if (this.gravityTimer) { clearInterval(this.gravityTimer); this.gravityTimer = null; }
        
        if (this.bot) this.bot.physicsEnabled = true;
        this.botFilterState.active = false;
        this.hasLanded = true;
        this.botClient.log('Physics enabled, falling simulation removed.', 'info');
    }

    handleSpawn() {
        this.spawnTime = Date.now();
        this.hasLanded = false;
        this.pendingGravity = false;
        this.lastGroundY = null;

        // A reconnect replaces the mineflayer instance, so the old listeners
        // are gone with the old bot. Re-attach to the new one.
        this.bindBotListeners();

        if (this.settings.emulateVanillaPackets.value) {
            this._emulateVanillaLogin();
        }



        if (this.settings.simulateGravity.value) {
            this._handleFakeLobby();
        } else if (this.settings.bypassXCord.value || this.settings.bypassBotSentry.value) {
            this.bot.physicsEnabled = false;
            setTimeout(() => {
                if (this.bot) this.bot.physicsEnabled = true;
            }, 10000);
        }
    }

    _emulateVanillaLogin() {
        if (!this.bot?._client) return;
        const client = this.bot._client;

        try {
            const settingsPayload = {
                locale: 'en_US',
                viewDistance: 10,
                chatFlags: 0,
                chatColors: true,
                skinParts: 0x7F,
                mainHand: 1,
                enableTextFiltering: false,
                enableServerListing: true
            };

            setTimeout(() => {
                try { if (client.write) client.write('settings', settingsPayload); } catch (e) {}
            }, 200 + Math.random() * 300);

            setTimeout(() => {
                try {
                    if (client.write) {
                        client.write('custom_payload', {
                            channel: 'minecraft:brand',
                            data: Buffer.from('\x07vanilla')
                        });
                    }
                } catch (e) {}
            }, 500 + Math.random() * 500);

            setTimeout(() => {
                try { if (client.write) client.write('held_item_slot', { slotId: 0 }); } catch (e) {}
            }, 800 + Math.random() * 400);
        } catch (e) {}
    }

    _handleFakeLobby() {
        this.bot.physicsEnabled = false;
        this.pendingGravity = true;

        let tickCount = 0;

        this.gravityTimer = setInterval(() => {
            if (!this._isBotAlive() || this.hasLanded) {
                this._stopGravitySim();
                return;
            }

            tickCount++;
            const pos = this.bot.entity.position;
            const fallSpeed = Math.min(0.08 * tickCount, 3.92);
            const newY = pos.y - fallSpeed * 0.05;

            if (newY <= 0 || tickCount > 200) {
                this.hasLanded = true;
                this._stopGravitySim();
                setTimeout(() => {
                    if (this.bot) this.bot.physicsEnabled = true;
                }, 500);
                return;
            }

            try {
                if (this.bot._client && this.bot._client.write) {
                    this.bot._client.write('position', {
                        x: pos.x, y: newY, z: pos.z, onGround: false
                    });
                }
                pos.y = newY;
            } catch (e) {}
        }, 50);

        setTimeout(() => {
            if (this.pendingGravity && this.bot) {
                this._stopGravitySim();
                this.bot.physicsEnabled = true;
            }
        }, 15000);
    }

    _stopGravitySim() {
        this.pendingGravity = false;
        this.botFilterState.active = false;
        if (this.gravityTimer) { clearInterval(this.gravityTimer); this.gravityTimer = null; }
    }

    async handleChat(msg, fromServer = true) {
        if (!fromServer) return;
        const plain = String(msg).replace(/§[0-9a-fk-orA-FK-OR]/g, '');
        const lower = plain.toLowerCase();

        if (this.settings.solveMath.value) {
            // The keyword has to sit next to the expression. A bare
            // "digit op digit" pattern matched any line with two numbers
            // (progress counters, coordinates) and answered them, spamming
            // chat every few seconds until the server kicked the bot.
            const mathPatterns = [
                /(?:solve|answer|what\s+is|calculate|type|enter)\s*:?\s*(-?\d+)\s*([\+\-\*\/x])\s*(-?\d+)/i,
                /(-?\d+)\s*([\+\-\*\/x])\s*(-?\d+)\s*(?:=\s*\?|solve|answer)/i
            ];

            for (const pattern of mathPatterns) {
                const match = plain.match(pattern);
                if (!match) continue;

                const num1 = parseInt(match[1], 10);
                const op = match[2] === 'x' ? '*' : match[2];
                const num2 = parseInt(match[3], 10);
                if (!Number.isFinite(num1) || !Number.isFinite(num2)) continue;
                if (op === '/' && num2 === 0) continue;

                let ans;
                switch (op) {
                    case '+': ans = num1 + num2; break;
                    case '-': ans = num1 - num2; break;
                    case '*': ans = num1 * num2; break;
                    case '/': ans = Math.floor(num1 / num2); break;
                    default: continue;
                }
                if (!Number.isFinite(ans)) continue;

                // One answer per captcha, not one per repeated reminder.
                const now = Date.now();
                if (this.lastMathAnswer && now - this.lastMathAnswer < 20000) return;
                this.lastMathAnswer = now;

                this.log(`Math captcha solved: ${num1} ${op} ${num2} = ${ans}`, 'success');
                const delay = 1500 + Math.random() * 2000;
                setTimeout(() => { this.api.chat(ans.toString()); }, delay);
                return;
            }
        }

        if (this.botFilterState.active && this.settings.bypassBotFilter.value) {
            if (lower.includes('введите') || lower.includes('капч') || lower.includes('капча') ||
                lower.includes('captcha') || lower.includes('номер') ||
                lower.includes('картинк') || lower.includes('number from')) {
                this.log('BotFilter captcha detected. Forwarding to dashboard/Discord.', 'warning');
                this.triggerBridgeAlert(`botfilter-captcha://${plain}`);
            }
        }

        const linkMatch = plain.match(/(https?:\/\/[^\s<>"']+)/);
        if (linkMatch) {
            const url = linkMatch[1];
            // ReallyWorld phrases it as "Captcha » 1. Перейдите на наш сайт по
            // ссылке ниже" with no xcord/verify wording, so keying only on the
            // vendor names meant the link was silently dropped.
            const looksLikeVerification =
                lower.includes('xcord') || lower.includes('verify') || lower.includes('verification') ||
                lower.includes('botsentry') || lower.includes('notbot.es') ||
                lower.includes('captcha') || lower.includes('капч') || lower.includes('капча') ||
                lower.includes('проверк') || lower.includes('подтверд') ||
                lower.includes('перейдите на наш сайт');

            if (looksLikeVerification && (this.settings.bypassXCord.value || this.settings.bypassBotSentry.value)) {
                // The server repeats the reminder every few seconds, each time
                // with a brand new one-time URL. Repeating it just floods the
                // dashboard with links that are already dead.
                const stamp = Date.now();
                if (this.lastCaptchaLink === url && stamp - this.lastCaptchaLinkAt < 60000) {
                    return;
                }
                this.lastCaptchaLink = url;
                this.lastCaptchaLinkAt = stamp;

                this.log(`Verification link detected: ${url}`, 'info');
                // Try to complete the check from the bot's own IP first, only
                // escalate to a human when the request is rejected or fails.
                const solved = this.settings.autoVisitLinks.value
                    ? await this.visitVerificationLink(url)
                    : false;
                // The dashboard opens this in a real browser routed through the
                // bot's proxy, so the page loads from the bot's own IP. The
                // challenge itself (a Cloudflare Turnstile checkbox) has to be
                // ticked by a person - that is the whole point of it.
                this.api.botClient.emit('captchaLink', {
                    url,
                    solved,
                    reason: solved ? 'link-opened' : 'needs-human'
                });
                if (!solved) {
                    this.triggerBridgeAlert(url);
                }
            }
        }

        if (this.settings.bypassBotSentry.value) {
            if (lower.includes('type the color') || lower.includes('enter the color')) {
                const colorMatch = msg.match(/§([0-9a-fk-or])([a-zA-Z]+)/);
                if (colorMatch) {
                    const colorCodes = {
                        '0': 'black', '1': 'dark blue', '2': 'dark green', '3': 'dark aqua',
                        '4': 'dark red', '5': 'dark purple', '6': 'gold', '7': 'gray',
                        '8': 'dark gray', '9': 'blue', 'a': 'green', 'b': 'aqua',
                        'c': 'red', 'd': 'light purple', 'e': 'yellow', 'f': 'white'
                    };
                    const colorName = colorCodes[colorMatch[1]] || colorMatch[2];
                    this.log(`BotSentry color challenge: answering "${colorName}"`, 'success');
                    setTimeout(() => this.api.chat(colorName), 1000 + Math.random() * 1500);
                    return;
                }
            }

            if (lower.includes('enter the code') || lower.includes('type the code')) {
                const codeMatch = plain.match(/(?:code|number)[:\s]*(\d+)/i);
                if (codeMatch) {
                    // Remember it: a map captcha window may open right after.
                    this.currentMapCode = codeMatch[1];
                    this.log(`BotSentry code challenge: answering "${codeMatch[1]}"`, 'success');
                    setTimeout(() => this.api.chat(codeMatch[1]), 1000 + Math.random() * 1500);
                    return;
                }
                this.log('BotSentry code challenge detected but could not parse.', 'warning');
            }

            if (lower.includes('/captcha') || lower.includes('run /captcha')) {
                const captchaCode = msg.match(/\/captcha\s+(\S+)/i);
                if (captchaCode) {
                    this.log(`Auto-executing: /captcha ${captchaCode[1]}`, 'success');
                    setTimeout(() => this.api.chat(`/captcha ${captchaCode[1]}`), 800 + Math.random() * 1000);
                    return;
                }
            }
        }

        // Generic code prompt. Map/image captchas usually print the expected
        // code in chat ("enter the code: 4821"), so remember it for the GUI.
        if (lower.includes('enter the code') || lower.includes('type the code') ||
            lower.includes('enter the number') || lower.includes('введите код') ||
            lower.includes('введите число') || lower.includes('введите номер')) {
            const codeMatch = plain.match(/(?:code|number|код|число|номер)[:\s]*([A-Za-z0-9]{3,10})/i);
            if (codeMatch) {
                this.currentMapCode = codeMatch[1];
                this.log(`Captcha code seen in chat: "${this.currentMapCode}"`, 'info');
                if (lower.includes('enter') || lower.includes('type') || lower.includes('введите')) {
                    this.log(`Answering code challenge: "${this.currentMapCode}"`, 'success');
                    setTimeout(() => this.api.chat(this.currentMapCode), 900 + Math.random() * 1200);
                    return;
                }
            }
        }
    }

    getBotProxyUrl() {
        const config = this.api.botClient?.config;
        if (!config || !config.proxyType || config.proxyType === 'none') return null;
        let auth = '';
        if (config.proxyUser && config.proxyPass) {
            auth = `${encodeURIComponent(config.proxyUser)}:${encodeURIComponent(config.proxyPass)}@`;
        } else if (config.proxyUser) {
            auth = `${encodeURIComponent(config.proxyUser)}@`;
        }
        return `${config.proxyType}://${auth}${config.proxyHost}:${config.proxyPort}`;
    }

    // Link captchas are bound to the IP that the bot connects from, so the
    // request has to leave through the very same proxy as the game session.
    async visitVerificationLink(url) {
        const lastVisit = this.visitedLinks.get(url);
        if (lastVisit && Date.now() - lastVisit < 120000) {
            return false;
        }
        this.visitedLinks.set(url, Date.now());

        let parsed;
        try {
            parsed = new URL(url);
        } catch (e) {
            this.log('Verification link is not a valid URL.', 'warning');
            return false;
        }

        if (isPrivateHostname(parsed.hostname)) {
            this.log('Verification link points at a private address - refused.', 'warning');
            return false;
        }

        const timeout = Math.max(3000, Number(this.settings.linkTimeoutMs.value) || 12000);
        const request = {
            timeout,
            maxRedirects: 5,
            validateStatus: () => true,
            responseType: 'text',
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        };

        const proxyUrl = this.getBotProxyUrl();
        if (proxyUrl) {
            request.proxy = proxyUrl;
        }

        try {
            const res = await axios.get(url, request);
            const body = String(res.data || '').toLowerCase();
            const failed = res.status >= 400 ||
                body.includes('access denied') || body.includes('not verified') ||
                body.includes('verification failed') || body.includes('captcha failed') ||
                body.includes('invalid token') || body.includes('link expired') ||
                body.includes('вы не прошли') || body.includes('проверка не пройдена');

            if (failed) {
                this.log(`Link opened but server rejected it (HTTP ${res.status}). Falling back to manual.`, 'warning');
                return false;
            }

            this.log(`Verification link opened successfully (HTTP ${res.status}${proxyUrl ? ', via proxy' : ''}).`, 'success');
            return true;
        } catch (err) {
            this.log(`Could not open verification link: ${err.message}. Falling back to manual.`, 'warning');
            return false;
        }
    }

    async triggerBridgeAlert(url) {
        let finalUrl = url;

        if (this.settings.useBridge.value) {
            try {
                // config.constructor is Object - this always threw a TypeError
                // and was swallowed, so the bridge URL was never applied.
                const settings = await ConfigLoader.loadSettings() || {};
                const baseUrl = settings.publicDashboardUrl;
                if (baseUrl) {
                    finalUrl = `${baseUrl.replace(/\/$/, '')}/bridge/solve?bot=${encodeURIComponent(this.api.botClient.username)}&target=${encodeURIComponent(url)}`;
                }
            } catch (e) {}
        }

        const discord = this.api.botClient.featureManager?.getFeature('discord');
        if (discord) {
            discord.sendWebhookMessage(
                `**Anti-AntiBot Alert**\nBot **${this.api.botClient.username}** requires verification.\n\n[Solve via Bot IP](${finalUrl})\n[Original Link](${url})`
            );
        }
        this.log(`Verification required: ${finalUrl}`, 'warning');

        this.api.botClient.emitChat(
            'System',
            `Verification required! Link: ${finalUrl}`,
            'info',
            `\x1b[1;33m[Anti-AntiBot]\x1b[0m \x1b[36mVerification required! \x1b[4m${finalUrl}\x1b[0m`
        );
    }

    async handleWindow(window) {
        if (!this.settings.solveInventory.value) return;

        let title = '';
        try {
            if (typeof window.title === 'string') {
                if (window.title.startsWith('{') || window.title.startsWith('"')) {
                    const parsed = JSON.parse(window.title);
                    title = parsed.text || parsed.translate || parsed.extra?.map(e => e.text).join('') || '';
                } else {
                    title = window.title;
                }
            }
        } catch (e) {
            title = String(window.title || '');
        }

        const cleanTitle = title.replace(/§[0-9a-fk-or]/gi, '').toLowerCase().trim();

        const isCaptchaWindow = cleanTitle.includes('captcha') || cleanTitle.includes('verif') ||
            cleanTitle.includes('click the') || cleanTitle.includes('select') ||
            cleanTitle.includes('bot check') || cleanTitle.includes('anti-bot') ||
            cleanTitle.includes('капч') || cleanTitle.includes('проверк');

        if (!isCaptchaWindow) return;

        this.log(`Captcha GUI detected: "${cleanTitle}"`, 'info');

        const items = window.slots || [];
        let targetMaterial = cleanTitle.match(/click (?:the |on )?([a-z_ ]+)/)?.[1]?.trim().replace(/ /g, '_');

        await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));

        if (targetMaterial) {
            const target = items.find(item =>
                item && item.type !== -1 && item.name &&
                (item.name.includes(targetMaterial) ||
                    (item.displayName && item.displayName.toLowerCase().includes(targetMaterial.replace(/_/g, ' '))))
            );
            if (target) {
                this.log(`Clicking target: ${target.name || target.displayName} (slot ${target.slot})`, 'success');
                try { this.bot.clickWindow(target.slot, 0, 0); } catch (e) {}
                return;
            }
        }

        const mapSlots = items.filter(item =>
            item && item.type !== -1 && /(^|:)filled_map$/.test(String(item.name || ''))
        );
        if (mapSlots.length) {
            // The image itself cannot be read without OCR, but the answer is
            // very often printed in chat right before the window opens.
            const wantsCode = cleanTitle.includes('code') || cleanTitle.includes('number') ||
                cleanTitle.includes('type') || cleanTitle.includes('enter') ||
                cleanTitle.includes('код') || cleanTitle.includes('число');

            if (wantsCode && this.currentMapCode) {
                this.log(`Map captcha: answering with code "${this.currentMapCode}" from chat.`, 'success');
                setTimeout(() => this.api.chat(this.currentMapCode), 700 + Math.random() * 900);
                return;
            }

            const mapLabels = mapSlots.map(item => `${item.displayName || ''} ${(item.lore || []).join(' ')}`);
            const codeFromLore = mapLabels.join(' ').match(/\b(\d{3,10})\b/);
            if (wantsCode && codeFromLore) {
                this.log(`Map captcha: answering with code "${codeFromLore[1]}" from item lore.`, 'success');
                setTimeout(() => this.api.chat(codeFromLore[1]), 700 + Math.random() * 900);
                return;
            }

            // Nothing readable - hand it to a human. The dashboard already
            // renders the map image for this window, so it is one click away.
            this.log(`Map captcha needs a human (${mapSlots.length} map slot(s), title "${cleanTitle}"). Escalating.`, 'warning');
            this.currentMapCode = null;
            this.triggerBridgeAlert(`map-captcha://${encodeURIComponent(cleanTitle || 'captcha')}`);
            return;
        }

        const verifyItem = items.find(item =>
            item && item.type !== -1 && item.displayName &&
            (item.displayName.toLowerCase().includes('click') ||
                item.displayName.toLowerCase().includes('verify') ||
                item.displayName.toLowerCase().includes('confirm') ||
                item.displayName.toLowerCase().includes('✔') ||
                item.displayName.toLowerCase().includes('✓'))
        );
        if (verifyItem) {
            this.log(`Clicking verify: ${verifyItem.displayName} (slot ${verifyItem.slot})`, 'success');
            try { this.bot.clickWindow(verifyItem.slot, 0, 0); } catch (e) {}
            return;
        }

        const fillerNames = new Set(['gray_stained_glass_pane', 'black_stained_glass_pane', 'white_stained_glass_pane', 'air']);
        const clickable = items.find(item =>
            item && item.type !== -1 && item.name && !fillerNames.has(item.name)
        );
        if (clickable) {
            this.log(`Clicking first available: ${clickable.name} (slot ${clickable.slot})`, 'info');
            try { this.bot.clickWindow(clickable.slot, 0, 0); } catch (e) {}
            return;
        }

        this.log('Captcha GUI: no clickable items found.', 'warning');
    }

    handleKicked(reason) {
        const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
        const lower = reasonStr.toLowerCase();
        const now = Date.now();

        if (now - this.lastKickTime < 120000) {
            this.consecutiveKicks++;
        } else {
            this.consecutiveKicks = 1;
        }
        this.lastKickTime = now;

        if (!this.settings.bypassXCord.value && !this.settings.bypassBotSentry.value && !this.settings.bypassBotFilter.value) return;

        if (lower.includes('не прошли проверку') || lower.includes('возможно вы бот') ||
            lower.includes('bot filter') || lower.includes('botfilter') ||
            lower.includes('failed position') || lower.includes('failed falling') ||
            lower.includes('failed captcha')) {
            this.log('BotFilter check failed. Retrying in 15 seconds...', 'warning');
            this.api.botClient.customReconnectDelay = 15000;
            this.botFilterState.active = false;
            return;
        }

        if (lower.includes('verified') || lower.includes('complete') ||
            lower.includes('passthrough') || lower.includes('re-join') ||
            lower.includes('rejoin') || lower.includes('success') ||
            lower.includes('приятной игры') || lower.includes('проверка пройдена')) {
            this.log('Verification complete! Auto-rejoining...', 'success');
            this.consecutiveKicks = 0;
            setTimeout(() => this.api.reconnect(), 1500 + Math.random() * 1000);
            return;
        }

        if (lower.includes('denied') || lower.includes('wait a few minutes') ||
            lower.includes('too many') || lower.includes('rate limit') ||
            lower.includes('temporarily banned') || lower.includes('try again later') ||
            lower.includes('подозрительная активность') || lower.includes('повторите попытку')) {
            const baseMinutes = this.settings.smartBackoffMinutes.value || 5;
            const multiplier = Math.min(this.consecutiveKicks, 4);
            const backoffMs = baseMinutes * multiplier * 60000;
            this.log(`IP denial (kick #${this.consecutiveKicks}). Backoff: ${(backoffMs / 60000).toFixed(1)}min`, 'error');
            this.api.botClient.customReconnectDelay = backoffMs;
            return;
        }

        if (lower.includes('not verified') || lower.includes('false positive') ||
            lower.includes('bot verification') || lower.includes('высокий пинг') ||
            lower.includes('big ping')) {
            this.log('Verification failed. Retrying in 30 seconds...', 'warning');
            this.api.botClient.customReconnectDelay = 30000;
            return;
        }
    }

    _isBotAlive() {
        return this.bot?.entity &&
            this.bot?._client?.socket &&
            !this.bot._client.socket.destroyed;
    }

    log(msg, type = 'info') {
        this.api.log(msg, type);
    }
}
