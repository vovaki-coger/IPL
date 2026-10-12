const socket = io();

let currentBot = null;
let currentManualWindowId = null;
let currentTab = 'controls';
let bots = new Map();
let activeKeys = new Set();
let spammerEnabled = false;
let lowPerformanceEnabled = false;
let chatVisible = true;
let watchlist = [];
let isCloudMode = false;
const step = 3;
const manualCaptchaPanel = document.getElementById('manualCaptchaPanel');
const manualCaptchaTitle = document.getElementById('manualCaptchaTitle');
const manualCaptchaMaps = document.getElementById('manualCaptchaMaps');
const manualCaptchaSlots = document.getElementById('manualCaptchaSlots');
const manualCaptchaHelp = document.getElementById('manualCaptchaHelp');
const mapPaneStage = document.getElementById('mapPaneStage');
const mapPaneZoom = document.getElementById('mapPaneZoom');
const mapPaneZoomValue = document.getElementById('mapPaneZoomValue');
const mapPaneCoords = document.getElementById('mapPaneCoords');
const mapPaneBadge = document.getElementById('mapPaneBadge');
const mapPaneCols = document.getElementById('mapPaneCols');
const mapPaneAssemble = document.getElementById('mapPaneAssemble');
const mapPaneRotateAll = document.getElementById('mapPaneRotateAll');
const mapPaneSave = document.getElementById('mapPaneSave');
let latestMapData = {};
let activeMapId = null;
let mapPartRotations = {};
let mapWholeRotation = 0;
let latestManualWindow = null;
let mapSelectedCell = null;
let currentMapCanvas = null;
// Object.keys() sorts integer-like keys numerically, so the real arrival order
// has to be remembered separately or the parts get laid out scrambled.
let mapArrivalOrder = [];

function noteMapArrival(maps) {
    if (!maps || Object.keys(maps).length === 0) {
        mapArrivalOrder = [];
        return;
    }
    for (const id of Object.keys(maps)) {
        if (maps[id] && !mapArrivalOrder.includes(id)) mapArrivalOrder.push(id);
    }
}

// Slot order in the captcha window is the layout the server intends; anything
// missing from it is appended in arrival order.
function orderedMapIds(window) {
    const ids = [];
    for (const item of (window?.slots || [])) {
        if (item && item.mapId !== null && item.mapId !== undefined) {
            const id = String(item.mapId);
            if (!ids.includes(id) && latestMapData[id]) ids.push(id);
        }
    }
    for (const id of mapArrivalOrder) {
        if (!ids.includes(id) && latestMapData[id]) ids.push(id);
    }
    return ids;
}
const MANUAL_MAP_PALETTE = [
    0x000000, 0x7FB238, 0xF7E9A3, 0xC7C7C7, 0xFF0000, 0xA0A0FF, 0xA7A7A7, 0x007C00,
    0xFFFFFF, 0xA4A8B8, 0x976D4D, 0x707070, 0x4040FF, 0x8F7748, 0xFFFCF5, 0xD87F33,
    0xB24CD8, 0x6699D8, 0xE5E533, 0x7FCC19, 0xF27FA5, 0x4C4C4C, 0x999999, 0x4C7F99,
    0x7F3FB2, 0x334CB2, 0x664C33, 0x667F33, 0x993333, 0x191919, 0xFAEE4D, 0x5CDBD5,
    0x4A80FF, 0x00D93A, 0x815631, 0x700200, 0xD1B1A1, 0x9F5224, 0x95576C, 0x706C8A,
    0xBA8524, 0x677535, 0xA04D4E, 0x392923, 0x876B62, 0x575C5C, 0x7A4958, 0x4C3E5C,
    0x4C3223, 0x4C522A, 0x8E3C2E, 0x251610, 0xBD3031, 0x943F61, 0x5C191D, 0x167E86,
    0x3A8E8C, 0x562C3E, 0x14B485, 0x646464, 0xD8AF93, 0x7FA796, 0xA2A2A2, 0xB8B8B8
];


const chatToggleBtn = document.getElementById('chatToggleBtn');
if (manualCaptchaSlots) {
    manualCaptchaSlots.addEventListener('click', (event) => {
        const slotButton = event.target instanceof Element
            ? event.target.closest('[data-captcha-slot]')
            : null;
        if (!slotButton || !currentBot) return;
        socket.emit('botAction', {
            username: currentBot,
            action: 'captchaWindowClick',
            payload: {
                windowId: Number(slotButton.dataset.windowId),
                slot: Number(slotButton.dataset.captchaSlot),
                button: 0
            }
        });
    });
}

if (chatToggleBtn) {
    chatToggleBtn.onclick = () => {
        chatVisible = !chatVisible;
        chatToggleBtn.title = chatVisible ? 'Hide Chat' : 'Show Chat';

        if (chatVisible) {
            chatToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        } else {
            chatToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a22.19 22.19 0 0 1 1.63-2.17M9.91 4.39A10.29 10.29 0 0 1 12 4c7 0 10 7 10 7a20.44 20.44 0 0 1-2.14 2.86"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        }

        const chatContainer = document.querySelector('.chat-container');
        if (chatContainer) chatContainer.style.display = chatVisible ? '' : 'none';
    };
}

const keyMap = {
    'w': 'forward',
    's': 'back',
    'a': 'left',
    'd': 'right',
    ' ': 'jump',
    'shift': 'sneak',
    'control': 'sprint'
};

function isTyping() {
    const el = document.activeElement;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

const botList = document.getElementById('botList');
const connectionStatus = document.getElementById('connectionStatus');
const viewerContainer = document.getElementById('viewerContainer');
const inventoryGridEl = document.getElementById('inventoryGrid');
let chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const loadingOverlay = document.getElementById('loadingOverlay');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const healthVal = document.getElementById('healthVal');
const foodVal = document.getElementById('foodVal');
const posVal = document.getElementById('posVal');

const yawSlider = document.getElementById('yawSlider');
const yawVal = document.getElementById('yawVal');
const pitchSlider = document.getElementById('pitchSlider');
const pitchVal = document.getElementById('pitchVal');

const spammerList = document.getElementById('spammerList');
const addSpamMsgBtn = document.getElementById('addSpamMsgBtn');
const spammerDelay = document.getElementById('spammerDelay');
const spammerOrder = document.getElementById('spammerOrder');
const spammerBtn = document.getElementById('spammerBtn');
const spammerAppend = document.getElementById('spammerAppend');
const spammerLen = document.getElementById('spammerLen');

const autoReconnectBtn = document.getElementById('autoReconnectBtn');
const autoAuthBtn = document.getElementById('autoAuthBtn');
const antiAfkBtn = document.getElementById('antiAfkBtn');
const killauraBtn = document.getElementById('killauraBtn');

const suicideBtn = document.getElementById('suicideBtn');
const respawnBtn = document.getElementById('respawnBtn');
const rejoinBtn = document.getElementById('rejoinBtn');
const viewModeBtn = document.getElementById('viewModeBtn');


const addBotModal = document.getElementById('addBotModal');
const editBotModal = document.getElementById('editBotModal');
const addBotBtn = document.getElementById('addBotBtn');
const cancelAddBot = document.getElementById('cancelAddBot');
const cancelEditBot = document.getElementById('cancelEditBot');
const addBotForm = document.getElementById('addBotForm');
const editBotForm = document.getElementById('editBotForm');
const chatForm = document.getElementById('chatForm');

const bulkGenerateModal = document.getElementById('bulkGenerateModal');
const bulkGenerateBtn = document.getElementById('bulkGenerateBtn');
const cancelBulkGenerate = document.getElementById('cancelBulkGenerate');
const bulkGenerateForm = document.getElementById('bulkGenerateForm');
const bulkPluginsList = document.getElementById('bulkPluginsList');

let chatInputHistory = [];
let chatInputHistoryIndex = -1;

if (chatForm) {
    chatForm.onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (text && currentBot) {
            socket.emit('botAction', { username: currentBot, action: 'chat', payload: { message: text } });


            if (chatInputHistory[0] !== text) {
                chatInputHistory.unshift(text);
                if (chatInputHistory.length > 10) chatInputHistory.pop();
            }
            chatInputHistoryIndex = -1;

            input.value = '';
        } else if (!currentBot) {
            showNotification('Select a bot to chat', 'warning');
        }
    };
}

if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (chatInputHistory.length > 0) {
                if (chatInputHistoryIndex < chatInputHistory.length - 1) {
                    chatInputHistoryIndex++;
                    chatInput.value = chatInputHistory[chatInputHistoryIndex];
                }
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (chatInputHistoryIndex > 0) {
                chatInputHistoryIndex--;
                chatInput.value = chatInputHistory[chatInputHistoryIndex];
            } else if (chatInputHistoryIndex === 0) {
                chatInputHistoryIndex = -1;
                chatInput.value = '';
            }
        }
    });
}

const closeSelectionTip = document.getElementById('closeSelectionTip');
const selectionTip = document.getElementById('selectionTip');
if (closeSelectionTip && selectionTip) {
    closeSelectionTip.onclick = () => {
        selectionTip.style.display = 'none';
        localStorage.setItem('hideSelectionTip', 'true');
    };
    if (localStorage.getItem('hideSelectionTip') === 'true') {
        selectionTip.style.display = 'none';
    }
}


const notificationContainer = document.createElement('div');
notificationContainer.className = 'notification-container';
document.body.appendChild(notificationContainer);

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.innerText = message;
    notificationContainer.appendChild(notif);

    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transform = 'translateY(10px)';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

socket.on('connect', () => {
    if (connectionStatus) {
        connectionStatus.style.background = '#22c55e';
        connectionStatus.title = 'Connected to Server';
    }
    if (loadingOverlay) loadingOverlay.classList.remove('active');
});

window.toggleDiscordFields = (val, prefix = '') => {
    const webhookGroup = document.getElementById(prefix ? `${prefix}DiscordWebhookFields` : 'discordWebhookFields');
    const botGroup = document.getElementById(prefix ? `${prefix}DiscordBotFields` : 'discordBotFields');
    if (webhookGroup) webhookGroup.style.display = val === 'webhook' ? 'block' : 'none';
    if (botGroup) botGroup.style.display = val === 'bot' ? 'block' : 'none';

    // Update the other modal if it exists to keep them in sync or just for safety
    const otherPrefix = prefix === 'add' ? '' : 'add';
    const otherWebhookGroup = document.getElementById(otherPrefix ? `${otherPrefix}DiscordWebhookFields` : 'discordWebhookFields');
    const otherBotGroup = document.getElementById(otherPrefix ? `${otherPrefix}DiscordBotFields` : 'discordBotFields');
};

socket.on('disconnect', () => {
    if (connectionStatus) {
        connectionStatus.style.background = '#ef4444';
        connectionStatus.title = 'Disconnected';
    }
    if (loadingOverlay) loadingOverlay.classList.add('active');
});

let selectedBots = new Set();

