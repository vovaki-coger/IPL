import { BaseFeature } from './BaseFeature.js';

import { createRequire } from 'module';

import { NetworkUtils } from '../utils/NetworkUtils.js';
import { setBasePort, getBasePort } from '../utils/ConfigBase.js';
import { ConfigLoader } from '../config/ConfigLoader.js';

const require = createRequire(import.meta.url);

// prismarine-viewer pulls native canvas bindings at import time. Probe once and
// cache the result: without it every login/spawn would retry the require and
// spam the log with the same native-module error.
let canvasAvailable = null;
function isCanvasAvailable() {
    if (canvasAvailable === null) {
        try {
            require('canvas');
            canvasAvailable = true;
        } catch {
            canvasAvailable = false;
        }
    }
    return canvasAvailable;
}

export function setViewerBasePort(port) {
    setBasePort(port);
}

export class Viewer extends BaseFeature {
    init() {
        this.loginHandler = () => {
            if (this.botClient.bot?.entity?.position && this.botClient.bot?.world) {
                this.startViewer();
            }
        };
        this.spawnHandler = () => {
            this.startViewer();
        };
        this.botClient.bot.on('login', this.loginHandler);
        this.botClient.bot.on('spawn', this.spawnHandler);
    }

    async startViewer(forceRestart = false) {
        if (this.viewerInstance) {
            if (!forceRestart) return;
            try {
                this.viewerInstance.close();
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) { }
            this.viewerInstance = null;
        }

        if (!this.botClient.bot?.entity?.position || !this.botClient.bot?.world) return;

        if (!isCanvasAvailable()) {
            if (!this.canvasMissingLogged) {
                this.canvasMissingLogged = true;
                this.botClient.log(
                    '3D viewer disabled: native module "canvas" is not built for this platform. Run "pnpm rebuild canvas" (Replit) or "npm rebuild canvas".',
                    'error'
                );
            }
            return;
        }

        let basePort;
        if (ConfigLoader.isCloud) {
            const usernameHash = Array.from(this.botClient.username || '').reduce((a, c) => a + c.charCodeAt(0), 0);
            basePort = getBasePort() + 100 + (usernameHash % 50);
        } else {
            basePort = this.botClient.config.viewerPort || (4000 + Math.floor(Math.random() * 1000));
        }

        try {
            // prismarine-viewer is still loaded lazily so the dashboard can
            // start even if something else in its dependency tree is broken.
            const { mineflayer: viewer } = require('prismarine-viewer');
            const port = await NetworkUtils.findFreePort(basePort);
            const viewerPrefix = `/viewer/${port}`;

            viewer(this.botClient.bot, {
                port: port,
                host: '127.0.0.1',
                firstPerson: !!this.botClient.config.firstPerson,
                prefix: viewerPrefix
            });
            const activeViewer = this.botClient.bot.viewer;
            this.viewerInstance = activeViewer?.close
                ? { close: () => activeViewer.close() }
                : null;

            this.botClient.config.viewerPort = port;
            this.botClient.log(`Viewer started on port ${port} (${this.botClient.config.firstPerson ? '1st' : '3rd'} Person)`, 'success');
            this.botClient.emit('viewerStarted', { port: port });

        } catch (err) {
            this.botClient.log(`Viewer error: ${err.message}`, 'error');
        }
    }

    toggleView() {
        this.botClient.config.firstPerson = !this.botClient.config.firstPerson;
        this.startViewer(true);
    }

    async dispose() {
        if (this.loginHandler) {
            this.botClient.bot?.removeListener('login', this.loginHandler);
            this.loginHandler = null;
        }
        if (this.spawnHandler) {
            this.botClient.bot?.removeListener('spawn', this.spawnHandler);
            this.spawnHandler = null;
        }
        if (this.viewerInstance) {
            try {
                this.viewerInstance.close();
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (e) { }
            this.viewerInstance = null;
        }
    }


}
