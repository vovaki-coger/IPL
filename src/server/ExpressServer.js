import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import compression from 'compression';
import { ProxyAgent } from 'proxy-agent';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { botManager } from '../core/BotManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ExpressServer {
    constructor(port = 3000) {
        this.app = express();
        this.httpServer = createServer(this.app);
        this.port = port;
        this.browserSessions = new Map();
        this.browserEnginePort = Number(process.env.BROWSER_ENGINE_PORT) || this.port + 1;
        this.browserEngineProcess = null;
        this.browserEngineReady = this.startBrowserEngine();

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocketProxies();

        this.browserCleanup = setInterval(() => {
            const now = Date.now();
            for (const [id, session] of this.browserSessions.entries()) {
                if (session.expiresAt <= now) {
                    this.browserSessions.delete(id);
                    if (session.engineSessionId) {
                        browserEngineRequest(
                            session.enginePort,
                            `/session/${encodeURIComponent(session.engineSessionId)}`,
                            { method: 'DELETE' }
                        ).catch(() => {});
                    }
                }
            }
        }, 60_000);
        this.browserCleanup.unref?.();
    }

    async startBrowserEngine() {
        if (process.env.IMPERIALS_DISABLE_BROWSER_ENGINE === 'true') return false;

        const pythonCandidates = [
            process.env.PYTHON_BIN,
            path.join(process.cwd(), '.pythonlibs/bin/python'),
            path.join(process.cwd(), '.pythonlibs/bin/python3'),
            path.join(process.cwd(), '.pythonlibs/Scripts/python.exe'),
            path.join(process.cwd(), '.pythonlibs/Scripts/python3.exe'),
            'python3'
        ].filter(Boolean);
        // path.join emits backslashes on Windows, so a '/' only check never
        // verified the local interpreter and fell through to a missing python3.
        const looksLikePath = (candidate) => candidate.includes('/') || candidate.includes('\\');
        const pythonBin = pythonCandidates.find(candidate =>
            looksLikePath(candidate) ? existsSync(candidate) : true
        );
        const enginePath = path.join(__dirname, '../../browser_engine.py');
        if (!pythonBin || !existsSync(enginePath)) return false;

        this.browserEngineProcess = spawn(
            pythonBin,
            [enginePath, '--port', String(this.browserEnginePort)],
            { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } }
        );
        this.browserEngineProcess.stdout?.on('data', data => {
            console.log(`[browser-engine] ${String(data).trim()}`);
        });
        this.browserEngineProcess.stderr?.on('data', data => {
            console.warn(`[browser-engine] ${String(data).trim()}`);
        });
        this.browserEngineProcess.on('error', error => {
            console.warn(`[browser-engine] unavailable: ${error.message}`);
        });

        const ready = await waitForBrowserEngine(this.browserEnginePort);
        if (!ready) {
            this.browserEngineProcess.kill('SIGTERM');
            this.browserEngineProcess = null;
        }
        return ready;
    }

    setupMiddleware() {
        this.app.use(compression());
        this.app.use(express.json());

        // Security Headers
        this.app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            res.setHeader('X-XSS-Protection', '1; mode=block');
            next();
        });

        this.app.use(express.static(path.join(__dirname, '../../public'), {
            maxAge: 0,
            setHeaders: (res, filePath) => {
                if (filePath.endsWith('.html') || filePath.endsWith('app.js')) {
                    res.setHeader('Cache-Control', 'no-store');
                }
            }
        }));
    }

    setupRoutes() {
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../../public/index.html'));
        });

        // On-demand render of what the bot can see. A headless bot has no
        // framebuffer, so this draws the loaded block data instead of
        // screenshotting anything.
        this.app.get('/snapshot', async (req, res) => {
            const bot = botManager.getBot(String(req.query.bot || ''));
            if (!bot?.bot?.entity) {
                return res.status(404).json({ error: 'Bot is not in the game.' });
            }
            try {
                const { renderTopDown } = await import('../utils/BlockRender.js');
                const { buffer, meta } = renderTopDown(bot.bot, {
                    radius: req.query.radius,
                    scale: req.query.scale
                });
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('X-Snapshot', JSON.stringify(meta));
                res.type('png').send(buffer);
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Short-lived server-side browser sessions. The request is made from
        // the same network path as the selected bot, without exposing proxy
        // credentials to the browser. Private/local targets are rejected.
        this.app.post('/browser/open', async (req, res) => {
            const { url, bot: botName, profile, username } = req.body || {};
            const rawUrl = String(url || '').trim();
            const normalizedUrl = rawUrl && /^[a-z][a-z\d+\-.]*:\/\//i.test(rawUrl)
                ? rawUrl
                : rawUrl
                    ? `https://${rawUrl}`
                    : '';
            let target;
            try {
                target = new URL(normalizedUrl);
            } catch {
                return res.status(400).json({ error: 'A valid http(s) URL is required.' });
            }

            if (!['http:', 'https:'].includes(target.protocol) || isPrivateHostname(target.hostname)) {
                return res.status(400).json({ error: 'This URL is not allowed.' });
            }

            const bot = botManager.getBot(String(botName || profile || username || ''));
            const proxyAgent = createBotProxyAgent(bot);
            const id = crypto.randomUUID();
            const expiresAt = Date.now() + 5 * 60 * 1000;
            this.browserSessions.set(id, {
                url: target.toString(),
                agent: proxyAgent,
                expiresAt,
                cookies: new Map(),
                enginePort: this.browserEnginePort
            });

            const session = this.browserSessions.get(id);
            try {
                // SeleniumBase renders the first document in a real Chromium
                // context. Its cookies are copied into the existing proxy
                // session so the iframe keeps using the same origin.
                const engine = await openBrowserEngineSession(
                    this.browserEngineReady,
                    this.browserEnginePort,
                    target,
                    createBotBrowserProxy(bot)
                );
                if (engine) {
                    session.engineSessionId = engine.id;
                    mergeEngineCookies(session.cookies, engine.cookies);
                    session.url = engine.currentUrl || target.toString();
                } else {
                    await fetchBrowserTarget(session, target);
                }
            } catch (error) {
                this.browserSessions.delete(id);
                return res.status(502).json({ error: `Browser session failed: ${error.message}` });
            }

            res.json({
                id,
                expiresAt,
                url: `/browser/session/${id}`,
                engine: Boolean(session.engineSessionId),
                currentUrl: session.url
            });
        });

        this.app.get('/browser/session/:id/screenshot', async (req, res) => {
            const session = this.browserSessions.get(req.params.id);
            if (!session || session.expiresAt <= Date.now()) {
                return res.status(410).json({ error: 'Browser session expired.' });
            }
            if (!session.engineSessionId) {
                return res.status(409).json({ error: 'Interactive browser engine is unavailable.' });
            }

            try {
                const response = await fetch(
                    `http://127.0.0.1:${session.enginePort}/session/${encodeURIComponent(session.engineSessionId)}/screenshot`,
                    { signal: AbortSignal.timeout(20_000) }
                );
                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    return res.status(response.status).json({ error: error.error || 'Could not capture browser screen.' });
                }
                session.expiresAt = Date.now() + 5 * 60 * 1000;
                const bytes = Buffer.from(await response.arrayBuffer());
                // The engine may answer with PNG or JPEG depending on what CDP
                // gave us; relaying a hardcoded image/png breaks the <img> decode.
                res.set('Content-Type', response.headers.get('content-type') || 'image/png')
                   .set('Cache-Control', 'no-store');
                res.send(bytes);
            } catch (error) {
                res.status(502).json({ error: `Browser screenshot failed: ${error.message}` });
            }
        });

        this.app.get('/browser/session/:id/state', async (req, res) => {
            const session = this.browserSessions.get(req.params.id);
            if (!session || session.expiresAt <= Date.now()) {
                return res.status(410).json({ error: 'Browser session expired.' });
            }
            const state = await syncBrowserEngineSession(session);
            if (!state) return res.status(502).json({ error: 'Browser engine session is unavailable.' });
            session.url = state.currentUrl || session.url;
            session.expiresAt = Date.now() + 5 * 60 * 1000;
            res.set('Cache-Control', 'no-store').json({
                url: session.url,
                title: state.title,
                expiresAt: session.expiresAt
            });
        });

        this.app.post('/browser/session/:id/navigate', async (req, res) => {
            const session = this.browserSessions.get(req.params.id);
            if (!session || session.expiresAt <= Date.now()) {
                return res.status(410).json({ error: 'Browser session expired.' });
            }
            const rawUrl = String(req.body?.url || '').trim();
            const normalizedUrl = rawUrl && /^[a-z][a-z\d+\-.]*:\/\//i.test(rawUrl)
                ? rawUrl
                : rawUrl
                    ? `https://${rawUrl}`
                    : '';
            let target;
            try {
                target = new URL(normalizedUrl);
            } catch {
                return res.status(400).json({ error: 'A valid http(s) URL is required.' });
            }
            if (!['http:', 'https:'].includes(target.protocol) || isPrivateHostname(target.hostname)) {
                return res.status(400).json({ error: 'This URL is not allowed.' });
            }
            if (!session.engineSessionId) {
                return res.status(409).json({ error: 'Interactive browser engine is unavailable.' });
            }
            try {
                const state = await navigateBrowserEngineSession(session, target);
                session.expiresAt = Date.now() + 5 * 60 * 1000;
                res.json({ url: state.currentUrl, title: state.title, expiresAt: session.expiresAt });
            } catch (error) {
                res.status(502).json({ error: `Navigation failed: ${error.message}` });
            }
        });

        this.app.post('/browser/session/:id/action', async (req, res) => {
            const session = this.browserSessions.get(req.params.id);
            if (!session || session.expiresAt <= Date.now()) {
                return res.status(410).json({ error: 'Browser session expired.' });
            }
            if (!session.engineSessionId) {
                return res.status(409).json({ error: 'Interactive browser engine is unavailable.' });
            }
            const { action } = req.body || {};
            if (!['click', 'type', 'key', 'scroll', 'back', 'forward', 'reload'].includes(action)) {
                return res.status(400).json({ error: 'Unsupported browser action.' });
            }
            try {
                const result = await browserEngineRequest(
                    session.enginePort,
                    `/session/${encodeURIComponent(session.engineSessionId)}/action`,
                    { method: 'POST', body: JSON.stringify(req.body) }
                );
                session.url = result.url || session.url;
                session.expiresAt = Date.now() + 5 * 60 * 1000;
                res.json({ status: 'ok', url: session.url, expiresAt: session.expiresAt });
            } catch (error) {
                res.status(502).json({ error: `Browser action failed: ${error.message}` });
            }
        });

        // Every page and asset requested by the mini browser is fetched here,
        // from the machine running ImperialsBot. The browser only receives
        // the response; it never connects to the target site directly.
        this.app.use('/browser/session/:id', async (req, res) => {
            const session = this.browserSessions.get(req.params.id);
            if (!session || session.expiresAt <= Date.now()) {
                this.browserSessions.delete(req.params.id);
                return res.status(410).send('Browser session expired.');
            }

            // The target site may forbid framing itself with X-Frame-Options or
            // frame-ancestors. This response is already served from the
            // ImperialsBot origin, so the target's framing policy must not be
            // copied into the server-side browser view.
            res.removeHeader('X-Frame-Options');
            res.removeHeader('Content-Security-Policy');

            const requestedUrl = typeof req.query.url === 'string'
                ? req.query.url
                : session.url;
            let target;
            try {
                target = new URL(requestedUrl);
                if (!['http:', 'https:'].includes(target.protocol) || isPrivateHostname(target.hostname)) {
                    return res.status(400).send('This browser URL is not allowed.');
                }

                const isDocumentRequest = String(req.headers.accept || '').includes('text/html');
                if (session.engineSessionId && isDocumentRequest && target.toString() !== session.url) {
                    await navigateBrowserEngineSession(session, target);
                } else {
                    await syncBrowserEngineSession(session);
                }

                const response = await fetchBrowserTarget(session, target);

                const location = response.headers.get('location');
                if (location && response.status >= 300 && response.status < 400) {
                    const redirectTarget = new URL(location, target);
                    if (!['http:', 'https:'].includes(redirectTarget.protocol) ||
                        isPrivateHostname(redirectTarget.hostname)) {
                        return res.status(502).send('The target site returned a blocked redirect.');
                    }
                    res.status(response.status)
                        .set('Location', makeBrowserSessionUrl(req.params.id, redirectTarget))
                        .end();
                    return;
                }

                const contentType = response.headers.get('content-type') || 'application/octet-stream';
                const body = Buffer.from(await response.arrayBuffer());
                res.status(response.status).set('Content-Type', contentType);

                if (contentType.includes('text/html')) {
                    res.send(rewriteBrowserHtml(body.toString('utf8'), target, req.params.id));
                } else if (contentType.includes('text/css')) {
                    res.send(rewriteBrowserCss(body.toString('utf8'), target, req.params.id));
                } else {
                    res.send(body);
                }
            } catch (error) {
                res.status(502).send(`Browser request failed: ${escapeHtml(error.message)}`);
            }
        });

        // Proxy Route for Viewer
        this.app.use('/viewer/:port', (req, res, next) => {
            const targetPort = parseInt(req.params.port);
            
            // proxy to ports currently authorized by the BotManager
            const authorizedPorts = botManager.getAuthorizedPorts();
            
            if (targetPort && authorizedPorts.has(targetPort)) {
                const proxy = createProxyMiddleware({
                    target: `http://localhost:${targetPort}`,
                    ws: true,
                    changeOrigin: true,
                    pathRewrite: (path) => path
                });
                proxy(req, res, next);
            } else {
                res.status(403).json({ error: 'Access Denied: Port not authorized' });
            }
        });

        // CAPTCHA Bridge Proxy
        this.app.get('/bridge/solve', async (req, res) => {
            const { target, bot: botName } = req.query;
            if (!target) return res.status(400).send('Target URL required');

            try {
                let agent = null;
                const { botManager } = await import('../core/BotManager.js');
                const bot = botManager.getBot(botName);
                
                if (bot && bot.config && bot.config.proxy) {
                    agent = new ProxyAgent(bot.config.proxy);
                }

                const response = await fetch(target, { 
                    agent, 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
                });

                const body = await response.text();
                const baseTag = `<base href="${new URL(target).origin}/">`;
                const modifiedBody = body.replace('<head>', `<head>${baseTag}`);
                
                res.send(modifiedBody);
            } catch (err) {
                res.status(500).send(`Bridge error: ${err.message}`);
            }
        });

        // Proxy Route for Inventory
        this.app.use('/inventory/:port', (req, res, next) => {
            const targetPort = parseInt(req.params.port);
            
            import('../core/BotManager.js').then(({ botManager }) => {
                const authorizedPorts = botManager.getAuthorizedPorts();

                if (targetPort && authorizedPorts.has(targetPort)) {
                    const proxy = createProxyMiddleware({
                        target: `http://localhost:${targetPort}`,
                        ws: true,
                        changeOrigin: true,
                        pathRewrite: (requestPath) => `/viewer/${targetPort}${requestPath}`
                    });
                    proxy(req, res, next);
                } else {
                    res.status(403).json({ error: 'Access Denied: Port not authorized' });
                }
            });
        });
    }

    setupWebSocketProxies() {
        // http-proxy-middleware does not automatically receive upgrade
        // requests when it is mounted dynamically below an Express route.
        // prismarine-viewer uses a WebSocket for live world updates, so wire
        // the upgrade path explicitly on the same HTTP server.
        this.httpServer.on('upgrade', (req, socket, head) => {
            const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
            let match = pathname.match(/^\/viewer\/(\d+)(\/.*)?$/);
            let targetPort;
            let rewritePrefix;
            let targetPathPrefix = '';

            if (match) {
                targetPort = Number(match[1]);
                rewritePrefix = `/viewer/${match[1]}`;
            } else {
                match = pathname.match(/^\/inventory\/(\d+)(\/.*)?$/);
                if (!match) return;
                targetPort = Number(match[1]);
                rewritePrefix = `/inventory/${match[1]}`;
                targetPathPrefix = `/viewer/${match[1]}`;
            }

            if (!Number.isInteger(targetPort) || !botManager.getAuthorizedPorts().has(targetPort)) {
                socket.destroy();
                return;
            }

            const proxy = createProxyMiddleware({
                target: `http://127.0.0.1:${targetPort}`,
                ws: true,
                changeOrigin: true,
                pathRewrite: requestPath => {
                    const rewritten = requestPath.replace(rewritePrefix, '');
                    return `${targetPathPrefix}${rewritten || '/'}`;
                }
            });

            proxy.upgrade(req, socket, head);
        });
    }

    start() {
        const host = process.env.HOST || '0.0.0.0';
        this.httpServer.listen(this.port, host, () => {
            console.log(`Server running on http://${host}:${this.port}`);
        });
    }
}