socket.on('botList', (data) => {
    botList.innerHTML = '';
    data.forEach(bot => {
        bots.set(bot.username, bot);
        const item = document.createElement('div');
        item.className = `bot-item compact ${currentBot === bot.username ? 'active' : ''}`;

        if (selectedBots.has(bot.username)) {
            item.classList.add('selected');
        }

        item.onclick = (e) => {
            if (!e.target.closest('.btn-icon') && !e.target.closest('.bot-avatar')) {
                if (e.ctrlKey || e.metaKey) {
                    // Toggle selection with Ctrl/Meta key
                    if (selectedBots.has(bot.username)) {
                        selectedBots.delete(bot.username);
                        item.classList.remove('selected');
                    } else {
                        selectedBots.add(bot.username);
                        item.classList.add('selected');
                    }
                    updateSelectedCount();
                }

                // Always switch view on item click (if not an icon/avatar)
                selectBot(bot.username);
            }
        };

        const normalizedStatus = String(bot.status || '').toLowerCase();
        const statusClass = normalizedStatus === 'online'
            ? 'online'
            : (normalizedStatus === 'offline' || normalizedStatus === 'disconnected' ? 'offline' : 'connecting');

        item.innerHTML = '';

        const avatar = document.createElement('div');
        avatar.className = 'bot-avatar small';
        avatar.style.backgroundImage = `url('https://mc-heads.net/avatar/${bot.username}')`;
        avatar.title = 'Click to select for bulk actions';
        avatar.onclick = (e) => {
            e.stopPropagation();
            if (selectedBots.has(bot.username)) {
                selectedBots.delete(bot.username);
                item.classList.remove('selected');
            } else {
                selectedBots.add(bot.username);
                item.classList.add('selected');
            }
            updateSelectedCount();
        };
        item.appendChild(avatar);

        const name = document.createElement('div');
        name.className = 'bot-name';
        name.style.cssText = 'flex: 1; margin: 0 8px; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; display: flex; align-items: center; gap: 6px;';
        name.innerText = bot.username;
        item.appendChild(name);
        item.appendChild(name);

        const dot = document.createElement('div');
        dot.className = `status-dot ${statusClass}`;
        dot.style.marginRight = '8px';
        item.appendChild(dot);

        const actionGroup = document.createElement('div');
        actionGroup.style.display = 'flex';
        actionGroup.style.gap = '4px';
        actionGroup.innerHTML = `
            <button class="btn-icon small" data-action="edit" title="Edit Bot">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-icon small delete" data-action="delete-item" title="Delete Bot">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `;
        item.appendChild(actionGroup);

        const editBtn = item.querySelector('[data-action="edit"]');
        editBtn.onclick = (e) => {
            e.stopPropagation();
            openEditModal(bot);
        };

        const delBtn = item.querySelector('[data-action="delete-item"]');
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Permanently DELETE ${bot.username}?`)) {
                socket.emit('botAction', { username: bot.username, action: 'delete' });
            }
        };

        botList.appendChild(item);
    });

    updateSelectedCount();

    if (!currentBot && data.length > 0) {
        selectBot(data[0].username);
    } else if (currentBot) {
        const bot = bots.get(currentBot);
        if (bot && viewModeBtn) {
            viewModeBtn.innerText = bot.config.firstPerson ? 'Third Person' : 'First Person';
        }
    }
});

function updateSelectedCount() {
    const el = document.getElementById('selectedCount');
    if (el) el.innerText = selectedBots.size;
}

const searchInputBox = document.getElementById('botSearchInput');
if (searchInputBox) {
    searchInputBox.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const items = botList.querySelectorAll('.bot-item');
        items.forEach(item => {
            const nameEl = item.querySelector('.bot-name');
            if (nameEl) {
                const name = nameEl.innerText.toLowerCase();
                item.style.display = name.includes(query) ? 'flex' : 'none';
            }
        });
    });
}

socket.on('logs', (payload) => {
    if (!payload.username) return;
    const targetBox = getChatBox(payload.username);
    if (!chatVisible) return;
    const { message, type } = payload;

    const div = document.createElement('div');
    div.className = `chat-message ${type}`;

    const time = new Date().toLocaleTimeString();

    const timeSpan = document.createElement('span');
    timeSpan.style.opacity = '0.5';
    timeSpan.style.fontSize = '0.8em';
    timeSpan.innerText = `[${time}] `;

    div.appendChild(timeSpan);

    const formattedMessage = document.createElement('span');
    formattedMessage.innerHTML = formatChat(message);
    div.appendChild(formattedMessage);

    targetBox.appendChild(div);
    const isAtBottom = (targetBox.scrollHeight - targetBox.scrollTop - targetBox.clientHeight) < 50;
    if (isAtBottom) {
        targetBox.scrollTop = targetBox.scrollHeight;
    }
});

let chatBoxes = new Map();
chatBoxes.set('default', chatBox);

function getChatBox(username) {
    if (!username) return chatBox;
    if (!chatBoxes.has(username)) {
        const box = document.createElement('div');
        box.className = 'chat-box';
        box.id = `chatBox_${username}`;
        box.style.display = 'none';
        
        const welcome = document.createElement('div');
        welcome.className = 'chat-message info';
        welcome.innerText = `Chat interface for ${username}`;
        box.appendChild(welcome);

        const container = document.querySelector('.chat-container');
        if (container) container.appendChild(box);
        
        chatBoxes.set(username, box);
    }
    return chatBoxes.get(username);
}


function formatMinecraftText(text) {
    if (!text) return '';

    const colorMap = {
        '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
        '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
        '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
        'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
    };

    const styleMap = {
        'l': 'font-weight:bold;',
        'm': 'text-decoration:line-through;',
        'n': 'text-decoration:underline;',
        'o': 'font-style:italic;',
        'r': 'reset'
    };

    let html = '';
    let currentStyle = '';
    let currentColor = '';

    const parts = text.split(/В§([0-9a-fk-or])/g);

    if (parts[0]) {
        html += escapeHtml(parts[0]);
    }

    for (let i = 1; i < parts.length; i += 2) {
        const code = parts[i];
        const content = parts[i + 1];

        if (colorMap[code]) {
            currentColor = `color:${colorMap[code]};`;
            currentStyle = '';
        } else if (styleMap[code]) {
            if (code === 'r') {
                currentColor = '';
                currentStyle = '';
            } else {
                currentStyle += styleMap[code];
            }
        }

        if (content) {
            const style = `${currentColor}${currentStyle}`;
            if (style) {
                html += `<span style="${style}">${escapeHtml(content)}</span>`;
            } else {
                html += escapeHtml(content);
            }
        }
    }

    return html;
}

function ansiToHtml(text) {
    if (!text) return '';

    const ansiMap = {
        '30': '#000000', '31': '#AA0000', '32': '#00AA00', '33': '#FFAA00',
        '34': '#0000AA', '35': '#AA00AA', '36': '#00AAAA', '37': '#AAAAAA',
        '90': '#555555', '91': '#FF5555', '92': '#55FF55', '93': '#FFFF55',
        '94': '#5555FF', '95': '#FF55FF', '96': '#55FFFF', '97': '#FFFFFF',
        '40': 'background:#000000;', '41': 'background:#AA0000;', '42': 'background:#00AA00;', '43': 'background:#FFAA00;',
        '44': 'background:#0000AA;', '45': 'background:#AA00AA;', '46': 'background:#00AAAA;', '47': 'background:#AAAAAA;'
    };

    const styles = {
        '1': 'font-weight:bold;',
        '2': 'opacity:0.7;',
        '3': 'font-style:italic;',
        '4': 'text-decoration:underline;',
        '5': 'animation: blink 1s infinite;',
        '7': 'filter: invert(100%);',
        '8': 'opacity:0;',
        '9': 'text-decoration:line-through;'
    };

    let html = '';
    let currentColor = '';
    let currentBackground = '';
    let currentStyles = new Set();
    
    let currentHover = null;
    let currentClick = null;

    const parts = text.split(/([\u001b\x1b]\[[0-9;]*m|[\u001b\x1b]\]imc;.*?\x1b\\|[\u001b\x1b]\]imc;.*?\x07)/);

    for (const part of parts) {
        if (!part) continue;

        if (part.startsWith('\x1b[') || part.startsWith('\u001b[')) {
            const codes = part.substring(2, part.length - 1).split(';');
            for (const code of codes) {
                if (code === '0' || code === '') {
                    currentColor = '';
                    currentBackground = '';
                    currentStyles.clear();
                } else if (ansiMap[code]) {
                    if (code.startsWith('4')) currentBackground = ansiMap[code];
                    else currentColor = ansiMap[code];
                } else if (styles[code]) {
                    currentStyles.add(styles[code]);
                }
            }
        } else if (part.startsWith('\x1b]') || part.startsWith('\u001b]')) {
            const content = part.substring(2, part.length - 2);
            if (content.startsWith('imc;')) {
                const cmd = content.substring(4);
                if (cmd.startsWith('h:')) {
                    try {
                        currentHover = atob(cmd.substring(2));
                    } catch(e) {}
                } else if (cmd === 'h') {
                    currentHover = null;
                } else if (cmd.startsWith('c:')) {
                    try {
                        currentClick = atob(cmd.substring(2));
                    } catch(e) {}
                } else if (cmd === 'c') {
                    currentClick = null;
                }
            }
        } else {
            const styleArr = Array.from(currentStyles);
            if (currentColor) styleArr.push(`color:${currentColor};`);
            if (currentBackground) styleArr.push(currentBackground);

            let content = escapeHtml(part);
            let cls = [];
            let attrs = `style="${styleArr.join('')}"`;

            if (currentHover) {
                cls.push('mc-hover');
                const hoverHtml = ansiToHtml(currentHover);
                attrs += ` data-mc-hover="${encodeURIComponent(hoverHtml)}"`;
            }
            if (currentClick) {
                cls.push('mc-click');
                attrs += ` data-mc-click="${encodeURIComponent(currentClick)}"`;
            }

            if (cls.length > 0) {
                html += `<span class="${cls.join(' ')}" ${attrs}>${content}</span>`;
            } else if (styleArr.length > 0) {
                html += `<span ${attrs}>${content}</span>`;
            } else {
                html += content;
            }
        }
    }

    return html;
}

function formatChat(text) {
    if (!text) return '';
    let result = text;


    if (result.includes('\u001b') || result.includes('\x1b')) {
        result = ansiToHtml(result);



    } else {

        result = formatMinecraftText(result);
    }

    return result;
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

socket.on('botStatus', (payload) => {

    const { username, status } = payload;

    if (bots.has(username)) {
        const bot = bots.get(username);
        bot.status = status.toLowerCase();
        if (payload.inventoryPort) bot.inventoryPort = payload.inventoryPort;
    }


    const items = botList.querySelectorAll('.bot-item');
    items.forEach(item => {
        const nameEl = item.querySelector('.bot-name');
        if (nameEl && nameEl.innerText === username) {
            const dot = item.querySelector('.status-dot');
            if (dot) {
                dot.className = 'status-dot ' + status.toLowerCase();
            }
        }
    });


    if (currentBot === username) {
        document.getElementById('botStatus').innerText = status;
        document.getElementById('botStatus').className = `status-indicator ${status.toLowerCase()}`;

        const rejoinBtn = document.getElementById('rejoinBtn');
        if (rejoinBtn) {
            const lowStatus = status.toLowerCase();
            const isOffline = lowStatus === 'offline' || lowStatus === 'created';
            rejoinBtn.innerHTML = rejoinBtn.innerHTML.replace(isOffline ? 'Rejoin' : 'Join', isOffline ? 'Join' : 'Rejoin');
        }

        updateInventoryFrame();
    }
});

let lastBotDataUpdate = 0;
socket.on('botData', (payload) => {
    if (currentBot !== payload.username) return;
    const now = Date.now();

    // Throttle: 250ms normally, 1000ms in Low Performance Mode
    const throttle = lowPerformanceEnabled ? 1000 : 100;
    if (now - lastBotDataUpdate < throttle) return;

    lastBotDataUpdate = now;
    const data = payload.data;

    if (data.health !== undefined) {
        const healthStat = document.getElementById('healthStat');
        const healthBarFill = document.getElementById('healthBarFill');
        const roundedHealth = Math.round(data.health);
        if (healthStat) healthStat.innerText = roundedHealth;
        if (healthBarFill) healthBarFill.style.width = `${Math.min(100, Math.max(0, (data.health / 20) * 100))}%`;
    }
    if (data.food !== undefined) {
        const foodStat = document.getElementById('foodStat');
        const foodBarFill = document.getElementById('foodBarFill');
        const roundedFood = Math.round(data.food);
        if (foodStat) foodStat.innerText = roundedFood;
        if (foodBarFill) foodBarFill.style.width = `${Math.min(100, Math.max(0, (data.food / 20) * 100))}%`;
    }
    if (data.position) {
        const owPosStat = document.getElementById('owPosStat');
        const netherPosStat = document.getElementById('netherPosStat');
        const x = parseFloat(data.position.x);
        const y = parseFloat(data.position.y);
        const z = parseFloat(data.position.z);
        const dim = data.dimension || 'overworld';

        let owX, owY, owZ, nX, nY, nZ;

        if (dim.includes('nether')) {
            nX = x; nY = y; nZ = z;
            owX = x * 8; owY = y; owZ = z * 8;
        } else {
            owX = x; owY = y; owZ = z;
            nX = x / 8; nY = y; nZ = z / 8;
        }

        if (owPosStat) owPosStat.innerText = `${owX.toFixed(0)}, ${owY.toFixed(0)}, ${owZ.toFixed(0)}`;
        if (netherPosStat) netherPosStat.innerText = `${nX.toFixed(0)}, ${nY.toFixed(0)}, ${nZ.toFixed(0)}`;
    }
    if (data.yaw !== undefined && document.activeElement !== yawSlider) {
        const yawDeg = Math.round(data.yaw * 180 / Math.PI);
        yawSlider.value = yawDeg;
        if (yawVal) yawVal.innerText = yawDeg;
    }
    if (data.pitch !== undefined && document.activeElement !== pitchSlider) {
        const pitchDeg = Math.round(data.pitch * 180 / Math.PI);
        pitchSlider.value = pitchDeg;
        pitchVal.innerText = pitchDeg;
    }
});

function trim(num) {
    return Number(num).toFixed(2);
}

socket.on('botPlayers', (payload) => {
    if (currentBot !== payload.username) return;
    renderPlayerList(payload.players || []);
});

function renderPlayerList(players) {
    const playerList = document.getElementById('playerList');
    const playerCount = document.getElementById('playerCount');

    if (playerCount) playerCount.innerText = players.length;
    if (!playerList) return;


    const existingEls = new Map();
    playerList.querySelectorAll('.player-item').forEach(el => {
        existingEls.set(el.dataset.username, el);
    });

    const activeUsernames = new Set();

    players.forEach(p => {
        activeUsernames.add(p.username);
        let el = existingEls.get(p.username);

        if (el) {

            const pingEl = el.querySelector('.ping-text');
            if (pingEl && pingEl.innerText !== `${p.ping}ms`) {
                pingEl.innerText = `${p.ping}ms`;
                let pingColor = '#22c55e';
                if (p.ping > 150) pingColor = '#fbbf24';
                if (p.ping > 300) pingColor = '#ef4444';
                pingEl.style.color = pingColor;
            }
        } else {

            el = document.createElement('div');
            el.className = 'player-item';
            el.dataset.username = p.username;
            el.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px; animate: fadeIn 0.2s;';
            let pingColor = '#22c55e';
            if (p.ping > 150) pingColor = '#fbbf24';
            if (p.ping > 300) pingColor = '#ef4444';
            el.innerHTML = `
                <span style="flex:1;">${p.username}</span>
                <span class="ping-text" style="color:${pingColor}; font-size:0.8rem;">${p.ping}ms</span>
            `;
            playerList.appendChild(el);
        }
    });


    existingEls.forEach((el, username) => {
        if (!activeUsernames.has(username)) {
            el.remove();
        }
    });
}

let lastSpammerConfigStr = '';

socket.on('spammerConfig', (payload) => {
    if (currentBot !== payload.username) return;
    const config = payload.config;

    if (config) {

        const currentConfigStr = JSON.stringify(config);
        if (currentConfigStr === lastSpammerConfigStr) return;
        lastSpammerConfigStr = currentConfigStr;

        spammerList.innerHTML = '';
        if (config.messages && config.messages.length > 0) {
            config.messages.forEach(msg => addSpammerInput(msg));
        } else {
            addSpammerInput('ImperialsBot OP');
        }

        if (document.activeElement !== spammerDelay) {
            if (config.delay) spammerDelay.value = config.delay;
        }
        if (document.activeElement !== spammerOrder) {
            if (config.order) spammerOrder.value = config.order;
        }
        if (config.appendRandom !== undefined) {
            spammerAppend.checked = config.appendRandom;
        }
        if (document.activeElement !== spammerLen) {
            if (config.randomLength) spammerLen.value = config.randomLength;
        }
    }
});

socket.on('pluginList', (payload) => {
    if (currentBot !== payload.username) return;
    renderPlugins(payload.plugins || []);
});

function renderPlugins(plugins) {
    const pluginsList = document.getElementById('pluginsList');
    if (!pluginsList) return;
    pluginsList.innerHTML = '';

    if (plugins.length === 0) {
        pluginsList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem;">No plugins loaded</div>';
        return;
    }

    plugins.forEach(plugin => {
        const item = document.createElement('div');
        item.className = 'plugin-item';

        const isEnabled = plugin.enabled;
        const hasError = plugin.hasError;
        const hasSettings = plugin.settings && Object.keys(plugin.settings).length > 0;

        let settingsBtnHtml = '';
        if (hasSettings) {
            settingsBtnHtml = `
                <button class="btn compact" style="padding: 4px 8px; margin-right: 8px; background: rgba(148, 163, 184, 0.1); border: 1px solid var(--text-muted); color: var(--text-muted); display: flex; align-items: center; justify-content: center;" onclick="openPluginSettings('${plugin.name}', '${encodeURIComponent(JSON.stringify(plugin.settings))}', '${encodeURIComponent(JSON.stringify(plugin.config || {}))}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </button>
            `;
        }

        item.innerHTML = `
            <div class="plugin-info">
                <div class="plugin-name">${plugin.name}</div>
                <div class="plugin-desc">${plugin.description}</div>
            </div>
            <div style="display: flex; align-items: center;">
                ${settingsBtnHtml}
                <label class="switch">
                    <input type="checkbox" ${isEnabled ? 'checked' : ''} ${hasError ? 'disabled' : ''} 
                        onchange="togglePlugin('${plugin.name}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
        `;
        pluginsList.appendChild(item);
    });
}

window.togglePlugin = (name, enabled) => {
    if (!currentBot) return;
    socket.emit('botAction', {
        username: currentBot,
        action: 'togglePlugin',
        payload: { pluginName: name, enabled }
    });
};

window.openPluginSettings = (name, settingsJson, configJson) => {
    const settings = JSON.parse(decodeURIComponent(settingsJson));
    const config = JSON.parse(decodeURIComponent(configJson));

    const titleEl = document.getElementById('pluginSettingsTitle');
    if (titleEl) titleEl.innerText = `${name} Settings`;

    const nameEl = document.getElementById('pluginSettingsName');
    if (nameEl) nameEl.value = name;

    const container = document.getElementById('pluginSettingsContainer');
    if (!container) return;
    container.innerHTML = '';
    container.style.marginTop = '20px'; // Space from heading

    for (const [key, schema] of Object.entries(settings)) {
        const val = config[key] !== undefined ? config[key] : (schema.value !== undefined ? schema.value : (schema.default !== undefined ? schema.default : ''));

        const group = document.createElement('div');
        group.className = 'form-group';
        group.style.background = 'rgba(0,0,0,0.15)';
        group.style.padding = '12px';
        group.style.borderRadius = '8px';
        group.style.marginBottom = '8px';
        group.style.border = '1px solid rgba(255,255,255,0.05)';

        const labelText = schema.label || key;

        if (schema.type === 'select') {
            const label = document.createElement('label');
            label.innerText = labelText;
            label.style.marginBottom = '8px';
            label.style.display = 'block';
            label.style.fontSize = '0.85rem';
            label.style.color = 'var(--text-muted)';
            group.appendChild(label);

            const select = document.createElement('select');
            select.name = key;
            const options = Array.isArray(schema.options) ? schema.options : [];
            // A value that no longer exists must still be visible, otherwise the
            // saved setting silently resets to the first option.
            const known = options.some(option => String(option.value) === String(val));
            if (!known && val !== undefined && val !== null && val !== '') {
                const legacy = document.createElement('option');
                legacy.value = val;
                legacy.textContent = `${val} (нет в списке)`;
                select.appendChild(legacy);
            }
            for (const option of options) {
                const node = document.createElement('option');
                node.value = option.value;
                node.textContent = option.label ?? option.value;
                select.appendChild(node);
            }
            select.value = val;
            select.style.width = '100%';
            select.style.padding = '8px';
            select.style.background = 'rgba(0,0,0,0.2)';
            select.style.border = '1px solid var(--glass-border)';
            select.style.color = 'var(--text-main)';
            select.style.borderRadius = '6px';
            group.appendChild(select);
        } else if (schema.type === 'boolean') {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.width = '100%';

            const label = document.createElement('label');
            label.innerText = labelText;
            label.style.margin = '0';
            label.style.fontSize = '0.9rem';
            label.style.color = 'var(--text-main)';
            row.appendChild(label);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = key;
            checkbox.checked = !!val;
            checkbox.style.width = '18px';
            checkbox.style.height = '18px';
            checkbox.style.cursor = 'pointer';
            row.appendChild(checkbox);

            group.appendChild(row);
        } else {
            const label = document.createElement('label');
            label.innerText = labelText;
            label.style.marginBottom = '8px';
            label.style.display = 'block';
            label.style.fontSize = '0.85rem';
            label.style.color = 'var(--text-muted)';
            group.appendChild(label);

            const input = document.createElement('input');
            input.type = schema.type === 'number' ? 'number' : 'text';
            input.name = key;
            input.value = val;
            input.style.width = '100%';
            input.style.padding = '8px';
            input.style.background = 'rgba(0,0,0,0.2)';
            input.style.border = '1px solid var(--glass-border)';
            input.style.borderRadius = '4px';
            input.style.color = 'white';
            group.appendChild(input);
        }

        container.appendChild(group);
    }

    const modal = document.getElementById('pluginSettingsModal');
    if (modal) modal.classList.add('active');
};

const closePluginSettingsBtn = document.getElementById('closePluginSettingsBtn');
if (closePluginSettingsBtn) {
    closePluginSettingsBtn.onclick = () => {
        document.getElementById('pluginSettingsModal').classList.remove('active');
    };
}

const pluginSettingsForm = document.getElementById('pluginSettingsForm');
if (pluginSettingsForm) {
    pluginSettingsForm.onsubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(pluginSettingsForm);
        const name = formData.get('pluginName');
        const config = {};

        const container = document.getElementById('pluginSettingsContainer');
        // <select> is included because plugin settings can be dropdowns now, and the
        // old input-only query silently dropped them on save.
        container.querySelectorAll('input, select').forEach(input => {
            if (input.type === 'checkbox') {
                config[input.name] = input.checked;
            } else if (input.type === 'number') {
                config[input.name] = parseFloat(input.value) || 0;
            } else {
                config[input.name] = input.value;
            }
        });

        socket.emit('botAction', {
            username: currentBot,
            action: 'updatePluginConfig',
            payload: { pluginName: name, config }
        });

        document.getElementById('pluginSettingsModal').classList.remove('active');
        showNotification(`${name} settings applied`, 'success');
    };
}

socket.on('notification', (data) => {
    console.log('Notification:', data);
    showNotification(data.message, data.type);
});

function selectBot(username) {
    currentBot = username;
    currentManualWindowId = null;
    if (manualCaptchaPanel) manualCaptchaPanel.hidden = true;
    if (manualCaptchaMaps) manualCaptchaMaps.replaceChildren();
    if (manualCaptchaSlots) manualCaptchaSlots.replaceChildren();
    lastSpammerConfigStr = '';

    // Emit selection to server to join specific room
    socket.emit('selectBot', username);

    // Clear dashboard data for a clean switch
    analyticsData = {};
    if (typeof renderPlugins === 'function') renderPlugins([]);

    const playerList = document.getElementById('playerList');
    if (playerList) playerList.innerHTML = '';

    const healthStat = document.getElementById('healthStat');
    if (healthStat) healthStat.innerText = '0';
    const healthBarFill = document.getElementById('healthBarFill');
    if (healthBarFill) healthBarFill.style.width = '0%';

    const foodStat = document.getElementById('foodStat');
    if (foodStat) foodStat.innerText = '0';
    const foodBarFill = document.getElementById('foodBarFill');
    if (foodBarFill) foodBarFill.style.width = '0%';

    const owPosStat = document.getElementById('owPosStat');
    if (owPosStat) owPosStat.innerText = '0, 0, 0';
    const netherPosStat = document.getElementById('netherPosStat');
    if (netherPosStat) netherPosStat.innerText = '0, 0, 0';

    document.querySelectorAll('.bot-item').forEach(el => {
        if (el.innerText.includes(username)) el.classList.add('active');
        else el.classList.remove('active');
    });

    // Hide all chat boxes
    document.querySelectorAll('.chat-box').forEach(cb => {
        cb.style.display = 'none';
    });

    chatBox = getChatBox(username);
    if (chatBox) {
        chatBox.style.display = 'block';
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    const botNameHeader = document.getElementById('currentBotName');
    if (botNameHeader) botNameHeader.innerText = username;

    socket.emit('requestBotData', { username });
    socket.emit('requestManualWindow', username);
    socket.emit('requestAnalyticsHistory', { username });

    const resetBtn = (btn, label) => {
        if (!btn) return;
    };
    resetBtn(autoReconnectBtn, 'Auto-Reconnect');
    resetBtn(autoAuthBtn, 'AutoAuth');
    resetBtn(antiAfkBtn, 'Anti-AFK');
    resetBtn(killauraBtn, 'Killaura');
    resetBtn(document.getElementById('autoEatBtn'), 'AutoEat');
    resetBtn(spammerBtn, 'Spammer');
    const kaSettings = document.getElementById('killauraSettings');
    if (kaSettings) kaSettings.style.display = 'none';

    updateInventoryFrame();

    viewerContainer.innerHTML = '<div class="placeholder">Viewer Offline</div>';
}

function updateInventoryFrame() {
    const iframe = document.getElementById('inventoryIframe');
    const placeholder = document.getElementById('inventoryPlaceholder');
    const bot = bots.get(currentBot);
    if (!bot) return;
    const status = (bot.status || '').toLowerCase();
    const isOnline = status === 'online' || status.includes('error');

    if (bot && isOnline && bot.inventoryPort) {
        const url = `/inventory/${bot.inventoryPort}/`;
        if (iframe.src !== url) iframe.src = url;
        iframe.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        iframe.style.display = 'none';
        iframe.src = '';
        placeholder.style.display = 'flex';
        if (!bot) {
            placeholder.innerText = 'Select a bot to view inventory';
        } else if (!isOnline) {
            placeholder.innerText = 'Bot is offline';
        } else {
            placeholder.innerText = 'Inventory loading...';
        }
    }
}

/* Mini browser integration: prefer Socket.io events and fall back to the HTTP endpoint
   when the running server does not expose the browser events. */
const browserForm = document.getElementById('browserForm');
const browserUrl = document.getElementById('browserUrl');
const browserProfile = document.getElementById('browserProfile');
const browserOpenBtn = document.getElementById('browserOpenBtn');
const browserSession = document.getElementById('browserSession');
const browserSessionText = document.getElementById('browserSessionText');
const browserError = document.getElementById('browserError');
const browserViewport = document.getElementById('browserViewport');
const browserFrame = document.getElementById('browserFrame');
const browserToolbar = document.getElementById('browserToolbar');
const browserBack = document.getElementById('browserBack');
const browserForward = document.getElementById('browserForward');
const browserReload = document.getElementById('browserReload');
let browserSessionEndsAt = 0;
let browserSessionTimer = null;
let browserScreenTimer = null;
let browserFallbackTimer = null;
let browserRequestId = 0;
let browserProfilesInitialized = false;
let browserSessionId = null;
let browserSessionUsesEngine = false;
let browserScreen = null;
let browserScreenBusy = false;
let browserScreenObjectUrl = null;
let browserSessionProfile = '';

function setBrowserState(state, text) {
    if (!browserSession || !browserSessionText) return;
    browserSession.dataset.state = state;
    browserSessionText.innerText = text;
}

function setBrowserError(message = '') {
    if (!browserError) return;
    browserError.innerText = message;
}

function clearBrowserSessionView() {
    stopBrowserScreenTimer();
    stopBrowserSessionTimer();
    browserSessionId = null;
    browserSessionUsesEngine = false;
    if (browserViewport) browserViewport.hidden = true;
    if (browserToolbar) browserToolbar.hidden = true;
    if (browserFrame) browserFrame.src = 'about:blank';
    setBrowserState('idle', 'Session expired');
}

function stopBrowserSessionTimer() {
    if (browserSessionTimer) {
        clearInterval(browserSessionTimer);
        browserSessionTimer = null;
    }
}

function stopBrowserScreenTimer() {
    if (browserScreenTimer) {
        clearInterval(browserScreenTimer);
        browserScreenTimer = null;
    }
    browserScreenBusy = false;
}

function getBrowserSessionUrl(payload = {}) {
    const sessionPayload = payload && (payload.session || payload.data) || payload;
    return sessionPayload?.url || sessionPayload?.sessionUrl || sessionPayload?.session_url || '';
}

function browserSessionIdFromUrl(sessionUrl) {
    try {
        const pathname = new URL(sessionUrl, window.location.origin).pathname;
        const match = pathname.match(/\/browser\/session\/([^/]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    } catch {
        return null;
    }
}

function setBrowserSessionAddress(url) {
    if (!browserUrl || document.activeElement === browserUrl || !url) return;
    if (/^https?:\/\//i.test(url)) browserUrl.value = url;
}

async function refreshBrowserScreen() {
    if (!browserSessionId || !browserScreen || browserScreenBusy) return;
    browserScreenBusy = true;
    try {
        const response = await fetch(
            `/browser/session/${encodeURIComponent(browserSessionId)}/screenshot?t=${Date.now()}`,
            { cache: 'no-store', credentials: 'include' }
        );
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error || `Screen update failed (${response.status})`);
        }
        const imageBlob = await response.blob();
        const nextObjectUrl = URL.createObjectURL(imageBlob);
        const previousObjectUrl = browserScreenObjectUrl;
        browserScreen.onload = () => {
            if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
        };
        browserScreen.src = nextObjectUrl;
        browserScreenObjectUrl = nextObjectUrl;
    } catch (error) {
        if (browserSession && browserSession.dataset.state === 'active') {
            setBrowserError(error.message || 'Could not update the browser screen.');
        }
    } finally {
        browserScreenBusy = false;
    }
}

async function sendBrowserAction(action, detail = {}) {
    // Silently returning here is what made the toolbar buttons feel dead:
    // nothing was sent, nothing was said, nothing changed on screen.
    if (!browserSessionId || !browserSessionUsesEngine) {
        setBrowserError('No active browser session. Re-open it from the bot panel.');
        return;
    }
    try {
        const response = await fetch(
            `/browser/session/${encodeURIComponent(browserSessionId)}/action`,
            {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...detail })
            }
        );
        const result = await response.json().catch(() => ({}));
        if (response.status === 410) {
            // The session is gone server side. Say so and drop the dead
            // panel, otherwise every button keeps failing with no reason.
            setBrowserError('Browser session expired. Re-open it from the bot panel.');
            clearBrowserSessionView();
            return;
        }
        if (!response.ok) throw new Error(result.error || `Browser action failed (${response.status})`);
        setBrowserSessionAddress(result.url);
        if (result.expiresAt) browserSessionEndsAt = Number(result.expiresAt);
        setBrowserError('');
        await refreshBrowserScreen();
    } catch (error) {
        setBrowserError(error.message || 'Browser action failed.');
    }
}

async function navigateBrowserSession(url) {
    if (!browserSessionId || !browserSessionUsesEngine) return false;
    try {
        const response = await fetch(
            `/browser/session/${encodeURIComponent(browserSessionId)}/navigate`,
            {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Navigation failed (${response.status})`);
        setBrowserSessionAddress(result.url || url);
        if (result.expiresAt) browserSessionEndsAt = Number(result.expiresAt);
        setBrowserError('');
        await refreshBrowserScreen();
        return true;
    } catch (error) {
        setBrowserError(error.message || 'Navigation failed.');
        return false;
    }
}

function installBrowserScreenInteractions() {
    if (!browserViewport || !browserScreen) return;
    browserViewport.tabIndex = 0;
    browserViewport.dataset.interactive = 'true';

    browserScreen.addEventListener('click', event => {
        const bounds = browserScreen.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const scaleX = browserScreen.naturalWidth / bounds.width;
        const scaleY = browserScreen.naturalHeight / bounds.height;
        browserViewport.focus({ preventScroll: true });
        sendBrowserAction('click', {
            x: Math.round((event.clientX - bounds.left) * scaleX),
            y: Math.round((event.clientY - bounds.top) * scaleY)
        });
    });

    browserScreen.addEventListener('wheel', event => {
        event.preventDefault();
        sendBrowserAction('scroll', {
            deltaX: Math.round(event.deltaX),
            deltaY: Math.round(event.deltaY)
        });
    }, { passive: false });

    browserViewport.onkeydown = event => {
        if (event.altKey || event.metaKey) return;
        let keyName = '';
        if (event.ctrlKey && event.key.toLowerCase() === 'a') keyName = 'CTRL+A';
        else if (event.key.length === 1 && !event.ctrlKey) {
            event.preventDefault();
            sendBrowserAction('type', { text: event.key });
            return;
        } else {
            const keys = {
                Enter: 'ENTER',
                Tab: 'TAB',
                Escape: 'ESCAPE',
                Backspace: 'BACKSPACE',
                Delete: 'DELETE',
                ArrowUp: 'ARROWUP',
                ArrowDown: 'ARROWDOWN',
                ArrowLeft: 'ARROWLEFT',
                ArrowRight: 'ARROWRIGHT',
                ' ': 'SPACE',
                Home: 'HOME',
                End: 'END',
                PageUp: 'PAGEUP',
                PageDown: 'PAGEDOWN'
            };
            keyName = keys[event.key] || '';
        }
        if (keyName) {
            event.preventDefault();
            sendBrowserAction('key', { key: keyName });
        }
    };
}

async function refreshBrowserAddress() {
    if (!browserSessionId || !browserSessionUsesEngine) return;
    try {
        const response = await fetch(
            `/browser/session/${encodeURIComponent(browserSessionId)}/state`,
            { cache: 'no-store', credentials: 'include' }
        );
        if (!response.ok) return;
        const state = await response.json();
        setBrowserSessionAddress(state.url);
        if (state.expiresAt) browserSessionEndsAt = Number(state.expiresAt);
    } catch {
        // The next state poll or the screenshot request will surface a session error.
    }
}

function startBrowserSession(expiresAt, sessionUrl = '', usesEngine = false, currentUrl = '') {
    const parsedExpiry = Number(expiresAt);
    browserSessionEndsAt = Number.isFinite(parsedExpiry) && parsedExpiry > Date.now()
        ? parsedExpiry
        : Date.now() + 300000;

    browserSessionId = browserSessionIdFromUrl(sessionUrl);
    browserSessionUsesEngine = Boolean(usesEngine && browserSessionId);
    browserSessionProfile = browserProfile ? browserProfile.value : '';
    setBrowserSessionAddress(currentUrl);
    if (browserViewport) browserViewport.hidden = !sessionUrl;
    stopBrowserScreenTimer();

    if (browserSessionUsesEngine && browserViewport) {
        browserScreen = document.createElement('img');
        browserScreen.className = 'browser-screen';
        browserScreen.alt = 'Interactive Mini Browser screen. Click to interact, then type or use the arrow keys.';
        browserScreen.draggable = false;
        browserViewport.replaceChildren(browserScreen);
        if (browserToolbar) browserToolbar.hidden = false;
        installBrowserScreenInteractions();
        refreshBrowserScreen();
        let browserAddressTicks = 0;
        browserScreenTimer = setInterval(() => {
            refreshBrowserScreen();
            // The address changes only on navigation, but every poll for it
            // queues behind the screenshot on the driver's lock and makes the
            // whole engine feel slower. Once every 4th tick is plenty.
            if (++browserAddressTicks % 4 === 0) refreshBrowserAddress();
        }, 2000);
    } else if (sessionUrl && browserViewport) {
        if (browserToolbar) browserToolbar.hidden = true;
        browserScreen = null;
        browserViewport.dataset.interactive = 'false';
        const frame = document.createElement('iframe');
        frame.src = new URL(sessionUrl, window.location.origin).href;
        frame.title = 'Server browser';
        frame.referrerPolicy = 'no-referrer';
        browserViewport.replaceChildren(frame);
    }

    stopBrowserSessionTimer();
    const renderRemaining = () => {
        const remaining = Math.max(0, browserSessionEndsAt - Date.now());
        if (remaining === 0) {
            stopBrowserSessionTimer();
            stopBrowserScreenTimer();
            setBrowserState('idle', 'Session expired');
            if (browserFrame) browserFrame.src = 'about:blank';
            if (browserScreenObjectUrl) URL.revokeObjectURL(browserScreenObjectUrl);
            browserScreenObjectUrl = null;
            browserSessionId = null;
            browserSessionUsesEngine = false;
            if (browserToolbar) browserToolbar.hidden = true;
            if (browserViewport) browserViewport.hidden = true;
            return;
        }
        const totalSeconds = Math.ceil(remaining / 1000);
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        setBrowserState('active', `Session active В· ${minutes}:${seconds}`);
    };

    renderRemaining();
    browserSessionTimer = setInterval(renderRemaining, 1000);
}

function normalizeBrowserExpiry(payload) {
    const sessionPayload = payload && (payload.session || payload.data) || payload;
    if (!sessionPayload) return Date.now() + 300000;
    if (sessionPayload.expiresAt || sessionPayload.expires_at) {
        const raw = sessionPayload.expiresAt || sessionPayload.expires_at;
        const timestamp = typeof raw === 'string' && Number.isNaN(Number(raw))
            ? Date.parse(raw)
            : Number(raw);
        return timestamp > 100000000000 ? timestamp : Date.now() + timestamp * 1000;
    }
    const duration = Number(sessionPayload.expiresIn || sessionPayload.expires_in || sessionPayload.ttl || sessionPayload.duration);
    return Number.isFinite(duration) && duration > 0 ? Date.now() + duration * 1000 : Date.now() + 300000;
}

function handleBrowserStatus(payload = {}) {
    if (browserFallbackTimer) {
        clearTimeout(browserFallbackTimer);
        browserFallbackTimer = null;
    }

    const status = String(payload.status || payload.state || (payload.error ? 'error' : 'active')).toLowerCase();
    const errorMessage = payload.error || (payload.message && ['error', 'failed', 'offline'].includes(status) ? payload.message : '');

    if (errorMessage || ['error', 'failed', 'offline'].includes(status)) {
        browserOpenBtn.disabled = false;
        setBrowserState('error', 'Session unavailable');
        setBrowserError(String(errorMessage || 'The browser session could not be opened.'));
        return;
    }

    if (['opening', 'pending', 'connecting'].includes(status)) {
        setBrowserState('opening', 'Opening session');
        return;
    }

    browserOpenBtn.disabled = false;
    setBrowserError('');
    startBrowserSession(
        normalizeBrowserExpiry(payload),
        getBrowserSessionUrl(payload),
        Boolean(payload.engine),
        payload.currentUrl
    );
}

function browserPayload() {
    const profile = browserProfile ? browserProfile.value : '';
    const rawUrl = browserUrl ? browserUrl.value.trim() : '';
    const normalizedUrl = rawUrl && /^[a-z][a-z\d+\-.]*:\/\//i.test(rawUrl)
        ? rawUrl
        : rawUrl
            ? `https://${rawUrl}`
            : '';
    return {
        url: normalizedUrl,
        profile: profile || currentBot || null,
        username: profile || currentBot || null
    };
}

async function openBrowserOverHttp(payload, requestId) {
    try {
        const response = await fetch('/browser/open', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let result = {};
        try {
            result = await response.json();
        } catch (error) {
            result = {};
        }
        if (requestId !== browserRequestId) return;
        if (!response.ok) {
            throw new Error(result.error || result.message || `Browser request failed (${response.status})`);
        }
        handleBrowserStatus(result);
    } catch (error) {
        if (requestId !== browserRequestId) return;
        browserOpenBtn.disabled = false;
        setBrowserState('error', 'Session unavailable');
        setBrowserError(error.message || 'The browser session could not be opened.');
    }
}

function renderBrowserProfiles() {
    if (!browserProfile) return;
    const selectedValue = browserProfile.value || currentBot || '';
    browserProfile.innerHTML = '';

    const autoOption = document.createElement('option');
    autoOption.value = '';
    autoOption.innerText = currentBot ? `Current: ${currentBot}` : 'Current bot / proxy';
    browserProfile.appendChild(autoOption);

    bots.forEach((bot, username) => {
        const option = document.createElement('option');
        option.value = username;
        const proxy = bot.proxy || bot.config && bot.config.proxy;
        option.innerText = proxy ? `${username} В· proxy` : username;
        browserProfile.appendChild(option);
    });

    browserProfile.value = [...browserProfile.options].some(option => option.value === selectedValue)
        ? selectedValue
        : '';
    browserProfilesInitialized = true;
}

if (browserForm) {
    browserForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const payload = browserPayload();
        if (!payload.url) return;

        if (browserSessionUsesEngine &&
            browserSessionId &&
            browserSessionProfile === (browserProfile ? browserProfile.value : '')) {
            browserOpenBtn.disabled = true;
            setBrowserState('opening', 'Navigating');
            navigateBrowserSession(payload.url).then(success => {
                browserOpenBtn.disabled = false;
                setBrowserState(success ? 'active' : 'error', success ? 'Session active' : 'Navigation failed');
            });
            return;
        }

        browserRequestId += 1;
        const requestId = browserRequestId;
        if (browserFallbackTimer) clearTimeout(browserFallbackTimer);
        browserOpenBtn.disabled = true;
        setBrowserError('');
        setBrowserState('opening', 'Opening session');

        const fallbackToHttp = () => {
            if (requestId !== browserRequestId) return;
            openBrowserOverHttp(payload, requestId);
        };

        // Browser sessions are HTTP server routes. Use them directly instead
        // of waiting for an optional Socket.IO handler that may not exist in
        // older/published server processes.
        fallbackToHttp();
    });
}