function createBotProxyAgent(bot) {
    if (!bot?.config?.proxyType || bot.config.proxyType === 'none') return null;
    const { proxyType, proxyHost, proxyPort, proxyUser, proxyPass } = bot.config;
    if (!['socks4', 'socks5'].includes(proxyType) || !proxyHost || !proxyPort) return null;
    const auth = proxyUser
        ? `${encodeURIComponent(proxyUser)}${proxyPass ? `:${encodeURIComponent(proxyPass)}` : ''}@`
        : '';
    return new ProxyAgent(`${proxyType}://${auth}${proxyHost}:${proxyPort}`);
}

function createBotBrowserProxy(bot) {
    if (!bot?.config?.proxyType || bot.config.proxyType === 'none') return '';
    const { proxyType, proxyHost, proxyPort, proxyUser, proxyPass } = bot.config;
    if (!['socks4', 'socks5'].includes(proxyType) || !proxyHost || !proxyPort) return '';
    const auth = proxyUser
        ? `${encodeURIComponent(proxyUser)}${proxyPass ? `:${encodeURIComponent(proxyPass)}` : ''}@`
        : '';
    return `${proxyType}://${auth}${proxyHost}:${proxyPort}`;
}

async function waitForBrowserEngine(port, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/healthz`);
            if (response.ok) return true;
        } catch {
            // The Python process may still be starting Chromium dependencies.
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
}

async function browserEngineRequest(port, requestPath, options = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        signal: AbortSignal.timeout(40_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Browser engine request failed (${response.status})`);
    }
    return payload;
}