browserBack?.addEventListener('click', () => sendBrowserAction('back'));
browserForward?.addEventListener('click', () => sendBrowserAction('forward'));
browserReload?.addEventListener('click', () => sendBrowserAction('reload'));

socket.on('browserOpen', handleBrowserStatus);
socket.on('browserStatus', handleBrowserStatus);
socket.on('botList', renderBrowserProfiles);

if (browserProfile) {
    browserProfile.addEventListener('change', () => {
        if (!browserProfilesInitialized) renderBrowserProfiles();
    });
}

function updateViewer(port) {
    if (!port) return;
    const viewerFrame = viewerContainer.querySelector('iframe');
    const newSrc = `/viewer/${port}/`;
    if (!viewerFrame) {
        const frame = document.createElement('iframe');
        frame.src = newSrc;
        frame.dataset.viewerSrc = newSrc;
        frame.title = 'Minecraft visual feed';
        frame.loading = 'eager';
        frame.style.cssText = 'width:100%; height:100%; border:none;';
        frame.addEventListener('error', () => {
            viewerContainer.innerHTML = '<div class="placeholder">Viewer connection failed</div>';
        });
        viewerContainer.replaceChildren(frame);
    } else if (viewerFrame.dataset.viewerSrc !== newSrc) {
        viewerFrame.dataset.viewerSrc = newSrc;
        viewerFrame.src = newSrc;
    }

    const portDisplay = document.getElementById('viewerPortDisplay');
    if (portDisplay) portDisplay.innerText = `:${port}`;
}

socket.on('botViewer', (data) => {

    if (bots.has(data.username)) {
        const botConfig = bots.get(data.username).config;
        botConfig.viewerPort = data.port;
        if (data.firstPerson !== undefined) {
            botConfig.firstPerson = data.firstPerson;
        }
    }
    if (currentBot === data.username) {
        updateViewer(data.port);
        if (viewModeBtn) {
            viewModeBtn.innerText = data.firstPerson ? 'Third Person' : 'First Person';
        }
    }
});

// The bot is headless, so there is no screen to screenshot. This asks the
// server to draw the loaded block data around the bot as a top-down map.
let snapshotObjectUrl = null;
const snapshotBtn = document.getElementById('snapshotBtn');
const snapshotInfo = document.getElementById('snapshotInfo');
const snapshotResult = document.getElementById('snapshotResult');
const snapshotImg = document.getElementById('snapshotImg');

snapshotBtn?.addEventListener('click', async () => {
    if (!currentBot) {
        snapshotInfo.innerText = 'Сначала выбери бота';
        return;
    }
    snapshotBtn.disabled = true;
    snapshotInfo.innerText = 'Рисую...';
    try {
        const response = await fetch(`/snapshot?bot=${encodeURIComponent(currentBot)}&t=${Date.now()}`);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${response.status}`);
        }
        const metaHeader = response.headers.get('X-Snapshot');
        const blob = await response.blob();
        if (snapshotObjectUrl) URL.revokeObjectURL(snapshotObjectUrl);
        snapshotObjectUrl = URL.createObjectURL(blob);
        snapshotImg.src = snapshotObjectUrl;
        snapshotResult.hidden = false;
        if (metaHeader) {
            const meta = JSON.parse(metaHeader);
            snapshotInfo.innerText = `x ${meta.x} y ${meta.y} z ${meta.z} · ${meta.unloaded} незагруженных`;
        } else {
            snapshotInfo.innerText = '';
        }
    } catch (err) {
        snapshotInfo.innerText = err.message;
    } finally {
        snapshotBtn.disabled = false;
    }
});

function decodeManualMap(encodedPixels) {
    try {
        const binary = atob(encodedPixels);
        if (binary.length < 128 * 128) return null;
        const pixels = new Uint8ClampedArray(128 * 128 * 4);
        const shades = [0.71, 0.86, 1, 0.53];

        for (let index = 0; index < 128 * 128; index += 1) {
            const packedColor = binary.charCodeAt(index);
            const output = index * 4;
            // Palette index 0 is Minecraft's CLEAR colour, so byte 0 really
            // is "no data" and must stay transparent.
            if (packedColor === 0) {
                pixels[output + 3] = 0;
                continue;
            }
            const baseIndex = packedColor >> 2;
            const rgb = MANUAL_MAP_PALETTE[baseIndex] || 0x909090;
            const brightness = shades[packedColor & 3];
            pixels[output] = Math.min(255, Math.round(((rgb >> 16) & 0xff) * brightness));
            pixels[output + 1] = Math.min(255, Math.round(((rgb >> 8) & 0xff) * brightness));
            pixels[output + 2] = Math.min(255, Math.round((rgb & 0xff) * brightness));
            pixels[output + 3] = 255;
        }

        return new ImageData(pixels, 128, 128);
    } catch (error) {
        console.warn('Could not decode the server map image:', error);
        return null;
    }
}

function drawManualMap(canvas, encodedPixels) {
    const image = decodeManualMap(encodedPixels);
    if (!image) return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.imageSmoothingEnabled = false;
    context.putImageData(image, 0, 0);
    return true;
}

function mapWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'карта';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'карты';
    return 'карт';
}

// Captcha maps arrive as ONE picture cut into 128x128 tiles and shuffled.
// Measured on real server samples: a correct seam costs ~4/765 while wrong
// pairs sit near 274, so growing the grid from the best seam is reliable.
function mapBorderCost(inner, outer, vertical) {
    let sum = 0;
    let counted = 0;
    for (let i = 0; i < 128; i += 1) {
        const a = vertical ? ((127 * 128 + i) * 4) : ((i * 128 + 127) * 4);
        const b = vertical ? (i * 4) : ((i * 128) * 4);
        if (inner[a + 3] < 8 || outer[b + 3] < 8) continue;
        sum += Math.abs(inner[a] - outer[b]) +
            Math.abs(inner[a + 1] - outer[b + 1]) +
            Math.abs(inner[a + 2] - outer[b + 2]);
        counted += 1;
    }
    return counted ? sum / counted : 765;
}

function assembleCaptchaPuzzle(ids) {
    const pieces = [];
    for (const id of ids) {
        const image = decodeManualMap(latestMapData[id]);
        if (image) pieces.push({ id, px: image.data });
    }
    if (pieces.length < 2) return null;

    const total = pieces.length;
    const cols = Math.round(Math.sqrt(total));
    const rows = Math.ceil(total / cols);

    let seed = null;
    for (let a = 0; a < total; a += 1) {
        for (let b = 0; b < total; b += 1) {
            if (a === b) continue;
            const c = mapBorderCost(pieces[a].px, pieces[b].px, false);
            if (!seed || c < seed.cost) seed = { a, b, cost: c };
        }
    }
    if (!seed) return null;

    const grid = new Array(cols * rows).fill(null);
    const used = new Set([seed.a, seed.b]);
    grid[0] = pieces[seed.a];
    grid[1] = pieces[seed.b];

    for (let cell = 2; cell < cols * rows; cell += 1) {
        const col = cell % cols;
        const row = Math.floor(cell / cols);
        const left = col > 0 ? grid[cell - 1] : null;
        const above = row > 0 ? grid[cell - cols] : null;
        if (!left && !above) break;

        let best = null;
        for (let i = 0; i < total; i += 1) {
            if (used.has(i)) continue;
            let cost = 0;
            let parts = 0;
            if (left) { cost += mapBorderCost(left.px, pieces[i].px, false); parts += 1; }
            if (above) { cost += mapBorderCost(above.px, pieces[i].px, true); parts += 1; }
            if (!parts) continue;
            cost /= parts;
            if (!best || cost < best.cost) best = { i, cost };
        }
        if (!best) break;
        grid[cell] = pieces[best.i];
        used.add(best.i);
    }

    return { grid, cols, rows, seedCost: seed.cost };
}

function drawCaptchaPuzzle(assembly) {
    const out = document.createElement('canvas');
    out.width = assembly.cols * 128;
    out.height = Math.max(128, assembly.rows * 128);
    const context = out.getContext('2d');
    if (!context) return null;
    context.imageSmoothingEnabled = false;

    const part = document.createElement('canvas');
    part.width = 128;
    part.height = 128;
    const partCtx = part.getContext('2d');

    assembly.grid.forEach((cell, index) => {
        if (!cell) return;
        const image = partCtx.createImageData(128, 128);
        image.data.set(cell.px);
        partCtx.putImageData(image, 0, 0);
        const originX = (index % assembly.cols) * 128;
        const originY = Math.floor(index / assembly.cols) * 128;
        context.drawImage(part, originX, originY);
        context.strokeStyle = 'rgba(148,163,184,0.2)';
        context.lineWidth = 1;
        context.strokeRect(originX + 0.5, originY + 0.5, 127, 127);
    });

    return out;
}

function renderMapPane() {
    if (!mapPaneStage) return;

    const zoom = Number(mapPaneZoom?.value) || 1;
    if (mapPaneZoomValue) mapPaneZoomValue.textContent = `${zoom}x`;

    const ids = orderedMapIds(latestManualWindow);

    if (!ids.length) {
        if (mapPaneBadge) mapPaneBadge.textContent = 'Ожидание';
        mapPaneStage.replaceChildren();
        if (mapPaneCoords) mapPaneCoords.textContent = 'Карты пока нет';
        renderMapOverlay();
        return;
    }

    if (mapPaneBadge) mapPaneBadge.textContent = `${ids.length} ${mapWord(ids.length)}`;

    // Put the shuffled tiles back into the original picture first.
    const solved = mapPaneAssemble?.checked && ids.length > 1
        ? assembleCaptchaPuzzle(ids)
        : null;

    if (solved) {
        const picture = drawCaptchaPuzzle(solved);
        if (picture) {
            picture.className = 'map-pane-canvas';
            picture.style.width = `${picture.width * zoom}px`;
            picture.style.height = `${picture.height * zoom}px`;
            picture.style.maxWidth = 'none';
            picture.setAttribute('role', 'img');
            picture.setAttribute('aria-label', 'Собранная картинка капчи');
            mapPaneStage.replaceChildren(picture);
            currentMapCanvas = picture;
            if (mapPaneBadge) {
                mapPaneBadge.textContent =
                    `${solved.cols}×${solved.rows} · собрано из ${ids.length} ${mapWord(ids.length)}`;
            }
            if (mapPaneCoords) mapPaneCoords.textContent = 'Картинка собрана из перемешанных кусков';
            renderMapOverlay();
            return;
        }
    }

    // Every map from this server is a piece of one picture, so show all of them
    // at once, each at its full 128x128 size.
    const chosen = mapPaneCols?.value ?? 'auto';
    const available = Math.max(128, (mapPaneStage.clientWidth || 1024) - 18);
    // "auto" packs as many full-size maps per row as the panel can hold.
    const cols = chosen === 'auto'
        ? Math.max(1, Math.min(ids.length, Math.floor(available / 128)))
        : Math.max(1, Number(chosen) || 6);
    const rows = Math.ceil(ids.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = cols * 128;
    canvas.height = Math.max(128, rows * 128);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;

    ids.forEach((id, index) => {
        const image = decodeManualMap(latestMapData[id]);
        if (!image) return;
        const part = document.createElement('canvas');
        part.width = 128;
        part.height = 128;
        part.getContext('2d').putImageData(image, 0, 0);

        const originX = (index % cols) * 128;
        const originY = Math.floor(index / cols) * 128;
        const turn = (mapPartRotations[id] || 0) % 360;

        context.save();
        context.translate(originX + 64, originY + 64);
        if (turn) context.rotate(turn * Math.PI / 180);
        context.drawImage(part, -64, -64);
        context.restore();

        context.strokeStyle = index === mapSelectedCell ? '#facc15' : 'rgba(148,163,184,0.4)';
        context.lineWidth = index === mapSelectedCell ? 3 : 1;
        context.strokeRect(originX + 1, originY + 1, 126, 126);
    });

    canvas.className = 'map-pane-canvas';
    canvas.style.width = `${canvas.width * zoom}px`;
    canvas.style.height = `${canvas.height * zoom}px`;
    canvas.style.maxWidth = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Все карты: ${ids.length}`);

    const cellAt = (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor((event.clientX - rect.left) / rect.width * canvas.width);
        const y = Math.floor((event.clientY - rect.top) / rect.height * canvas.height);
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return -1;
        return Math.floor(y / 128) * cols + Math.floor(x / 128);
    };

    canvas.addEventListener('mousemove', (event) => {
        const cell = cellAt(event);
        if (cell < 0 || cell >= ids.length || !mapPaneCoords) return;
        mapPaneCoords.textContent = `Карта #${ids[cell]} · ${cell + 1} из ${ids.length}`;
    });

    canvas.addEventListener('mouseleave', () => {
        if (mapPaneCoords) mapPaneCoords.textContent = 'ПКМ по карте - повернуть её на 90°';
    });

    canvas.addEventListener('click', (event) => {
        const cell = cellAt(event);
        if (cell < 0 || cell >= ids.length) return;
        mapSelectedCell = cell;
        renderMapPane();
    });

    canvas.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const cell = cellAt(event);
        if (cell < 0 || cell >= ids.length) return;
        const id = ids[cell];
        mapPartRotations[id] = ((mapPartRotations[id] || 0) + 90) % 360;
        renderMapPane();
    });

    mapPaneStage.replaceChildren(canvas);
    currentMapCanvas = canvas;
    renderMapOverlay();
}

function renderMapOverlay() {
    const overlay = document.getElementById('mapPaneOverlay');
    const body = document.getElementById('mapPaneOverlayBody');
    if (!overlay || !body || overlay.hidden) return;

    body.replaceChildren();
    if (!currentMapCanvas) {
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        placeholder.textContent = 'Карты пока нет';
        body.appendChild(placeholder);
        return;
    }

    const clone = document.createElement('canvas');
    clone.width = currentMapCanvas.width;
    clone.height = currentMapCanvas.height;
    const context = clone.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(currentMapCanvas, 0, 0);
    clone.className = 'map-pane-canvas map-pane-canvas-full';
    body.appendChild(clone);

    const hint = document.createElement('p');
    hint.className = 'map-pane-help';
    hint.textContent =
        `${orderedMapIds(latestManualWindow).length} карт · ПКМ - повернуть · Esc - закрыть`;
    body.appendChild(hint);
}