async function openBrowserEngineSession(browserEngineReady, port, target, proxy) {
    if (!await browserEngineReady) return null;
    try {
        return await browserEngineRequest(
            port,
            '/open',
            { method: 'POST', body: JSON.stringify({ url: target.toString(), proxy }) }
        );
    } catch {
        return null;
    }
}

async function syncBrowserEngineSession(session) {
    if (!session.engineSessionId) return null;
    try {
        const state = await browserEngineRequest(
            session.enginePort,
            `/session/${encodeURIComponent(session.engineSessionId)}`
        );
        mergeEngineCookies(session.cookies, state.cookies);
        return state;
    } catch {
        return null;
    }
}

async function navigateBrowserEngineSession(session, target) {
    if (!session.engineSessionId) return null;
    const state = await browserEngineRequest(
        session.enginePort,
        `/session/${encodeURIComponent(session.engineSessionId)}/navigate`,
        { method: 'POST', body: JSON.stringify({ url: target.toString() }) }
    );
    session.url = state.currentUrl || target.toString();
    mergeEngineCookies(session.cookies, state.cookies);
    return state;
}

function mergeEngineCookies(cookieJar, cookies = []) {
    for (const cookie of cookies) {
        if (!cookie?.name) continue;
        const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
        if (!domain) continue;
        const path = cookie.path || '/';
        const key = `engine:${domain}:${path}:${cookie.name}`;
        const expiresAt = cookie.expiry ? Number(cookie.expiry) * 1000 : null;
        if (expiresAt && expiresAt <= Date.now()) {
            cookieJar.delete(key);
            continue;
        }
        cookieJar.set(key, {
            name: cookie.name,
            value: cookie.value || '',
            domain,
            hostOnly: false,
            path,
            secure: Boolean(cookie.secure),
            expiresAt
        });
    }
}

const BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

async function fetchBrowserTarget(session, target) {
    const headers = {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    };
    const cookieHeader = getBrowserCookieHeader(session.cookies, target);
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(target, {
        agent: session.agent || undefined,
        headers,
        redirect: 'manual'
    });

    storeBrowserCookies(session.cookies, response, target);
    return response;
}

function getBrowserCookieHeader(cookieJar, target) {
    const now = Date.now();
    const hostname = target.hostname.toLowerCase();
    const pathname = target.pathname || '/';
    const values = [];

    for (const [key, cookie] of cookieJar.entries()) {
        if (cookie.expiresAt && cookie.expiresAt <= now) {
            cookieJar.delete(key);
            continue;
        }
        if (cookie.secure && target.protocol !== 'https:') continue;

        const domainMatches = cookie.hostOnly
            ? hostname === cookie.domain
            : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
        const pathMatches = pathname === cookie.path ||
            pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`);

        if (domainMatches && pathMatches) {
            values.push(`${cookie.name}=${cookie.value}`);
        }
    }

    return values.join('; ');
}

function storeBrowserCookies(cookieJar, response, target) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);

    for (const rawCookie of setCookies) {
        const parts = rawCookie.split(';').map(part => part.trim());
        const separator = parts[0].indexOf('=');
        if (separator <= 0) continue;

        const name = parts[0].slice(0, separator).trim();
        const value = parts[0].slice(separator + 1).trim();
        const attributes = new Map();
        for (const attribute of parts.slice(1)) {
            const equal = attribute.indexOf('=');
            const key = (equal === -1 ? attribute : attribute.slice(0, equal)).trim().toLowerCase();
            const attrValue = equal === -1 ? '' : attribute.slice(equal + 1).trim();
            attributes.set(key, attrValue);
        }

        let domain = (attributes.get('domain') || target.hostname).toLowerCase().replace(/^\./, '');
        const hostOnly = !attributes.has('domain');
        const path = attributes.get('path') || '/';
        let expiresAt = null;
        if (attributes.has('max-age')) {
            const maxAge = Number(attributes.get('max-age'));
            expiresAt = Number.isFinite(maxAge) ? Date.now() + Math.max(0, maxAge) * 1000 : null;
        } else if (attributes.has('expires')) {
            const expires = Date.parse(attributes.get('expires'));
            expiresAt = Number.isNaN(expires) ? null : expires;
        }

        const key = `${hostOnly ? 'host' : 'domain'}:${domain}:${path}:${name}`;
        if (expiresAt !== null && expiresAt <= Date.now()) {
            cookieJar.delete(key);
        } else {
            cookieJar.set(key, {
                name,
                value,
                domain,
                hostOnly,
                path,
                secure: attributes.has('secure'),
                expiresAt
            });
        }
    }
}

function isPrivateHostname(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true;
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some(Number.isNaN)) return false;
    const [a, b] = octets;
    return a === 10 || a === 127 || a === 169 && b === 254 ||
        a === 172 && b >= 16 && b <= 31 ||
        a === 192 && b === 168;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

function makeBrowserSessionUrl(sessionId, target) {
    return `/browser/session/${encodeURIComponent(sessionId)}?url=${encodeURIComponent(target.toString())}`;
}

function rewriteBrowserUrl(value, baseUrl, sessionId) {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('#') || /^(?:data|blob|javascript|mailto|tel):/i.test(raw)) {
        return raw;
    }

    try {
        const target = new URL(raw, baseUrl);
        if (!['http:', 'https:'].includes(target.protocol) || isPrivateHostname(target.hostname)) {
            return raw;
        }
        return makeBrowserSessionUrl(sessionId, target);
    } catch {
        return raw;
    }
}

function rewriteBrowserHtml(html, baseUrl, sessionId) {
    const withoutBase = html
        .replace(/<base\b[^>]*>/gi, '')
        .replace(/<meta\b[^>]*(?:http-equiv\s*=\s*["']?content-security-policy["']?|content\s*=\s*["'][^"']*frame-ancestors[^"']*["'])[^>]*>/gi, '');
    return withoutBase.replace(
        /(\b(?:href|src|action|poster)\s*=\s*)(["'])(.*?)\2/gi,
        (_, prefix, quote, value) =>
            `${prefix}${quote}${escapeHtml(rewriteBrowserUrl(value, baseUrl, sessionId))}${quote}`
    );
}

function rewriteBrowserCss(css, baseUrl, sessionId) {
    return css.replace(
        /url\(\s*(["']?)(.*?)\1\s*\)/gi,
        (_, quote, value) => {
            const rewritten = rewriteBrowserUrl(value, baseUrl, sessionId);
            return `url(${quote}${escapeHtml(rewritten)}${quote})`;
        }
    );
}