function renderManualWindowState(payload) {
    if (!payload || payload.username !== currentBot) return;
    const window = payload.window;
    if (!manualCaptchaPanel || !manualCaptchaTitle || !manualCaptchaMaps ||
        !manualCaptchaSlots || !manualCaptchaHelp) return;

    const maps = payload.maps || {};
    latestManualWindow = window || null;
    noteMapArrival(maps);
    latestMapData = maps;
    renderMapPane();

    if (!window && Object.keys(maps).length === 0) {
        currentManualWindowId = null;
        manualCaptchaPanel.hidden = true;
        manualCaptchaMaps.replaceChildren();
        manualCaptchaSlots.replaceChildren();
        return;
    }

    currentManualWindowId = window?.id ?? null;
    manualCaptchaPanel.hidden = false;
    const occupiedSlots = (window?.slots || []).filter(Boolean).length;
    manualCaptchaTitle.textContent = window
        ? [
            window.title || 'Server challenge',
            window.type || '',
            `${occupiedSlots} item${occupiedSlots === 1 ? '' : 's'}`
        ].filter(Boolean).join(' В· ')
        : 'Server map images В· enter your answer in chat';

    manualCaptchaMaps.replaceChildren();
    const mapIds = new Set(Object.keys(maps).map(String));
    for (const item of (window?.slots || [])
            .filter(item => item && item.mapId !== null && item.mapId !== undefined)
            .map(item => String(item.mapId))) {
        mapIds.add(item);
    }
    for (const mapId of mapIds) {
        const encodedPixels = maps[mapId];
        if (!encodedPixels) continue;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        canvas.className = 'manual-captcha-map';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Minecraft map ${mapId}`);
        if (drawManualMap(canvas, encodedPixels)) {
            const mapCard = document.createElement('figure');
            mapCard.className = 'manual-captcha-map-card';
            const caption = document.createElement('figcaption');
            caption.textContent = `Map #${mapId}`;
            mapCard.append(canvas, caption);
            manualCaptchaMaps.appendChild(mapCard);
        }
    }

    const waitingForMap = Array.from(mapIds).some(mapId => !maps[mapId]);
    if (waitingForMap && mapIds.size > 0) {
        const note = document.createElement('span');
        note.className = 'manual-captcha-title';
        note.textContent = 'Ожидаю данные изображения от сервера…';
        manualCaptchaMaps.appendChild(note);
    }

    manualCaptchaSlots.replaceChildren();
    manualCaptchaSlots.hidden = !window;
    manualCaptchaHelp.textContent = window
        ? 'Click a slot to send that click to the open Minecraft window.'
        : 'Map images are shown here when received. Enter the CAPTCHA text yourself in the chat field.';
    (window?.slots || []).forEach((item, slot) => {
        if (!item) {
            const emptySlot = document.createElement('span');
            emptySlot.className = 'manual-captcha-empty-slot';
            emptySlot.setAttribute('aria-hidden', 'true');
            manualCaptchaSlots.appendChild(emptySlot);
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'manual-captcha-slot';
        button.dataset.captchaSlot = String(slot);
        button.dataset.windowId = String(window.id);
        button.setAttribute('aria-label', `Click slot ${slot + 1}: ${item.label || item.name}`);
        button.title = [
            item.label,
            item.mapId !== null && item.mapId !== undefined ? `Map ID ${item.mapId}` : '',
            ...(item.lore || [])
        ].filter(Boolean).join('\n');

        const itemName = document.createElement('span');
        itemName.className = 'manual-captcha-slot-name';
        itemName.textContent = item.mapId !== null && item.mapId !== undefined
            ? `Map #${item.mapId}`
            : (item.label || item.name || `Slot ${slot + 1}`);
        button.appendChild(itemName);

        if (item.count > 1) {
            const count = document.createElement('span');
            count.className = 'manual-captcha-slot-count';
            count.textContent = `Г—${item.count}`;
            button.appendChild(count);
        }
        manualCaptchaSlots.appendChild(button);
    });
}

socket.on('manualWindowState', renderManualWindowState);

// A server verification link arrived (XCord / BotSentry style). Open it in the
// mini browser: /browser/open routes the session through the bot's proxy, so
// the page is fetched from the very IP the bot joined from. The challenge
// itself has to be confirmed by a person - that is what it is for.
socket.on('captchaLink', async (payload) => {
    if (!payload || !payload.url || !payload.username) return;
    if (currentBot && payload.username !== currentBot) return;

    if (browserUrl) browserUrl.value = payload.url;
    setBrowserState('loading', 'Открываю страницу проверки...');
    if (browserOpenBtn) browserOpenBtn.disabled = true;
    browserRequestId += 1;
    await openBrowserOverHttp(
        { url: payload.url, profile: payload.username, username: payload.username },
        browserRequestId
    );
});

socket.on('chatHistory', (payload) => {
    const username = payload.username;
    const history = payload.history;

    const targetBox = getChatBox(username);

    targetBox.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'chat-message info';
    welcome.innerText = `Chat history for ${username}`;
    targetBox.appendChild(welcome);

    history.forEach(msg => {
        renderChatMessage(msg, targetBox);
    });
    targetBox.scrollTop = targetBox.scrollHeight;
});

socket.on('botChat', (payload) => {
    if (!payload.username) return;

    const targetBox = getChatBox(payload.username);
    const lastMsg = targetBox.lastElementChild;
    const now = Date.now();
    const compareText = payload.raw || payload.message;
    const sender = payload.sender || '[Server]';

    if (lastMsg && lastMsg.dataset.rawMessage === compareText && lastMsg.dataset.sender === sender) {
        let count = parseInt(lastMsg.dataset.repeatCount) || 1;
        count++;
        lastMsg.dataset.repeatCount = count;
        lastMsg.dataset.timestamp = now;

        let repeatSpan = lastMsg.querySelector('.repeat-count');
        if (!repeatSpan) {
            repeatSpan = document.createElement('span');
            repeatSpan.className = 'repeat-count';
            repeatSpan.style.cssText = 'color: var(--primary); font-weight: bold; margin-left: 8px; font-size: 0.85em; opacity: 0.8;';
            lastMsg.appendChild(repeatSpan);
        }
        repeatSpan.innerText = `(x${count})`;

        // Keep scroll at bottom if it was already there
        const isAtBottom = (targetBox.scrollHeight - targetBox.scrollTop - targetBox.clientHeight) < 100;
        if (isAtBottom) {
            targetBox.scrollTop = targetBox.scrollHeight;
        }
        return;
    }

    const msgObj = {
        username: sender,
        message: payload.message,
        type: payload.type || 'chat',
        raw: compareText,
        timestamp: now
    };

    if (chatVisible) {
        const isAtBottom = (targetBox.scrollHeight - targetBox.scrollTop - targetBox.clientHeight) < 50;
        renderChatMessage(msgObj, targetBox);
        if (isAtBottom) {
            targetBox.scrollTop = targetBox.scrollHeight;
        }
    }
});

function renderChatMessage(msg, targetBox = chatBox) {
    const div = document.createElement('div');
    div.className = `chat-message ${msg.type || 'info'}`;

    div.dataset.rawMessage = msg.raw || msg.message;
    div.dataset.sender = msg.username || '[Server]';
    div.dataset.timestamp = msg.timestamp || Date.now();
    div.dataset.repeatCount = "1";

    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

    const timeSpan = document.createElement('span');
    timeSpan.style.opacity = '0.5';
    timeSpan.style.fontSize = '0.8em';
    timeSpan.innerText = `[${time}] `;
    div.appendChild(timeSpan);

    if (msg.username && msg.username !== '[Server]') {
        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = 'bold';
        nameSpan.style.marginRight = '5px';
        nameSpan.innerHTML = formatChat(msg.username) + ':';
        div.appendChild(nameSpan);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'message-content';
    textSpan.innerHTML = formatChat(msg.message);
    div.appendChild(textSpan);

    targetBox.appendChild(div);
}

tabBtns.forEach(btn => {
    btn.onclick = () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        currentTab = btn.dataset.tab;

        if (currentTab === 'inventory' || currentTab === 'analyticsPane') {
            if (currentTab === 'inventory') updateInventoryFrame();
            else updateAnalyticsGraphs();
        }
        if (currentTab === 'watchlistPane') {
            renderWatchlist();
        }
        if (currentTab === 'mapPane') {
            renderMapPane();
        }
    };
});

mapPaneZoom?.addEventListener('input', renderMapPane);
mapPaneCols?.addEventListener('change', renderMapPane);
mapPaneSave?.addEventListener('click', () => {
    if (!currentMapCanvas) return;
    const link = document.createElement('a');
    link.download = `imperialsbot-maps-${Date.now()}.png`;
    link.href = currentMapCanvas.toDataURL('image/png');
    link.click();
});
mapPaneRotateAll?.addEventListener('click', () => {
    for (const id of Object.keys(latestMapData)) {
        mapPartRotations[id] = ((mapPartRotations[id] || 0) + 90) % 360;
    }
    renderMapPane();
});

function toggleMapOverlay(force) {
    const overlay = document.getElementById('mapPaneOverlay');
    if (!overlay) return;
    overlay.hidden = force !== undefined ? !force : !overlay.hidden;
    renderMapOverlay();
}

document.getElementById('mapPaneFullscreen')?.addEventListener('click', () => toggleMapOverlay(true));
document.getElementById('mapPaneOverlayClose')?.addEventListener('click', () => toggleMapOverlay(false));
document.getElementById('mapPaneOverlay')?.addEventListener('click', (event) => {
    if (event.target.id === 'mapPaneOverlay') toggleMapOverlay(false);
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') toggleMapOverlay(false);
});

const watchlistInput = document.getElementById('watchlistInput');
const addWatchlistBtn = document.getElementById('addWatchlistBtn');
const watchlistContainer = document.getElementById('watchlistContainer');
const watchlistCount = document.getElementById('watchlistCount');

if (addWatchlistBtn) {
    addWatchlistBtn.onclick = () => addWatchlistPlayer();
}

if (watchlistInput) {
    watchlistInput.onkeydown = (e) => {
        if (e.key === 'Enter') addWatchlistPlayer();
    };
}

function addWatchlistPlayer() {
    const name = watchlistInput.value.trim().toLowerCase();
    if (!name) return;
    if (watchlist.includes(name)) {
        showNotification('Player already in watchlist', 'warning');
        return;
    }
    watchlist.push(name);
    watchlistInput.value = '';
    saveWatchlist();
    renderWatchlist();
}

function removeWatchlistPlayer(name) {
    watchlist = watchlist.filter(n => n !== name);
    saveWatchlist();
    renderWatchlist();
}

function saveWatchlist() {
    socket.emit('updateWatchlist', watchlist);
    const settings = { watchlist: watchlist };
    socket.emit('saveSettings', settings);
}

function renderWatchlist() {
    if (!watchlistContainer) return;
    watchlistContainer.innerHTML = '';
    watchlistCount.innerText = `${watchlist.length} Players`;

    if (watchlist.length === 0) {
        watchlistContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; width: 100%; text-align: center; padding: 20px;">No players in watchlist</div>';
        return;
    }

    watchlist.forEach(name => {
        const tag = document.createElement('div');
        tag.className = 'watchlist-tag';
        tag.style.cssText = 'background: rgba(59, 130, 246, 0.1); border: 1px solid var(--primary); color: var(--text-primary); padding: 5px 12px; border-radius: 20px; display: flex; align-items: center; gap: 8px; font-size: 0.9rem; animate: fadeIn 0.2s;';

        tag.innerHTML = `
            <span>${name}</span>
            <span class="remove-btn" style="cursor: pointer; opacity: 0.6; hover: opacity: 1; font-weight: bold;">&times;</span>
        `;

        tag.querySelector('.remove-btn').onclick = () => removeWatchlistPlayer(name);
        watchlistContainer.appendChild(tag);
    });
}

socket.on('watchlistUpdate', (list) => {
    watchlist = list;
    renderWatchlist();
});

socket.on('watchlistAlert', (data) => {
    showNotification(data.message, data.type === 'join' ? 'success' : 'warning');
});

let packetDebugActive = false;
const togglePacketDebugBtn = document.getElementById('togglePacketDebugBtn');
const clearPacketsBtn = document.getElementById('clearPacketsBtn');
const packetStream = document.getElementById('packetStream');
const packetAutoscroll = document.getElementById('packetAutoscroll');
const packetFilter = document.getElementById('packetFilter');

if (togglePacketDebugBtn) {
    togglePacketDebugBtn.onclick = () => {
        if (!currentBot) return showNotification('Select a bot first', 'warning');
        packetDebugActive = !packetDebugActive;
        togglePacketDebugBtn.innerText = packetDebugActive ? 'Stop Capture' : 'Start Capture';
        togglePacketDebugBtn.style.backgroundColor = packetDebugActive ? 'var(--danger)' : '';
        socket.emit('botAction', {
            username: currentBot,
            action: 'togglePacketDebug',
            payload: { enabled: packetDebugActive }
        });
        const header = document.getElementById('packetHeader');
        if (header) header.style.display = packetDebugActive ? 'flex' : 'none';

        if (packetDebugActive) {
            const placeholder = document.getElementById('packetPlaceholder');
            if (placeholder) {
                placeholder.style.display = 'block';
                placeholder.innerText = 'Listening for packets...';
            }
            if (packetAutoscroll && packetAutoscroll.checked && packetStream) {
                setTimeout(() => {
                    packetStream.scrollTop = packetStream.scrollHeight;
                }, 50);
            }
        }
    };
}

if (packetAutoscroll) {
    packetAutoscroll.onchange = () => {
        if (packetAutoscroll.checked && packetStream) {
            packetStream.scrollTop = packetStream.scrollHeight;
        }
    };
}

if (clearPacketsBtn) {
    clearPacketsBtn.onclick = () => {
        if (!packetStream) return;
        Array.from(packetStream.children).forEach(c => {
            if (c.id !== 'packetHeader' && c.id !== 'packetPlaceholder') {
                c.remove();
            }
        });
    };
}

socket.on('packetDebug', (data) => {
    if (!packetStream || data.username !== currentBot) return;

    const filterVal = packetFilter ? packetFilter.value.toLowerCase() : '';
    if (filterVal && !data.name.toLowerCase().includes(filterVal)) return;

    const placeholder = document.getElementById('packetPlaceholder');
    if (placeholder) placeholder.style.display = 'none';

    const header = document.getElementById('packetHeader');
    if (header) header.style.display = 'flex';

    const row = document.createElement('div');
    row.style.cssText = 'padding: 3px 6px; border-bottom: 1px solid rgba(255,255,255,0.03); display: flex; gap: 10px; align-items: baseline;';

    const time = new Date(data.timestamp).toLocaleTimeString();
    const sizeKB = (data.size / 1024).toFixed(1);

    // Color code by packet type for visual scanning
    let nameColor = '#60a5fa';
    if (data.name.includes('position') || data.name.includes('move')) nameColor = '#34d399';
    else if (data.name.includes('chat') || data.name.includes('message')) nameColor = '#fbbf24';
    else if (data.name.includes('entity')) nameColor = '#a78bfa';
    else if (data.name.includes('block')) nameColor = '#f87171';

    const summaryStr = data.summary ? Object.entries(data.summary).map(([k, v]) => `${k}=${v}`).join(' ') : '';

    row.innerHTML = `
        <span style="color: var(--text-muted); min-width: 60px;">${time}</span>
        <span style="color: #94a3b8; min-width: 30px;">${data.direction}</span>
        <span style="color: ${nameColor}; font-weight: 600; min-width: 130px; word-break: break-all;">${data.name}</span>
        <span style="color: var(--text-muted); min-width: 45px;">${sizeKB}KB</span>
        <span style="color: #64748b; flex: 1; word-break: break-all; white-space: pre-wrap;">${summaryStr}</span>
    `;

    // Click to show full summary in a notification
    row.style.cursor = 'pointer';
    row.onclick = () => {
        const detail = JSON.stringify(data.summary, null, 2);
        showNotification(`${data.name}: ${detail.substring(0, 200)}`, 'info');
    };

    packetStream.appendChild(row);

    // Cap at 500 lines (or 100 in Low Performance Mode)
    const maxPackets = lowPerformanceEnabled ? 100 : 500;
    while (packetStream.children.length > maxPackets) {
        packetStream.removeChild(packetStream.firstChild);
    }

    const autoscrollEnabled = packetAutoscroll ? packetAutoscroll.checked : true;
    if (autoscrollEnabled) {
        const scrollBottom = packetStream.scrollTop + packetStream.clientHeight;
        const isAtBottom = (packetStream.scrollHeight - scrollBottom) < 300;

        if (isAtBottom) {
            requestAnimationFrame(() => {
                packetStream.scrollTop = packetStream.scrollHeight;
            });
        }
    }
});

addBotBtn.onclick = () => {
    addBotModal.classList.add('active');
};
window.toggleRealmsFields = function (select, prfx) {
    const isRealms = select.value === 'realms';
    document.getElementById(`${prfx}ServerFields`).style.display = isRealms ? 'none' : 'block';
    document.getElementById(`${prfx}RealmsFields`).style.display = isRealms ? 'block' : 'none';
    const authSelect = document.querySelector(`#${prfx}BotForm [name="auth"]`);
    if (authSelect && isRealms) {
        authSelect.value = 'microsoft';
        authSelect.disabled = true;
    } else if (authSelect) {
        authSelect.disabled = false;
    }
};

cancelAddBot.onclick = () => {
    addBotModal.classList.remove('active');
};

window.toggleProxyFields = function (prfx) {
    const typeSelect = document.getElementById(`${prfx}BotProxyType`);
    const detailsDiv = document.getElementById(`${prfx}BotProxyDetails`);
    if (typeSelect && detailsDiv) {
        if (typeSelect.value === 'none') {
            detailsDiv.style.display = 'none';
        } else {
            detailsDiv.style.display = 'block';
        }
    }
};

window.toggleBulkServerFields = function (val) {
    const srv = document.getElementById('bulkServerFields');
    const rlm = document.getElementById('bulkRealmsFields');
    if (val === 'server') {
        srv.style.display = 'block';
        rlm.style.display = 'none';
    } else {
        srv.style.display = 'none';
        rlm.style.display = 'block';
    }
};

if (bulkGenerateBtn) {
    bulkGenerateBtn.onclick = () => {
        bulkGenerateModal.classList.add('active');
        // Populate initial plugins list
        const firstBot = Array.from(bots.values())[0];
        if (firstBot && firstBot.plugins) {
            renderBulkPlugins(firstBot.plugins);
        } else {
            socket.emit('getAvailablePlugins');
        }
    };
}

socket.on('availablePlugins', (plugins) => {
    renderBulkPlugins(plugins);
});

function renderBulkPlugins(plugins) {
    if (!bulkPluginsList) return;
    bulkPluginsList.innerHTML = plugins.map(p => `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-muted); cursor: pointer;">
            <input type="checkbox" name="plugin_${p.name}" ${p.name === 'Pre-Join Ping' ? 'checked' : ''}>
            <span>${p.name}</span>
        </label>
    `).join('');
}

if (cancelBulkGenerate) {
    cancelBulkGenerate.onclick = () => {
        bulkGenerateModal.classList.remove('active');
    };
}

if (bulkGenerateForm) {
    bulkGenerateForm.onsubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(bulkGenerateForm);
        const rawData = Object.fromEntries(formData.entries());

        const count = parseInt(rawData.count) || 1;
        const nameFormat = rawData.nameFormat || 'bot_%d';

        const baseConfig = {
            host: rawData.host,
            port: parseInt(rawData.port) || 25565,
            version: rawData.version || '1.21.4',
            auth: rawData.auth || 'offline',
            password: rawData.password || '',
            autoReconnect: formData.get('autoReconnect') === 'on',
            firstPerson: formData.get('firstPerson') === 'on',
            reconnectDelay: formData.get('reconnectDelay'),
            globalAnalytics: formData.get('globalAnalytics') === 'on',
            dashboardFont: formData.get('dashboardFont'),
            plugins: {}
        };

        if (rawData.connectionType === 'realms') {
            baseConfig.realms = {
                [rawData.realmType === 'id' ? 'realmId' : (rawData.realmType === 'name' ? 'realmName' : 'realmInvite')]: rawData.realmIdentifier
            };
            baseConfig.host = '';
            baseConfig.port = 0;
        }

        const enabledPlugins = [];
        for (const key in rawData) {
            if (key.startsWith('plugin_')) {
                enabledPlugins.push(key.replace('plugin_', ''));
            }
        }

        const configs = [];
        for (let i = 1; i <= count; i++) {
            const botName = nameFormat.replace('%d', i);
            
            // VALIDATION: Minecraft names must be 3-16 chars, alphanumeric/underscores
            const isValid = /^[a-zA-Z0-9_]{3,16}$/.test(botName);
            if (!isValid) {
                showNotification(`Invalid bot name generated: "${botName}". Names must be 3-16 characters and only contain alphanumeric characters or underscores.`, 'error');
                return;
            }

            const config = {
                ...baseConfig,
                username: botName,
                autoAuth: true,
                plugins: {}
            };

            enabledPlugins.forEach(pName => {
                config.plugins[pName] = { enabled: true, config: {} };
            });

            configs.push(config);
        }

        socket.emit('bulkCreateBots', configs);
        bulkGenerateModal.classList.remove('active');
        bulkGenerateForm.reset();
        showNotification(`Generating ${count} bots...`, 'info');
    };
}

addBotForm.onsubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(addBotForm);
    const data = Object.fromEntries(formData.entries());


    if (data.connectionType === 'realms') {
        if (data.auth === 'offline') {
            showNotification('Realms requires Microsoft authentication.', 'error');
            return;
        }
        data.realms = {
            [data.realmType === 'id' ? 'realmId' : (data.realmType === 'name' ? 'realmName' : 'realmInvite')]: data.realmIdentifier
        };

        data.host = '';
        data.port = 0;
    }


    data.port = parseInt(data.port) || 0;
    data.version = data.version || '1.21.4';
    data.proxyPort = parseInt(data.proxyPort) || 0;
    data.firstPerson = formData.get('firstPerson') === 'on';
    data.autoReconnect = formData.get('autoReconnect') === 'on';
    data.registerConfirm = formData.get('registerConfirm') === 'on';
    if (data.discordIntegrationMode === 'none') {
        data.webhookUrl = '';
        data.discordBotToken = '';
        data.discordChannelId = '';
    } else if (data.discordIntegrationMode === 'webhook') {
        data.discordBotToken = '';
        data.discordChannelId = '';
    } else if (data.discordIntegrationMode === 'bot') {
        data.webhookUrl = '';
    }

    data.autoAuth = true;
    socket.emit('createBot', data);
    addBotModal.classList.remove('active');
    addBotForm.reset();

    document.getElementById('addServerFields').style.display = 'block';
    document.getElementById('addRealmsFields').style.display = 'none';
};

function openEditModal(bot) {
    const form = editBotForm;
    form.username.value = bot.username;
    form.host.value = bot.host || '';
    form.port.value = bot.port || 25565;
    if (form.version) form.version.value = bot.config.version || '';
    if (form.password) form.password.value = bot.config.password || '';
    if (form.auth) form.auth.value = bot.config.auth || 'offline';
    if (form.discordIntegrationMode) form.discordIntegrationMode.value = bot.config.discordIntegrationMode || 'none';
    if (form.webhookUrl) form.webhookUrl.value = bot.config.webhookUrl || '';
    if (form.discordBotToken) form.discordBotToken.value = bot.config.discordBotToken || '';
    if (form.discordChannelId) form.discordChannelId.value = bot.config.discordChannelId || '';

    if (window.toggleDiscordFields) window.toggleDiscordFields(form.discordIntegrationMode.value);

    if (form.proxyType) form.proxyType.value = bot.config.proxyType || 'none';
    if (form.proxyHost) form.proxyHost.value = bot.config.proxyHost || '';
    if (form.proxyPort) form.proxyPort.value = bot.config.proxyPort || '';
    if (form.proxyUser) form.proxyUser.value = bot.config.proxyUser || '';
    if (form.proxyPass) form.proxyPass.value = bot.config.proxyPass || '';


    if (bot.config.realms) {
        form.connectionType.value = 'realms';
        document.getElementById('editServerFields').style.display = 'none';
        document.getElementById('editRealmsFields').style.display = 'block';

        const realms = bot.config.realms;
        if (realms.realmId) {
            form.realmType.value = 'id';
            form.realmIdentifier.value = realms.realmId;
        } else if (realms.realmName) {
            form.realmType.value = 'name';
            form.realmIdentifier.value = realms.realmName;
        } else if (realms.realmInvite) {
            form.realmType.value = 'invite';
            form.realmIdentifier.value = realms.realmInvite;
        }
    } else {
        form.connectionType.value = 'server';
        document.getElementById('editServerFields').style.display = 'block';
        document.getElementById('editRealmsFields').style.display = 'none';
    }


    if (form.firstPerson) form.firstPerson.checked = !!bot.config.firstPerson;
    if (form.autoReconnect) form.autoReconnect.checked = !!bot.config.autoReconnect;
    if (form.registerConfirm) form.registerConfirm.checked = !!bot.config.registerConfirm;
    editBotModal.classList.add('active');
}

editBotForm.onsubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(editBotForm);
    const data = Object.fromEntries(formData.entries());

    if (data.connectionType === 'realms') {
        data.realms = {
            [data.realmType === 'id' ? 'realmId' : (data.realmType === 'name' ? 'realmName' : 'realmInvite')]: data.realmIdentifier
        };
        data.host = '';
        data.port = 0;
    } else {
        delete data.realms;
    }

    if (data.discordIntegrationMode === 'none') {
        data.webhookUrl = '';
        data.discordBotToken = '';
        data.discordChannelId = '';
    } else if (data.discordIntegrationMode === 'webhook') {
        data.discordBotToken = '';
        data.discordChannelId = '';
    } else if (data.discordIntegrationMode === 'bot') {
        data.webhookUrl = '';
    }

    data.port = parseInt(data.port) || 0;
    data.proxyPort = parseInt(data.proxyPort) || 0;
    data.firstPerson = formData.get('firstPerson') === 'on';
    data.autoReconnect = formData.get('autoReconnect') === 'on';
    data.registerConfirm = formData.get('registerConfirm') === 'on';
    socket.emit('editBot', data);
    editBotModal.classList.remove('active');
};

cancelEditBot.onclick = () => {
    editBotModal.classList.remove('active');
};

let chatHistory = [];
let historyIndex = -1;

chatInput.onkeydown = (e) => {
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (chatHistory.length > 0) {
            if (historyIndex < chatHistory.length - 1) {
                historyIndex++;
                chatInput.value = chatHistory[historyIndex];
            }
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > -1) {
            historyIndex--;
            if (historyIndex === -1) {
                chatInput.value = '';
            } else {
                chatInput.value = chatHistory[historyIndex];
            }
        }
    } else if (e.key === 'Enter') {
        if (!currentBot) {
            showNotification('Please select a bot first');
            return;
        }
        const text = chatInput.value;
        if (text.trim()) {
            chatHistory.unshift(text.trim());
            if (chatHistory.length > 10) chatHistory.pop();
            historyIndex = -1;

            socket.emit('botAction', {
                username: currentBot,
                action: 'chat',
                payload: { message: text }
            });
            chatInput.value = '';
        }
    }
};

const botSearchInput = document.getElementById('botSearchInput');
if (botSearchInput) {
    botSearchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const items = document.querySelectorAll('.bot-item');
        items.forEach(item => {
            const nameEl = item.querySelector('.bot-name');
            if (nameEl) {
                const name = nameEl.innerText.toLowerCase();
                item.style.display = name.includes(term) ? 'flex' : 'none';
            }
        });
    });
}

function addSpammerInput(value = '') {
    const div = document.createElement('div');
    div.className = 'spammer-input-group';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Message...';
    input.value = value;

    const del = document.createElement('button');
    del.className = 'btn-icon delete';
    del.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    del.onclick = () => div.remove();

    div.appendChild(input);
    div.appendChild(del);
    spammerList.appendChild(div);
}

addSpamMsgBtn.onclick = () => addSpammerInput('');

const importSpamBtn = document.getElementById('importSpamBtn');
const importSpamFile = document.getElementById('importSpamFile');

if (importSpamBtn && importSpamFile) {
    importSpamBtn.onclick = () => importSpamFile.click();

    importSpamFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target.result;
            const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);

            if (lines.length > 0) {




                lines.forEach(line => addSpammerInput(line));
                showNotification(`Imported ${lines.length} messages`, 'success');
            } else {
                showNotification('File is empty', 'warning');
            }
            importSpamFile.value = '';
        };
        reader.readAsText(file);
    };
}

const exportSpamBtn = document.getElementById('exportSpamBtn');
if (exportSpamBtn) {
    exportSpamBtn.onclick = () => {
        const inputs = spammerList.querySelectorAll('input');
        const messages = Array.from(inputs)
            .map(input => input.value)
            .filter(v => v.trim() !== '');

        if (messages.length === 0) {
            showNotification('No messages to export', 'warning');
            return;
        }

        const text = messages.join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `spammer_config_${timestamp}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification(`Exported ${messages.length} messages`, 'success');
    };
}



function setupToggle(btn, action, labelOff, labelOn) {
    if (btn) {
        btn.onclick = () => {
            if (!currentBot) return showNotification('Select a bot first');
            const isActive = btn.classList.contains('active');
            socket.emit('botAction', {
                username: currentBot,
                action: action,
                payload: { enabled: !isActive }
            });
        };
    }
}

setupToggle(autoReconnectBtn, 'toggleAutoReconnect', 'Auto Reconnect', 'Auto Reconnect');
setupToggle(autoAuthBtn, 'toggleAutoAuth', 'Auto Auth', 'Auto Auth');
setupToggle(antiAfkBtn, 'toggleAntiAFK', 'Anti-AFK', 'Anti-AFK');
setupToggle(killauraBtn, 'toggleKillaura', 'Killaura', 'Killaura');
setupToggle(document.getElementById('autoEatBtn'), 'toggleAutoEat', 'AutoEat', 'AutoEat');

socket.on('botToggles', (data) => {
    if (currentBot !== data.username) return;


    const updateBtn = (btn, enabled, label) => {
        if (!btn) return;
        if (enabled) {
            btn.classList.add('active');
            btn.innerText = `Stop ${label}`;
        } else {
            btn.classList.remove('active');
            btn.innerText = `Start ${label}`;
        }
    };

    updateBtn(autoReconnectBtn, data.autoReconnectEnabled, 'Auto-Reconnect');
    updateBtn(autoAuthBtn, data.autoAuthEnabled, 'AutoAuth');
    updateBtn(antiAfkBtn, data.antiAfkEnabled, 'Anti-AFK');
    updateBtn(killauraBtn, data.killauraEnabled, 'Killaura');
    updateBtn(document.getElementById('autoEatBtn'), data.autoEatEnabled, 'AutoEat');
    updateBtn(spammerBtn, data.spammerEnabled, 'Spammer');

    const kaSettings = document.getElementById('killauraSettings');
    if (kaSettings) kaSettings.style.display = data.killauraEnabled ? 'block' : 'none';
});

const kaApplyBtn = document.getElementById('kaApplyBtn');
if (kaApplyBtn) {
    kaApplyBtn.onclick = () => {
        if (!currentBot) return showNotification('Select a bot first', 'warning');
        socket.emit('botAction', {
            username: currentBot,
            action: 'updateKillauraConfig',
            payload: {
                config: {
                    attackRange: parseFloat(document.getElementById('kaAttackRange').value) || 4,
                    followRange: parseFloat(document.getElementById('kaFollowRange').value) || 6,
                    viewDistance: parseFloat(document.getElementById('kaViewDistance').value) || 16,
                    attackPlayers: document.getElementById('kaAttackPlayers').checked,
                    attackHostileMobs: document.getElementById('kaAttackHostile').checked,
                    attackPassiveMobs: document.getElementById('kaAttackPassive').checked
                }
            }
        });
        showNotification('Killaura settings applied', 'success');
    };
}

socket.on('killauraConfig', (data) => {
    if (currentBot !== data.username) return;
    const c = data.config;
    const kaAR = document.getElementById('kaAttackRange');
    const kaFR = document.getElementById('kaFollowRange');
    const kaVD = document.getElementById('kaViewDistance');
    const kaAP = document.getElementById('kaAttackPlayers');
    const kaAH = document.getElementById('kaAttackHostile');
    const kaAPa = document.getElementById('kaAttackPassive');
    if (kaAR) kaAR.value = c.attackRange;
    if (kaFR) kaFR.value = c.followRange;
    if (kaVD) kaVD.value = c.viewDistance;
    if (kaAP) kaAP.checked = c.attackPlayers;
    if (kaAH) kaAH.checked = c.attackHostileMobs;
    if (kaAPa) kaAPa.checked = c.attackPassiveMobs;
});

addSpammerInput('ImperialsBot OP');

spammerBtn.onclick = () => {
    if (!currentBot) {
        showNotification('Please select a bot first');
        return;
    }
    const isCurrentlyActive = spammerBtn.classList.contains('active');
    const newState = !isCurrentlyActive;

    const inputs = spammerList.querySelectorAll('input');
    const messages = Array.from(inputs).map(input => input.value).filter(v => v.trim() !== '');

    socket.emit('botAction', {
        username: currentBot,
        action: 'toggleSpammer',
        payload: {
            enabled: newState,
            config: {
                messages: messages,
                delay: parseFloat(spammerDelay.value),
                order: spammerOrder.value,
                appendRandom: spammerAppend.checked,
                randomLength: parseInt(spammerLen.value)
            }
        }
    });
};

suicideBtn.onclick = () => {
    if (!currentBot) {
        showNotification('Please select a bot first');
        return;
    }
    if (confirm('Are you sure you want the bot to commit suicide?')) {
        socket.emit('botAction', { username: currentBot, action: 'suicide', payload: {} });
    }
};

if (respawnBtn) {
    respawnBtn.onclick = () => {
        if (!currentBot) return showNotification('No bot selected', 'error');
        socket.emit('botAction', { username: currentBot, action: 'respawn', payload: {} });
        showNotification(`Respawn command sent to ${currentBot}`, 'info');
    };
}

rejoinBtn.onclick = () => {
    if (!currentBot) {
        showNotification('Please select a bot first');
        return;
    }
    socket.emit('botAction', { username: currentBot, action: 'rejoin' });
};

document.querySelectorAll('[data-action="stop"]').forEach(btn => {
    btn.onclick = () => {
        if (!currentBot) return;
        if (confirm('Disconnect bot from server? (Config will be saved)')) {
            socket.emit('botAction', { username: currentBot, action: 'stop' });
            showNotification('Disconnecting ' + currentBot + '...', 'info');
        }
    };
});

document.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.onclick = () => {
        if (!currentBot) return;
        if (confirm('Permanently DELETE this bot? This cannot be undone.')) {
            socket.emit('botAction', { username: currentBot, action: 'delete' });
        }
    };
});

const controls = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
controls.forEach(control => {
    const btns = document.querySelectorAll(`[data-control="${control}"]`);
    btns.forEach(btn => {
        const start = () => {
            btn.classList.add('active');
            sendControl(control, true);
        };
        const end = () => {
            btn.classList.remove('active');
            sendControl(control, false);
        };

        btn.onmousedown = start;
        btn.onmouseup = end;
        btn.onmouseleave = end;
        btn.ontouchstart = (e) => { e.preventDefault(); start(); };
        btn.ontouchend = (e) => { e.preventDefault(); end(); };
    });
});


const btnLeftClick = document.getElementById('btnLeftClick');
const btnRightClick = document.getElementById('btnRightClick');

if (btnLeftClick) {
    btnLeftClick.onmousedown = () => {
        if (!currentBot) return showNotification('Select a bot first');
        socket.emit('botAction', {
            username: currentBot,
            action: 'click',
            payload: { type: 'left' }
        });
        btnLeftClick.style.transform = 'scale(0.95)';
    };
    btnLeftClick.onmouseup = () => btnLeftClick.style.transform = 'scale(1)';
    btnLeftClick.onmouseleave = () => btnLeftClick.style.transform = 'scale(1)';
}

if (btnRightClick) {
    btnRightClick.onmousedown = () => {
        if (!currentBot) return showNotification('Select a bot first');
        socket.emit('botAction', {
            username: currentBot,
            action: 'click',
            payload: { type: 'right' }
        });
        btnRightClick.style.transform = 'scale(0.95)';
    };
    btnRightClick.onmouseup = () => btnRightClick.style.transform = 'scale(1)';
    btnRightClick.onmouseleave = () => btnRightClick.style.transform = 'scale(1)';
}

if (viewModeBtn) {
    viewModeBtn.onclick = () => {
        if (!currentBot) return showNotification('Select a bot first');
        socket.emit('botAction', {
            username: currentBot,
            action: 'toggleView'
        });
    };
}

const powerBtn = document.getElementById('powerBtn');
if (powerBtn) {
    powerBtn.onclick = () => {
        if (confirm('Are you sure you want to SHUTDOWN the entire application? All bots will be disconnected.')) {
            socket.emit('shutdownServer');
            showNotification('Shutting down server...', 'warning');
        }
    };
}

function sendControl(control, state) {
    if (!currentBot) return;
    socket.emit('control', {
        username: currentBot,
        control,
        state
    });
}

function sendLook() {
    if (!currentBot) return;
    socket.emit('botAction', {
        username: currentBot,
        action: 'setLook',
        payload: {
            yaw: parseFloat(yawSlider.value) * Math.PI / 180,
            pitch: parseFloat(pitchSlider.value) * Math.PI / 180
        }
    });
}

yawSlider.oninput = () => {
    yawVal.textContent = yawSlider.value;
    sendLook();
};

pitchSlider.oninput = () => {
    pitchVal.textContent = pitchSlider.value;
    sendLook();
};


function highlightButton(control, active) {
    const btns = document.querySelectorAll(`[data-control="${control}"]`);
    btns.forEach(btn => {
        if (active) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (isTyping()) return;

    const key = e.key.toLowerCase();


    if (key === ' ') {
        e.preventDefault();
    }

    if (keyMap[key] && !activeKeys.has(key)) {
        const control = keyMap[key];
        activeKeys.add(key);
        highlightButton(control, true);
        sendControl(control, true);
    } else if (key.startsWith('arrow')) {
        e.preventDefault(); // Stop page scrolling
        if (!currentBot) return;
        let y = parseFloat(yawSlider.value);
        let p = parseFloat(pitchSlider.value);

        if (key === 'arrowleft') y += step;
        if (key === 'arrowright') y -= step;
        if (key === 'arrowup') p += step;
        if (key === 'arrowdown') p -= step;

        // Wrap yaw -180 to 180
        if (y > 180) y -= 360;
        if (y < -180) y += 360;
        // Clamp pitch -90 to 90
        p = Math.max(-90, Math.min(90, p));

        yawSlider.value = y;
        pitchSlider.value = p;
        yawVal.textContent = y;
        pitchVal.textContent = p;
        sendLook();
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    const control = keyMap[key];

    if (control && activeKeys.has(key)) {
        e.preventDefault();
        activeKeys.delete(key);
        highlightButton(control, false);
        sendControl(control, false);
    }
});

window.addEventListener('blur', () => {
    activeKeys.forEach(key => {
        const control = keyMap[key];
        if (control) {
            highlightButton(control, false);
            sendControl(control, false);
        }
    });
    activeKeys.clear();
});



const exportChatBtn = document.getElementById('exportChatBtn');
exportChatBtn.onclick = () => {
    if (!chatBox.innerText.trim()) {
        showNotification('No chat to export', 'error');
        return;
    }

    let content = '';

    const messages = chatBox.querySelectorAll('.chat-message');
    messages.forEach(msg => {

        content += msg.innerText + '\n';
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_log_${currentBot || 'unknown'}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('Chat exported!', 'success');
};


const themeSelect = document.getElementById('themeSelect');

socket.on('settings', (settings) => {
    if (settings && settings.theme) {
        document.body.className = settings.theme;
        themeSelect.value = settings.theme;
    }
    isCloudMode = settings?.isCloudMode === true;
});

socket.on('globalHeadlessChanged', (enabled) => {
    const overlay = document.getElementById('headlessOverlay');
    if (overlay) {
        if (enabled) {
            overlay.classList.add('active');
        } else {
            overlay.classList.remove('active');
        }
    }
});

themeSelect.onchange = (e) => {
    const newTheme = e.target.value;


    if (!document.startViewTransition) {
        document.body.className = newTheme;
        socket.emit('saveSettings', { theme: newTheme });
        return;
    }

    document.startViewTransition(() => {
        document.body.className = newTheme;
        socket.emit('saveSettings', { theme: newTheme });
    });
};

let lastHoverable = null;

document.body.style.setProperty('--mouse-active', '0');

window.addEventListener('mouseenter', () => {
    document.body.style.setProperty('--mouse-active', '1');
});

window.addEventListener('mouseleave', () => {
    document.body.style.setProperty('--mouse-active', '0');
    if (lastHoverable) {
        lastHoverable.style.setProperty('--mouse-x', '-999px');
        lastHoverable.style.setProperty('--mouse-y', '-999px');
    }
});

document.addEventListener('mousemove', (e) => {
    const moveX = (e.clientX - window.innerWidth / 2) * 0.01;
    const moveY = (e.clientY - window.innerHeight / 2) * 0.01;
    document.body.style.setProperty('--parallax-x', `${moveX}px`);
    document.body.style.setProperty('--parallax-y', `${moveY}px`);

    const hoverable = e.target.closest('.btn, .card, .bot-item, .nav-input, .tab-btn');

    if (lastHoverable && lastHoverable !== hoverable) {
        lastHoverable.style.setProperty('--mouse-x', '-999px');
        lastHoverable.style.setProperty('--mouse-y', '-999px');
    }

    if (hoverable) {
        const rect = hoverable.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        hoverable.style.setProperty('--mouse-x', `${x}px`);
        hoverable.style.setProperty('--mouse-y', `${y}px`);
        document.body.style.setProperty('--mouse-active', '1');
        lastHoverable = hoverable;
    } else {
        document.body.style.setProperty('--mouse-active', '1');
    }
});


const spammerLenLabel = document.getElementById('spammerLenLabel');
if (spammerLen && spammerLenLabel) {
    spammerLen.addEventListener('input', () => {
        spammerLenLabel.textContent = `Anti-Spam Length: ${spammerLen.value}`;
    });
}

const navToggleBtn = document.getElementById('navToggleBtn');
const navStopBtn = document.getElementById('navStopBtn');
if (navStopBtn) {
    navStopBtn.onclick = () => {
        if (!currentBot) return;
        socket.emit('botAction', { username: currentBot, action: 'stopNavigation' });
    };
}
const navX = document.getElementById('navX');
const navY = document.getElementById('navY');
const navZ = document.getElementById('navZ');

let isNavigating = false;

if (navToggleBtn) {
    navToggleBtn.onclick = () => {
        if (!currentBot) return showNotification('Select a bot first');

        if (isNavigating) {

            socket.emit('botAction', {
                username: currentBot,
                action: 'stopNavigation',
                payload: {}
            });
            isNavigating = false;
            navToggleBtn.textContent = 'Go';
            navToggleBtn.className = 'nav-btn go';
        } else {

            const x = parseFloat(navX.value);
            const y = parseFloat(navY.value);
            const z = parseFloat(navZ.value);

            if (isNaN(x) || isNaN(y) || isNaN(z)) {
                return showNotification('Invalid coordinates', 'error');
            }

            socket.emit('botAction', {
                username: currentBot,
                action: 'move',
                payload: { x, y, z }
            });
            isNavigating = true;
            navToggleBtn.textContent = 'Stop';
            navToggleBtn.className = 'nav-btn stop';
        }
    };
}

socket.on('botStatus', (data) => {
    if (data.username === currentBot) {
        if (data.status === 'Arrived' || data.status === 'Navigation Stopped') {
            isNavigating = false;
            if (navToggleBtn) {
                navToggleBtn.textContent = 'Go';
                navToggleBtn.className = 'nav-btn go';
            }
        }
    }
});

let analyticsData = {};
let analyticsCharts = {};
const metricsConfig = {
    ping: { label: 'Ping', unit: 'ms', color: '#22c55e' },
    tps: { label: 'TPS', unit: '', color: '#f97316', max: 20 },
    position: { label: 'Spatial Heatmap', color: '#3b82f6', isHeatmap: true },
    network: { label: 'Network', unit: 'KB/s', color: '#60a5fa', isObjectData: true },
    cpu: { label: 'CPU Usage', unit: '%', color: '#a855f7', max: 100 },
    ram: { label: 'RAM Usage', unit: 'MB', color: '#ec4899' },
    events: { label: 'In-Game Events', unit: '', color: '#eab308', isEventsData: true }
};

socket.on('analyticsHistory', (data) => {
    if (currentBot !== data.username) return;
    analyticsData = data.history;
    if (document.getElementById('analyticsPane').classList.contains('active')) {
        renderAnalyticsCards();
        updateAnalyticsGraphs();
    }
});

socket.on('analyticsUpdate', (data) => {
    if (currentBot !== data.username) return;

    const timestamp = data.stat.timestamp;
    const metrics = Object.keys(data.stat).filter(k => k !== 'timestamp');

    metrics.forEach(key => {
        const val = data.stat[key];
        if (!analyticsData[key]) analyticsData[key] = [];
        analyticsData[key].push({ t: timestamp, v: val });
        // Keep 24 hours of data capped at 43200 points
        if (analyticsData[key].length > 3600) analyticsData[key].shift();
    });

    if (!document.getElementById('analyticsPane').classList.contains('active')) return;

    if (!window._lastGraphUpdate || Date.now() - window._lastGraphUpdate > 1000) {
        updateAnalyticsGraphs();
        window._lastGraphUpdate = Date.now();
    }
});

function renderAnalyticsCards() {
    const chartsGrid = document.getElementById('analyticsChartsGrid');
    const metrics = Object.keys(metricsConfig);

    metrics.forEach(key => {
        const config = metricsConfig[key];

        let card = document.getElementById(`metric-card-${key}`);
        if (!card) {
            card = document.createElement('div');
            card.id = `metric-card-${key}`;
            card.className = 'metric-card';
            card.style.cssText = 'background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; height: 260px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: baseline;">
                    <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">${config.label}</div>
                    <div class="stat-value" id="stat-val-${key}" style="font-size: 1.1rem; font-weight: bold; color: ${config.color};">${config.isHeatmap ? '' : '--'}</div>
                </div>
                <div style="flex: 1; position: relative; min-height: 0;">
                    ${config.isHeatmap ?
                        `<canvas id="heatmapCanvas" style="width: 100%; height: 100%; display: block;"></canvas>
                         <div id="heatmapOverlayText" style="position: absolute; bottom: 8px; right: 8px; font-size: 0.75rem; color: var(--text-muted); background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px;">Waiting for position data</div>` :
                        `<canvas id="chart-${key}"></canvas>`}
                </div>
            `;
            chartsGrid.appendChild(card);

            // Use a dummy entry for heatmap to ensure loop coverage but skip Chart.js init
            if (config.isHeatmap) {
                analyticsCharts[key] = null;
                return;
            }

            const ctx = document.getElementById(`chart-${key}`).getContext('2d');
            let chartConfig;

            if (config.isObjectData) {
                chartConfig = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [
                            { label: 'RX', data: [], borderColor: '#34d399', borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0, pointHoverRadius: 4 },
                            { label: 'TX', data: [], borderColor: '#fbbf24', borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0, pointHoverRadius: 4 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10, bottom: 5, left: 5, right: 15 } }, plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } }, scales: { x: { display: false }, y: { beginAtZero: true, max: config.max, grace: '10%', ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 9 }, callback: (val) => val + (config.unit ? config.unit : '') }, grid: { color: 'rgba(255,255,255,0.05)', drawTicks: false } } } }
                };
            } else if (config.isEventsData) {
                chartConfig = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [
                            { label: 'Kills', data: [], borderColor: '#ef4444', borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0, pointHoverRadius: 4 },
                            { label: 'Deaths', data: [], borderColor: '#64748b', borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0, pointHoverRadius: 4 },
                            { label: 'Collected', data: [], borderColor: '#3b82f6', borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0, pointHoverRadius: 4 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10, bottom: 5, left: 5, right: 15 } }, plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } }, scales: { x: { display: false }, y: { beginAtZero: true, grace: '10%', ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 9 }, callback: (val) => val + (config.unit ? config.unit : '') }, grid: { color: 'rgba(255,255,255,0.05)', drawTicks: false } } } }
                };
            } else {
                chartConfig = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{ data: [], borderColor: config.color, borderWidth: 2, fill: true, backgroundColor: config.color + '22', tension: 0.4, pointRadius: 0, pointHoverRadius: 4 }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10, bottom: 5, left: 5, right: 15 } }, plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } }, scales: { x: { display: false }, y: { beginAtZero: true, max: config.max, grace: '10%', ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 9 }, callback: (val) => val + (config.unit ? config.unit : '') }, grid: { color: 'rgba(255,255,255,0.05)', drawTicks: false } } } }
                };
            }
            analyticsCharts[key] = new Chart(ctx, chartConfig);
        }

        const dataArray = analyticsData[key] || [];
        if (dataArray.length > 0) {
            const val = dataArray[dataArray.length - 1].v;
            const statValEl = document.getElementById(`stat-val-${key}`);
            if (config.isHeatmap) {
                statValEl.innerText = '';
            } else if (config.isObjectData && val) {
                statValEl.innerText = `в†“ ${val.rx} в†‘ ${val.tx} ${config.unit}`;
            } else if (config.isEventsData && val) {
                statValEl.innerText = `${val.kills}K ${val.deaths}D ${val.itemsCollected}C`;
            } else {
                statValEl.innerText = `${typeof val === 'number' ? val.toFixed(key === 'tps' ? 1 : 0) : val}${config.unit}`;
            }
        }
    });
}

const timeRangeSelect = document.getElementById('analyticsTimeRange');
if (timeRangeSelect) {
    timeRangeSelect.addEventListener('change', () => updateAnalyticsGraphs());
}


function updateAnalyticsGraphs() {
    renderAnalyticsCards();

    const timeRangeSelect = document.getElementById('analyticsTimeRange');
    const rangeSeconds = timeRangeSelect ? parseInt(timeRangeSelect.value) : 300;
    const minTime = Date.now() - (rangeSeconds * 1000);

    Object.keys(analyticsCharts).forEach(key => {
        const chart = analyticsCharts[key];
        let data = analyticsData[key] || [];
        const config = metricsConfig[key];
        if (!config || !data.length) return;

        data = data.filter(d => d.t >= minTime);

        // Downsample if dataset is too large (more than 150 points is crowded for a sparkline)
        if (data.length > 150) {
            const step = Math.ceil(data.length / 150);
            data = data.filter((_, i) => i % step === 0);
        }
        if (key === 'position') {
            drawHeatmap(data);
            return;
        }

        chart.data.labels = data.map(d => new Date(d.t).toLocaleTimeString());

        if (config.isObjectData) {
            chart.data.datasets[0].data = data.map(d => d.v.rx);
            chart.data.datasets[1].data = data.map(d => d.v.tx);
        } else if (config.isEventsData) {
            chart.data.datasets[0].data = data.map(d => d.v.kills);
            chart.data.datasets[1].data = data.map(d => d.v.deaths);
            chart.data.datasets[2].data = data.map(d => d.v.itemsCollected);
        } else {
            chart.data.datasets[0].data = data.map(d => d.v);
        }

        chart.update('none');
    });
}

function drawHeatmap(dataArray) {
    const canvas = document.getElementById('heatmapCanvas');
    if (!canvas || !dataArray || dataArray.length === 0) return;
    const ctx = canvas.getContext('2d');

    // Resize canvas for sharp rendering based on container
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    dataArray.forEach(d => {
        if (!d.v) return;
        const x = d.v.x;
        const z = d.v.z;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    });

    if (minX === Infinity) {
        const overlay = document.getElementById('heatmapOverlayText');
        if (overlay) overlay.innerText = 'Waiting for position data';
        return;
    }

    const padding = 30;
    const rangeX = Math.max(maxX - minX, 10);
    const rangeZ = Math.max(maxZ - minZ, 10);

    const scaleX = (canvas.width - padding * 2) / rangeX;
    const scaleZ = (canvas.height - padding * 2) / rangeZ;
    const scale = Math.min(scaleX, scaleZ);

    const mapWidth = rangeX * scale;
    const mapHeight = rangeZ * scale;
    const offsetX = (canvas.width - mapWidth) / 2 - (minX * scale);
    const offsetZ = (canvas.height - mapHeight) / 2 - (minZ * scale);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();

    let started = false;
    dataArray.forEach((d) => {
        if (!d.v) return;
        const cx = offsetX + d.v.x * scale;
        const cz = offsetZ + d.v.z * scale;

        if (!started) {
            ctx.moveTo(cx, cz);
            started = true;
        } else {
            ctx.lineTo(cx, cz);
        }
    });
    ctx.stroke();

    dataArray.forEach((d) => {
        if (!d.v) return;
        const cx = offsetX + d.v.x * scale;
        const cz = offsetZ + d.v.z * scale;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.beginPath();
        ctx.arc(cx, cz, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    const overlay = document.getElementById('heatmapOverlayText');
    if (overlay) {
        overlay.innerText = `Bounds X:[${minX.toFixed(0)}, ${maxX.toFixed(0)}] Z:[${minZ.toFixed(0)}, ${maxZ.toFixed(0)}]`;
    }
}

const exportAnalyticsBtn = document.getElementById('exportAnalyticsBtn');
if (exportAnalyticsBtn) {
    exportAnalyticsBtn.onclick = () => {
        if (!analyticsData.ping || analyticsData.ping.length === 0) {
            showNotification('No data to export', 'error');
            return;
        }


        const metrics = Object.keys(analyticsData);
        let csv = `Timestamp,${metrics.join(',')}\n`;


        let maxLen = 0;
        metrics.forEach(m => {
            if (analyticsData[m].length > maxLen) maxLen = analyticsData[m].length;
        });

        for (let i = 0; i < maxLen; i++) {

            let timestamp = '';
            for (const m of metrics) {
                if (analyticsData[m][i]) {
                    timestamp = new Date(analyticsData[m][i].t).toISOString();
                    break;
                }
            }

            let row = `${timestamp}`;
            metrics.forEach(m => {
                const val = analyticsData[m][i] ? analyticsData[m][i].v : '';
                row += `,${val}`;
            });
            csv += row + '\n';
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analytics_${currentBot}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification('Analytics exported!', 'success');
    };
}

const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsForm = document.getElementById('settingsForm');
const settingReconnectDelay = document.getElementById('settingReconnectDelay');
const settingGlobalAnalytics = document.getElementById('settingGlobalAnalytics');
const settingDashboardFont = document.getElementById('settingDashboardFont');

if (settingsBtn) {
    settingsBtn.onclick = () => {
        settingsModal.classList.add('active');
    };
}

if (closeSettingsBtn) {
    closeSettingsBtn.onclick = () => {
        settingsModal.classList.remove('active');
    };
}

if (settingsForm) {
    settingsForm.onsubmit = (e) => {
        e.preventDefault();
        const delay = parseInt(settingReconnectDelay.value);
        const lowPerf = document.getElementById('settingLowPerformance').checked;
        const proxyListText = document.getElementById('settingProxyList') ? document.getElementById('settingProxyList').value : '';
        const randomProxy = document.getElementById('settingRandomProxy') ? document.getElementById('settingRandomProxy').checked : false;
        const autoAuthRegister = document.getElementById('settingAutoAuthRegister') ? document.getElementById('settingAutoAuthRegister').value : '';
        const autoAuthLogin = document.getElementById('settingAutoAuthLogin') ? document.getElementById('settingAutoAuthLogin').value : '';
        const globalAnalytics = document.getElementById('settingGlobalAnalytics') ? document.getElementById('settingGlobalAnalytics').checked : false;

        const updates = {};

        const font = document.getElementById('settingDashboardFont').value;
        if (font) updates.dashboardFont = font;

        if (!isNaN(delay)) updates.reconnectDelay = delay;
        updates.lowPerformanceMode = lowPerf;
        updates.proxyList = proxyListText;
        updates.randomProxy = randomProxy;
        if (autoAuthRegister !== '') updates.autoAuthRegister = autoAuthRegister;
        if (autoAuthLogin !== '') updates.autoAuthLogin = autoAuthLogin;
        updates.globalAnalytics = globalAnalytics;

        const globalFriendsInput = document.getElementById('settingGlobalFriends');
        if (globalFriendsInput) {
            updates.globalFriends = globalFriendsInput.value.split(',').map(s => s.trim()).filter(Boolean);
        }

        if (Object.keys(updates).length > 0) {
            socket.emit('saveSettings', updates);
            settingsModal.classList.remove('active');
            showNotification('Global settings saved!', 'success');
        }
    };
}

socket.on('settings', (settings) => {
    if (settingReconnectDelay) settingReconnectDelay.value = settings.reconnectDelay || 5000;
    if (settingGlobalAnalytics) settingGlobalAnalytics.checked = settings.globalAnalytics !== false;
    if (settingDashboardFont) {
        document.documentElement.style.setProperty('--dashboard-font', settings.dashboardFont || "'Comfortaa', cursive");
        settingDashboardFont.value = settings.dashboardFont || "'Comfortaa', cursive";
    }
    if (settings && settings.lowPerformanceMode !== undefined) {
        const lowPerfCheckbox = document.getElementById('settingLowPerformance');
        if (lowPerfCheckbox) lowPerfCheckbox.checked = settings.lowPerformanceMode;
        if (settings.lowPerformanceMode) {
            document.body.classList.add('low-perf');
            lowPerformanceEnabled = true;
        } else {
            document.body.classList.remove('low-perf');
            lowPerformanceEnabled = false;
        }
    }
    if (settings && settings.proxyList !== undefined) {
        const proxyListEl = document.getElementById('settingProxyList');
        if (proxyListEl) {
            proxyListEl.value = settings.proxyList;
            updateProxyCount();
        }
    }

    function updateProxyCount() {
        const textarea = document.getElementById('settingProxyList');
        const display = document.getElementById('proxyCount');
        if (!textarea || !display) return;
        
        const text = textarea.value.trim();
        if (!text) {
            display.innerText = '(0 proxies)';
            return;
        }
        const proxies = text.split(/\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
        display.innerText = `(${proxies.length} proxies)`;
    }

    const globalProxyListEl = document.getElementById('settingProxyList');
    if (globalProxyListEl) {
        globalProxyListEl.addEventListener('input', updateProxyCount);
    }
    if (settings && settings.globalFriends !== undefined) {
        const friendsEl = document.getElementById('settingGlobalFriends');
        if (friendsEl) friendsEl.value = settings.globalFriends.join(', ');
    }
    if (settings && settings.autoAuthRegister !== undefined) {
        const autoAuthRegEl = document.getElementById('settingAutoAuthRegister');
        if (autoAuthRegEl) autoAuthRegEl.value = settings.autoAuthRegister;
    }
    if (settings && settings.autoAuthLogin !== undefined) {
        const autoAuthLogEl = document.getElementById('settingAutoAuthLogin');
        if (autoAuthLogEl) autoAuthLogEl.value = settings.autoAuthLogin;
    }
    if (settings && settings.randomProxy !== undefined) {
        const randomProxyEl = document.getElementById('settingRandomProxy');
        if (randomProxyEl) randomProxyEl.checked = settings.randomProxy;
    }
    if (settings && settings.watchlist) {
        watchlist = settings.watchlist;
        renderWatchlist();
    }
});

const bulkSelectAll = document.getElementById('bulkSelectAll');
const bulkDeselectAll = document.getElementById('bulkDeselectAll');
const bulkNavBtn = document.getElementById('bulkNavBtn');
const bulkChatBtn = document.getElementById('bulkChatBtn');
const bulkSpammerToggleBtn = document.getElementById('bulkSpammerToggleBtn');
const bulkReconnectBtn = document.getElementById('bulkReconnectBtn');
const bulkDisconnectBtn = document.getElementById('bulkDisconnectBtn');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

if (bulkSelectAll) {
    bulkSelectAll.onclick = () => {
        bots.forEach(bot => selectedBots.add(bot.username));
        document.querySelectorAll('.bot-item').forEach(item => item.classList.add('selected'));
        updateSelectedCount();
    };
}

if (bulkDeselectAll) {
    bulkDeselectAll.onclick = () => {
        selectedBots.clear();
        document.querySelectorAll('.bot-item').forEach(item => item.classList.remove('selected'));
        updateSelectedCount();
    };
}

if (bulkNavBtn) {
    bulkNavBtn.onclick = () => {
        if (selectedBots.size === 0) return showNotification('No bots selected', 'error');
        const x = parseFloat(document.getElementById('bulkNavX').value);
        const y = parseFloat(document.getElementById('bulkNavY').value);
        const z = parseFloat(document.getElementById('bulkNavZ').value);

        if (isNaN(x) || isNaN(y) || isNaN(z)) return showNotification('Invalid coordinates', 'error');

        socket.emit('bulkAction', {
            usernames: Array.from(selectedBots),
            action: 'move',
            payload: { x, y, z }
        });
        showNotification(`Bulk move sent to ${selectedBots.size} bots`, 'info');
    };
}

if (bulkReconnectBtn) {
    bulkReconnectBtn.onclick = () => {
        if (selectedBots.size === 0) return showNotification('No bots selected', 'error');
        socket.emit('bulkAction', { usernames: Array.from(selectedBots), action: 'rejoin' });
    };
}

if (bulkDisconnectBtn) {
    bulkDisconnectBtn.onclick = () => {
        if (selectedBots.size === 0) return showNotification('No bots selected', 'error');
        if (confirm(`Disconnect ${selectedBots.size} bots?`)) {
            socket.emit('bulkAction', { usernames: Array.from(selectedBots), action: 'stop' });
        }
    };
}

if (bulkDeleteBtn) {
    bulkDeleteBtn.onclick = () => {
        if (selectedBots.size === 0) return showNotification('No bots selected', 'error');
        if (confirm(`PERMANENTLY DELETE ${selectedBots.size} bots? This cannot be undone.`)) {
            socket.emit('bulkDelete', Array.from(selectedBots));
            selectedBots.clear();
            updateSelectedCount();
            document.querySelectorAll('.bot-item.selected').forEach(el => el.classList.remove('selected'));
        }
    };
}

if (bulkChatBtn) {
    bulkChatBtn.onclick = () => {
        if (selectedBots.size === 0) return showNotification('No bots selected', 'error');
        const msg = document.getElementById('bulkChatInput').value;
        if (!msg) return showNotification('Message cannot be empty', 'warning');

        socket.emit('bulkAction', { usernames: Array.from(selectedBots), action: 'chat', payload: { message: msg } });
        document.getElementById('bulkChatInput').value = '';
        showNotification(`Bulk chat sent to ${selectedBots.size} bots`, 'info');
    };
}

const bulkSequentialChatBtn = document.getElementById('bulkSequentialChatBtn');
if (bulkSequentialChatBtn) {
    bulkSequentialChatBtn.onclick = () => {
        if (selectedBots.size === 0) return showNotification('No bots selected', 'error');
        const msg = document.getElementById('bulkSequentialChatInput').value.trim();
        if (!msg) return showNotification('Message cannot be empty', 'warning');

        socket.emit('bulkSequentialChat', {
            usernames: Array.from(selectedBots),
            message: msg
        });
        document.getElementById('bulkSequentialChatInput').value = '';
        showNotification(`Sequential chat chain started with ${selectedBots.size} bots`, 'info');
    };
}

if (bulkSpammerToggleBtn) {
    bulkSpammerToggleBtn.onclick = () => {
        if (selectedBots.size === 0) return showNotification('No bots selected', 'error');

        socket.emit('bulkAction', { usernames: Array.from(selectedBots), action: 'toggleSpammer' });
        showNotification(`Toggled spammer for ${selectedBots.size} bots`, 'info');
    };
}

socket.on('botRemoved', (username) => {
    selectedBots.delete(username);
    updateSelectedCount();
});

// Password Visibility Toggle
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-password-btn');
    if (!btn) return;

    e.preventDefault();
    const wrapper = btn.closest('.password-input-wrapper');
    const input = wrapper.querySelector('input');
    const eyeIcon = btn.querySelector('.eye-icon');
    const eyeOffIcon = btn.querySelector('.eye-off-icon');

    if (input.type === 'password') {
        input.type = 'text';
        eyeIcon.style.display = 'none';
        eyeOffIcon.style.display = 'block';
    } else {
        input.type = 'password';
        eyeIcon.style.display = 'block';
        eyeOffIcon.style.display = 'none';
    }
});


// Proxy Tools Management
const checkProxiesBtn = document.getElementById('checkProxiesBtn');
const scrapeProxiesBtn = document.getElementById('scrapeProxiesBtn');
const filterDeadProxiesBtn = document.getElementById('filterDeadProxiesBtn');
const proxyListTextarea = document.getElementById('settingProxyList');

let lastProxyCheckResults = [];
let isCheckingProxies = false;
let validProxyCount = 0;

if (checkProxiesBtn) {
    checkProxiesBtn.onclick = (e) => {
        try {
            e.preventDefault();
            const textarea = document.getElementById('settingProxyList');
            if (!textarea) return showNotification('Internal Error: Proxy List textarea not found.', 'error');

            if (isCheckingProxies) {
                socket.emit('botAction', { action: 'stopCheckProxies' });
                isCheckingProxies = false;
                checkProxiesBtn.disabled = false;
                checkProxiesBtn.innerText = 'Check Status';
                return;
            }
            const text = textarea.value.trim();
            const rawProxies = text.split(/\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
            const proxies = [];
            for (const p of rawProxies) {
                if (p.includes('://')) {
                    proxies.push(p);
                } else {
                    const parts = p.split(':');
                    if (parts.length === 4) {
                        proxies.push(`socks5://${encodeURIComponent(parts[2])}:${encodeURIComponent(parts[3])}@${parts[0]}:${parts[1]}`);
                    } else if (parts.length === 2) {
                        proxies.push(`socks5://${parts[0]}:${parts[1]}`);
                    }
                }
            }
            
            if (proxies.length === 0) {
                return showNotification('No valid proxies found in list.', 'warning');
            }

            isCheckingProxies = true;
            validProxyCount = 0;
            checkProxiesBtn.innerText = 'Checking...';
            socket.emit('botAction', { 
                action: 'checkProxies', 
                payload: { proxies }
            });
            showNotification(`Checking status of ${proxies.length} proxies...`, 'info');
        } catch (err) {
            console.error('Proxy check button error:', err);
            showNotification('An error occurred while starting the check.', 'error');
        }
    };
}

socket.on('proxyCheckProgress', (progress) => {
    if (progress.lastResult && progress.lastResult.status === 'online') {
        validProxyCount++;
    }
    checkProxiesBtn.innerText = `Stop Check (${progress.current}/${progress.total}) - Valid: ${validProxyCount}`;
});

socket.on('proxyCheckResults', (results) => {
    lastProxyCheckResults = results;
    isCheckingProxies = false;
    const onlineProxies = results.filter(r => r.status === 'online').map(r => r.url);
    const deadCount = results.length - onlineProxies.length;
    
    checkProxiesBtn.disabled = false;
    checkProxiesBtn.innerText = 'Check Status';
    
    if (deadCount > 0) {
        proxyListTextarea.value = onlineProxies.join('\n');
        showNotification(`Check Finished: ${onlineProxies.length} Online. Auto-removed ${deadCount} dead proxies!`, onlineProxies.length > 0 ? 'success' : 'warning');
        
        // Auto-save the pristine list
        socket.emit('saveSettings', { proxyList: onlineProxies.join('\n') });
        
        filterDeadProxiesBtn.style.display = 'none';
        lastProxyCheckResults = [];
    } else {
        showNotification(`Check Finished: All ${onlineProxies.length} proxies are Online!`, 'success');
        filterDeadProxiesBtn.style.display = 'none';
    }
});

if (scrapeProxiesBtn) {
    scrapeProxiesBtn.onclick = (e) => {
        e.preventDefault();
        scrapeProxiesBtn.disabled = true;
        scrapeProxiesBtn.innerText = 'Scraping...';
        socket.emit('botAction', { action: 'scrapeProxies' });
        showNotification('Scraping free proxies from online sources...', 'info');
    };
}

socket.on('proxyScrapeProgress', (progress) => {
    if (progress.status === 'scraping') {
        scrapeProxiesBtn.innerText = `Scraping ${progress.source.toUpperCase()}...`;
    } else if (progress.status === 'completed') {
        showNotification(`Found ${progress.count} ${progress.source.toUpperCase()} proxies. Total: ${progress.totalSoFar}`, 'success');
    } else if (progress.status === 'failed') {
        showNotification(`Failed to scrape ${progress.source.toUpperCase()}: ${progress.error}`, 'error');
    }
});

socket.on('proxyScrapeResults', (proxies) => {
    scrapeProxiesBtn.disabled = false;
    scrapeProxiesBtn.innerText = 'Scrape Free';

    if (proxies.length > 0) {
        const currentText = proxyListTextarea.value.trim();
        proxyListTextarea.value = (currentText ? currentText + '\n' : '') + proxies.join('\n');
        showNotification(`Successfully scraped ${proxies.length} proxies!`, 'success');
    } else {
        showNotification('Failed to scrape any new proxies.', 'error');
    }
});

if (filterDeadProxiesBtn) {
    filterDeadProxiesBtn.onclick = (e) => {
        e.preventDefault();
        if (lastProxyCheckResults.length === 0) return;
        
        const workingProxies = lastProxyCheckResults
            .filter(r => r.status === 'online')
            .map(r => r.url);
            
        proxyListTextarea.value = workingProxies.join('\n');
        filterDeadProxiesBtn.style.display = 'none';
        showNotification(`${lastProxyCheckResults.length - workingProxies.length} dead proxies removed from list.`, 'success');
        lastProxyCheckResults = [];
    };
}
