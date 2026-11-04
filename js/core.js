/**************************************************************************
 * 1. QUẢN LÝ TRẠNG THÁI TOÀN CỤC & BỘ ĐIỀU PHỐI TUA NHANH (FAST FORWARD)
 **************************************************************************/
const FF_MODE = 'retroarch';

/* ===== TẮT/BẬT TIẾNG THẬT: mọi âm thanh đi vào loa đều chạy qua 1 GainNode điều khiển được ===== */
let EMU_MUTED = false;
const _emuGainNodes = [];
function setEmuAudioMuted(muted) {
    EMU_MUTED = !!muted;
    _emuGainNodes.forEach(g => { try { g.gain.value = EMU_MUTED ? 0 : 1; } catch (e) {} });
}
(function installAudioMuteHook() {
    try {
        if (typeof AudioNode === 'undefined' || typeof AudioDestinationNode === 'undefined') return;
        const origConnect = AudioNode.prototype.connect;
        const origDisconnect = AudioNode.prototype.disconnect;
        const gainOf = new WeakMap();
        function getGain(ctx, dest) {
            let g = gainOf.get(ctx);
            if (!g) {
                g = ctx.createGain();
                g.__isMuteGain = true;
                g.gain.value = EMU_MUTED ? 0 : 1;
                origConnect.call(g, dest);
                gainOf.set(ctx, g);
                _emuGainNodes.push(g);
            }
            return g;
        }
        AudioNode.prototype.connect = function (dest, ...rest) {
            if (dest instanceof AudioDestinationNode && !this.__isMuteGain) {
                origConnect.call(this, getGain(dest.context, dest), ...rest);
                return dest;
            }
            return origConnect.call(this, dest, ...rest);
        };
        AudioNode.prototype.disconnect = function (dest, ...rest) {
            if (dest instanceof AudioDestinationNode && gainOf.has(dest.context)) {
                try { return origDisconnect.call(this, gainOf.get(dest.context), ...rest); } catch (e) { return; }
            }
            return origDisconnect.call(this, dest, ...rest);
        };
    } catch (e) {}
})();

/* Làm "tỉnh" màn hình giả lập ở lần mở game đầu tiên (tránh màn hình trắng) */
function kickEmulatorDisplay() {
    const nl = AppState.nostalgistInstance;
    if (!nl) return;
    
    // Ép khởi động lại AudioContext trên iOS Safari
    try {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } catch (e) {}

    [200, 700, 1500].forEach(t => setTimeout(() => {
        try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    }, t));
    setTimeout(() => {
        if (AppState.nostalgistInstance !== nl || AppState.isPaused) return;
        try { nl.pause(); } catch (e) {}
        setTimeout(() => {
            if (AppState.nostalgistInstance !== nl || AppState.isPaused) return;
            try { nl.resume(); } catch (e) {}
        }, 150);
    }, 500);
}
const GBA_BUTTONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'L', 'R', 'START', 'SELECT'];
const DEFAULT_COVER_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Crect width='240' height='240' fill='%23222'/%3E%3C/svg%3E";

const AppState = {
    romLoaded: false,
    isPaused: false,
    fastForwardSpeed: 1,
    hapticEnabled: true,
    retroFastForwardActive: false,
    isMuted: false,
    activeCoreMode: 'STANDBY',
    nostalgistInstance: null,
    currentView: 'dashboard',
    touchControlsVisible: true,
    currentFilter: 'integer',
    lcdGridEnabled: false,
    lastCapturedFrameDataUrl: '',
    sramRomId: null,
    menuWasRunning: false,
    autoResumePending: false,
    isEditingTouchLayout: false,
    layoutEditOriginView: 'dashboard',
    selectedLayoutControlId: null,

    currentRom: {
        id: null,
        fileName: '',
        title: 'CHƯA NẠP ROM',
        gameCode: '----',
        makerCode: '--',
        saveType: 'Tự động',
        checksumValid: false,
        checksumHex: '--',
        sizeBytes: 0,
        buffer: null
    },

    buttonStates: {
        UP: false, DOWN: false, LEFT: false, RIGHT: false,
        A: false, B: false, L: false, R: false, START: false, SELECT: false
    },
    heldButtons: {
        UP: false, DOWN: false, LEFT: false, RIGHT: false,
        A: false, B: false, L: false, R: false, START: false, SELECT: false
    },
    isSelectingHoldButton: false,

    cheats: [],
    parsedRawCheats: [],

    keyMap: {
        UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
        A: 'KeyX', B: 'KeyZ', L: 'KeyQ', R: 'KeyE', START: 'Enter', SELECT: 'ShiftRight'
    },
    altKeyMap: {
        UP: 'KeyW', DOWN: 'KeyS', LEFT: 'KeyA', RIGHT: 'KeyD',
        A: 'KeyL', B: 'KeyK', L: 'KeyU', R: 'KeyI', SELECT: 'ShiftLeft'
    },
    gamepadMap: {
        B: 0, A: 1, SELECT: 8, START: 9, L: 4, R: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15
    },
    remappingTarget: null,
    lastGamepadState: {}
};

// 1b. Tính toán k (hệ số phóng nguyên tỷ lệ) và cập nhật CSS var --gba-stage-w, --lcd-cell
function updateIntegerScaleStage() {
    try {
        const wrap = document.getElementById('gba-screen-wrapper');
        const backdrop = document.getElementById('layout-preview-backdrop');
        const targets = [wrap, backdrop].filter(Boolean);
        if (targets.length === 0) return;

        const isPortrait = window.innerHeight > window.innerWidth;
        const w = window.innerWidth;
        const h = window.innerHeight;

        targets.forEach(el => {
            el.style.width = '';
            el.style.height = '';
            el.style.maxWidth = '';
            el.style.maxHeight = '';
        });

        if (isPortrait) {
            const stageW = Math.min(w, 540);
            document.documentElement.style.setProperty('--gba-stage-w', `${stageW}px`);
            document.documentElement.style.setProperty('--lcd-cell', `${stageW / 240}px`);
        } else {
            const stageW = Math.min(w, h * 1.5);
            document.documentElement.style.setProperty('--gba-stage-w', `${stageW}px`);
            document.documentElement.style.setProperty('--lcd-cell', `${stageW / 240}px`);
        }
    } catch (e) {}
}

window.addEventListener('resize', updateIntegerScaleStage);
window.addEventListener('orientationchange', () => setTimeout(updateIntegerScaleStage, 150));

const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
let debugEmscriptenFrames = 0;
const isDebugMode = (typeof window !== 'undefined' && typeof window.location !== 'undefined')
    ? (new URLSearchParams(window.location.search).get('debug') === '1')
    : false;

if (isDebugMode) {
    setInterval(() => {
        const badge = document.getElementById('hud-debug-fps');
        if (badge) {
            badge.classList.remove('hidden');
            badge.textContent = `Khung giả lập/giây: ${debugEmscriptenFrames}`;
        }
        debugEmscriptenFrames = 0;
    }, 1000);
}

(function setupFastForwardRAFInterceptor() {
    let inSubStep = false;
    let queuedEmscriptenCb = null;

    window.requestAnimationFrame = function (cb) {
        if (typeof mainEmulatorLoop === 'function' && cb === mainEmulatorLoop) {
            return nativeRequestAnimationFrame(cb);
        }
        if (inSubStep) {
            queuedEmscriptenCb = cb;
            return 0;
        }
        return nativeRequestAnimationFrame(function (timestamp) {
            const mult = (FF_MODE === 'raf' && !AppState.isPaused && AppState.romLoaded && AppState.fastForwardSpeed > 1)
                ? AppState.fastForwardSpeed
                : 1;

            if (mult <= 1) {
                if (isDebugMode) debugEmscriptenFrames++;
                cb(timestamp);
                return;
            }

            inSubStep = true;
            queuedEmscriptenCb = cb;
            const t0 = performance.now();

            for (let step = 0; step < mult; step++) {
                const fn = queuedEmscriptenCb;
                if (!fn) break;
                queuedEmscriptenCb = null;
                try {
                    if (isDebugMode) debugEmscriptenFrames++;
                    fn(timestamp + step * 16.667);
                } catch (err) {
                    console.warn('FastForward step error:', err);
                    break;
                }
                if (performance.now() - t0 > 16) break;
            }

            inSubStep = false;
            if (queuedEmscriptenCb) {
                const finalCb = queuedEmscriptenCb;
                queuedEmscriptenCb = null;
                window.requestAnimationFrame(finalCb);
            }
        });
    };
})();

/**************************************************************************
 * 1B. POPUP XÁC NHẬN KÍNH MỜ (THAY THẾ HOÀN TOÀN WINDOW.CONFIRM)
 **************************************************************************/
let glassConfirmResolver = null;

function showGlassConfirm({
    title = 'Xác nhận',
    message = 'Bạn có chắc chắn muốn thực hiện thao tác này?',
    confirmText = 'Xác nhận',
    cancelText = 'Hủy',
    danger = true
} = {}) {
    return new Promise((resolve) => {
        glassConfirmResolver = resolve;
        const tEl = document.getElementById('glass-confirm-title');
        const mEl = document.getElementById('glass-confirm-message');
        if (tEl) tEl.textContent = title;
        if (mEl) mEl.textContent = message;

        const cancelBtn = document.getElementById('glass-confirm-cancel-btn');
        const okBtn = document.getElementById('glass-confirm-ok-btn');
        const iconWrap = document.getElementById('glass-confirm-icon-wrap');
        const iconEl = document.getElementById('glass-confirm-icon');

        if (cancelBtn) cancelBtn.textContent = cancelText;
        if (okBtn) okBtn.textContent = confirmText;

        if (danger) {
            if (okBtn) okBtn.className = 'px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-400/35 text-xs font-extrabold text-red-200 transition';
            if (iconWrap) iconWrap.className = 'w-10 h-10 rounded-2xl bg-red-500/15 border border-red-400/30 flex items-center justify-center shrink-0 text-red-300';
            if (iconEl) iconEl.className = 'fa-solid fa-triangle-exclamation text-base';
        } else {
            if (okBtn) okBtn.className = 'px-4 py-2 rounded-xl bg-white hover:bg-white/90 text-xs font-extrabold text-black transition';
            if (iconWrap) iconWrap.className = 'w-10 h-10 rounded-2xl bg-white/10 border border-white/25 flex items-center justify-center shrink-0 text-white';
            if (iconEl) iconEl.className = 'fa-solid fa-circle-question text-base';
        }

        const modal = document.getElementById('glass-confirm-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    });
}

function resolveGlassConfirm(result) {
    const modal = document.getElementById('glass-confirm-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (typeof glassConfirmResolver === 'function') {
        const fn = glassConfirmResolver;
        glassConfirmResolver = null;
        fn(!!result);
    }
}

/**************************************************************************
 * 2. HỆ THỐNG LƯU TRỮ INDEXEDDB (TÁCH RIÊNG ROM_META VÀ ROM_DATA)
 **************************************************************************/
const DB_NAME = 'DeltaGBA_Emulator_DB';
const DB_VERSION = 4;
let dbInstance = null;

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            const tx = e.target.transaction;

            if (!db.objectStoreNames.contains('rom_meta')) {
                db.createObjectStore('rom_meta', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('rom_data')) {
                db.createObjectStore('rom_data', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('savestates')) {
                const ssStore = db.createObjectStore('savestates', { keyPath: 'slotKey' });
                ssStore.createIndex('romId', 'romId', { unique: false });
            } else {
                const ssStore = tx.objectStore('savestates');
                if (!ssStore.indexNames.contains('romId')) {
                    ssStore.createIndex('romId', 'romId', { unique: false });
                }
            }
            if (!db.objectStoreNames.contains('cheats')) {
                db.createObjectStore('cheats', { keyPath: 'romId' });
            }
            if (!db.objectStoreNames.contains('sram')) {
                db.createObjectStore('sram', { keyPath: 'romId' });
            }

            if (db.objectStoreNames.contains('roms')) {
                const oldStore = tx.objectStore('roms');
                const metaStore = tx.objectStore('rom_meta');
                const dataStore = tx.objectStore('rom_data');
                const getAllReq = oldStore.getAll();
                getAllReq.onsuccess = () => {
                    const oldRecords = getAllReq.result || [];
                    for (const rec of oldRecords) {
                        const { buffer, ...metaOnly } = rec;
                        metaStore.put(metaOnly);
                        if (buffer) {
                            dataStore.put({ id: rec.id, buffer });
                        }
                    }
                    try { db.deleteObjectStore('roms'); } catch (_) {}
                };
            }
        };
        request.onsuccess = (e) => {
            dbInstance = e.target.result;
            resolve(dbInstance);
        };
        request.onerror = (err) => reject(err);
    });
}

async function saveRomMetaToDB(metaRecord) {
    if (!dbInstance) await initIndexedDB();
    const { buffer, ...cleanMeta } = metaRecord;
    return new Promise((resolve, reject) => {
        const tx = dbInstance.transaction('rom_meta', 'readwrite');
        tx.objectStore('rom_meta').put(cleanMeta);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function saveRomDataToDB(id, buffer) {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = dbInstance.transaction('rom_data', 'readwrite');
        tx.objectStore('rom_data').put({ id, buffer });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function getRomMetaById(id) {
    if (!dbInstance) await initIndexedDB();
    if (!id) return null;
    return new Promise((resolve) => {
        const tx = dbInstance.transaction('rom_meta', 'readonly');
        const req = tx.objectStore('rom_meta').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

async function getAllRomMetasFromDB() {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve) => {
        const tx = dbInstance.transaction('rom_meta', 'readonly');
        const req = tx.objectStore('rom_meta').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
    });
}

async function getRomDataFromDB(id) {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve) => {
        const tx = dbInstance.transaction('rom_data', 'readonly');
        const req = tx.objectStore('rom_data').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.buffer : null);
        req.onerror = () => resolve(null);
    });
}

async function deleteRomAndAllAssociatedDataFromDB(romId) {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = dbInstance.transaction(['rom_meta', 'rom_data', 'savestates', 'cheats', 'sram'], 'readwrite');
        tx.objectStore('rom_meta').delete(romId);
        tx.objectStore('rom_data').delete(romId);
        tx.objectStore('cheats').delete(romId);
        tx.objectStore('sram').delete(romId);

        const stateStore = tx.objectStore('savestates');
        if (stateStore.indexNames.contains('romId')) {
            const req = stateStore.index('romId').openKeyCursor(IDBKeyRange.only(romId));
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    stateStore.delete(cursor.primaryKey);
                    cursor.continue();
                }
            };
        } else {
            const allStatesReq = stateStore.getAll();
            allStatesReq.onsuccess = () => {
                const states = allStatesReq.result || [];
                for (const st of states) {
                    if (st.romId === romId) {
                        stateStore.delete(st.slotKey);
                    }
                }
            };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function clearAllGamesAndDataFromDB() {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = dbInstance.transaction(['rom_meta', 'rom_data', 'savestates', 'cheats', 'sram'], 'readwrite');
        tx.objectStore('rom_meta').clear();
        tx.objectStore('rom_data').clear();
        tx.objectStore('savestates').clear();
        tx.objectStore('cheats').clear();
        tx.objectStore('sram').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function putSaveStateToDB(stateRecord) {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = dbInstance.transaction('savestates', 'readwrite');
        tx.objectStore('savestates').put(stateRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function getSaveStatesForRom(romId) {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve) => {
        const tx = dbInstance.transaction('savestates', 'readonly');
        const store = tx.objectStore('savestates');
        if (store.indexNames.contains('romId')) {
            const req = store.index('romId').getAll(romId);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } else {
            const req = store.getAll();
            req.onsuccess = () => {
                const all = req.result || [];
                resolve(all.filter(item => item.romId === romId));
            };
            req.onerror = () => resolve([]);
        }
    });
}

async function countSaveStatesForRom(romId) {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve) => {
        const tx = dbInstance.transaction('savestates', 'readonly');
        const store = tx.objectStore('savestates');
        if (store.indexNames.contains('romId')) {
            const req = store.index('romId').count(romId);
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => resolve(0);
        } else {
            getSaveStatesForRom(romId).then(list => resolve(list.length)).catch(() => resolve(0));
        }
    });
}

async function saveCheatsForRom(romId, cheats) {
    if (!dbInstance || !romId) return;
    return new Promise((resolve) => {
        const tx = dbInstance.transaction('cheats', 'readwrite');
        tx.objectStore('cheats').put({ romId, cheats });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

async function loadCheatsForRom(romId) {
    if (!dbInstance || !romId) return [];
    return new Promise((resolve) => {
        const tx = dbInstance.transaction('cheats', 'readonly');
        const req = tx.objectStore('cheats').get(romId);
        req.onsuccess = () => resolve(req.result ? req.result.cheats : []);
        req.onerror = () => resolve([]);
    });
}

/**************************************************************************
 * 3. BỘ PHÂN TÍCH HEADER NHỊ PHÂN BĂNG GBA & TỰ ĐỘNG TÌM ẢNH BÌA (AUTO BOX ART)
 **************************************************************************/
const LIBRETRO_BOXART_BASE = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Game_Boy_Advance/master/Named_Boxarts/';
const GAMECODE_BOXART_MAP = {
    BPEE: 'Pokemon - Emerald Version (USA, Europe).png',
    BPRE: 'Pokemon - FireRed Version (USA, Europe).png',
    BPGE: 'Pokemon - LeafGreen Version (USA, Europe).png',
    AXVE: 'Pokemon - Ruby Version (USA, Europe) (Rev 1).png',
    AXPE: 'Pokemon - Sapphire Version (USA, Europe) (Rev 1).png',
    B24E: 'Pokemon Mystery Dungeon - Red Rescue Team (USA, Australia).png',
    BNVE: 'Pokemon Pinball - Ruby & Sapphire (USA).png',
    AGFE: 'Golden Sun (USA, Europe).png',
    AGFE_2: 'Golden Sun - The Lost Age (USA, Europe).png',
    BMCE: 'Mario Kart - Super Circuit (USA).png',
    AMCE: 'Mario Kart - Super Circuit (USA).png',
    A3AE: 'Super Mario Advance 4 - Super Mario Bros. 3 (USA).png',
    AA2E: 'Super Mario Advance 2 - Super Mario World (USA, Australia).png',
    AMAE: 'Super Mario Advance (USA, Europe).png',
    A2YE: 'Yoshi\'s Island - Super Mario Advance 3 (USA).png',
    AZLE: 'Legend of Zelda, The - A Link to the Past & Four Swords (USA).png',
    BZME: 'Legend of Zelda, The - The Minish Cap (USA).png',
    AMTE: 'Metroid Fusion (USA).png',
    BMXE: 'Metroid - Zero Mission (USA).png',
    A88E: 'Mario & Luigi - Superstar Saga (USA).png',
    AE7E: 'Fire Emblem (USA, Australia).png',
    BE8E: 'Fire Emblem - The Sacred Stones (USA, Australia).png',
    AFXE: 'Final Fantasy Tactics Advance (USA).png',
    BFEE: 'Final Fantasy VI Advance (USA).png',
    BZ4E: 'Final Fantasy IV Advance (USA).png',
    BZ5E: 'Final Fantasy V Advance (USA).png',
    A2CE: 'Castlevania - Aria of Sorrow (USA).png',
    ACVE: 'Castlevania - Circle of the Moon (USA).png',
    ACHE: 'Castlevania - Harmony of Dissonance (USA).png',
    AK8E: 'Kirby & the Amazing Mirror (USA).png',
    A7KE: 'Kirby - Nightmare in Dream Land (USA).png',
    AWRE: 'Advance Wars (USA) (Rev 1).png',
    AW2E: 'Advance Wars 2 - Black Hole Rising (USA).png',
    ASOE: 'Sonic Advance (USA).png',
    A2NE: 'Sonic Advance 2 (USA).png',
    B3SE: 'Sonic Advance 3 (USA).png',
    B4WE: 'WarioWare - Twisted! (USA).png',
    AZWE: 'WarioWare, Inc. - Mega Microgame$! (USA).png',
    AWAE: 'Wario Land 4 (USA, Europe).png',
    AR8E: 'Mega Man Zero (USA, Europe).png',
    A62E: 'Mega Man Zero 2 (USA).png',
    BZ3E: 'Mega Man Zero 3 (USA).png',
    B4ZE: 'Mega Man Zero 4 (USA).png',
    AREE: 'Mega Man Battle Network (USA).png',
    AE2E: 'Mega Man Battle Network 2 (USA).png',
    A3XE: 'Mega Man Battle Network 3 - Blue Version (USA).png',
    A6BE: 'Mega Man Battle Network 3 - White Version (USA).png',
    B4NE: 'harvest Moon - Friends of Mineral Town (USA).png',
    A4NE: 'Harvest Moon - Friends of Mineral Town (USA).png',
    BFME: 'Harvest Moon - More Friends of Mineral Town (USA).png',
    BG3E: 'Dragon Ball Z - The Legacy of Goku II (USA).png',
    ALGE: 'Dragon Ball Z - The Legacy of Goku (USA).png',
    BUFE: 'Dragon Ball Z - Buu\'s Fury (USA).png',
    BDVE: 'Dragon Ball - Advanced Adventure (USA).png',
    AK9E: 'Kingdom Hearts - Chain of Memories (USA).png'
};

function hashRomBuffer(arrayBuffer) {
    const len = arrayBuffer.byteLength;
    const len32 = Math.floor(len / 4);
    const u32 = new Uint32Array(arrayBuffer, 0, len32);
    let h1 = 0xdeadbeef ^ 0;
    let h2 = 0x41c6ce57 ^ 0;

    for (let i = 0; i < len32; i++) {
        const k = u32[i];
        h1 = Math.imul(h1 ^ k, 2654435761);
        h2 = Math.imul(h2 ^ (k >>> 16), 1597334677);
    }

    const tailBytes = new Uint8Array(arrayBuffer, len32 * 4);
    for (let i = 0; i < tailBytes.length; i++) {
        const b = tailBytes[i];
        h1 = Math.imul(h1 ^ (b << (i * 8)), 2654435761);
        h2 = Math.imul(h2 ^ (b << (i * 8)), 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
    return (p1 + p2).slice(0, 16);
}

function getFriendlyGameTitle(gameCode, fileName, headerTitle) {
    if (fileName) {
        const fName = fileName
            .replace(/\.(gba|bin|agb|zip)$/i, '')
            .replace(/\(.*?\)|\[.*?\]/g, ' ')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const isGeneric = !fName ||
            /^[0-9\s-]+$/.test(fName) ||
            /^[0-9a-f]{8,}$/i.test(fName.replace(/\s/g, '')) ||
            /^(rom|game|gba|agb|test)(\s+\d+)?$/i.test(fName);
        if (!isGeneric && fName.length >= 2) {
            return fName;
        }
    }

    const code = String(gameCode || '').toUpperCase().trim();
    if (typeof GAMECODE_BOXART_MAP !== 'undefined' && GAMECODE_BOXART_MAP[code]) {
        const cleaned = GAMECODE_BOXART_MAP[code]
            .replace(/\.png$/i, '')
            .replace(/\(.*?\)|\[.*?\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (cleaned) return cleaned;
    }

    return (headerTitle || 'GBA GAME').trim();
}

function parseGbaRomHeader(arrayBuffer, fileName) {
    const bytes = new Uint8Array(arrayBuffer);
    const readAscii = (start, len) => {
        let s = '';
        for (let i = start; i < start + len && i < bytes.length; i++) {
            if (bytes[i] >= 32 && bytes[i] <= 126) s += String.fromCharCode(bytes[i]);
        }
        return s.trim();
    };

    const rawTitle = bytes.length >= 0xB0 ? readAscii(0xA0, 12) : '';
    const rawCode = bytes.length >= 0xB0 ? readAscii(0xAC, 4) : '';
    const rawMaker = bytes.length >= 0xB2 ? readAscii(0xB0, 2) : '';

    let calcChecksum = 0;
    let headerChecksum = 0;
    if (bytes.length > 0xBD) {
        for (let i = 0xA0; i <= 0xBC; i++) {
            calcChecksum = (calcChecksum - bytes[i]) & 0xFF;
        }
        calcChecksum = (calcChecksum - 0x19) & 0xFF;
        headerChecksum = bytes[0xBD];
    }

    let saveType = 'SRAM 32KB (Mặc định)';
    const sampleLimit = Math.min(bytes.length, 8 * 1024 * 1024);
    const asciiContent = new TextDecoder('ascii').decode(bytes.subarray(0, sampleLimit));

    if (asciiContent.includes('FLASH1M_V')) saveType = 'FLASH 128KB (1Mbit)';
    else if (asciiContent.includes('FLASH512_V') || asciiContent.includes('FLASH_V')) saveType = 'FLASH 64KB (512Kbit)';
    else if (asciiContent.includes('EEPROM_V')) saveType = 'EEPROM 8KB/512B';
    else if (asciiContent.includes('SRAM_V')) saveType = 'SRAM 32KB (256Kbit)';

    const cleanCode = rawCode.length === 4 ? rawCode : 'AGB0';
    const cleanTitle = getFriendlyGameTitle(cleanCode, fileName, rawTitle);
    const hash16 = hashRomBuffer(arrayBuffer);

    return {
        id: `${cleanCode}-${hash16}`,
        fileName,
        title: cleanTitle,
        gameCode: cleanCode,
        makerCode: rawMaker || '01',
        saveType,
        checksumValid: calcChecksum === headerChecksum,
        checksumHex: '0x' + headerChecksum.toString(16).toUpperCase().padStart(2, '0'),
        sizeBytes: bytes.length
    };
}

let cachedLibretroBoxartList = null;
let libretroListFetchPromise = null;

async function getLibretroBoxartIndex() {
    if (cachedLibretroBoxartList) return cachedLibretroBoxartList;
    if (libretroListFetchPromise) return libretroListFetchPromise;

    libretroListFetchPromise = (async () => {
        try {
            const cachedSession = sessionStorage.getItem('delta_gba_boxart_index_v1');
            if (cachedSession) {
                cachedLibretroBoxartList = JSON.parse(cachedSession);
                return cachedLibretroBoxartList;
            }
        } catch (_) {}

        try {
            const res = await fetch('https://api.github.com/repos/libretro-thumbnails/Nintendo_-_Game_Boy_Advance/contents/Named_Boxarts');
            if (!res.ok) return [];
            const items = await res.json();
            if (!Array.isArray(items)) return [];
            cachedLibretroBoxartList = items
                .filter(x => x && x.name && x.name.endsWith('.png'))
                .map(x => x.name);
            try {
                sessionStorage.setItem('delta_gba_boxart_index_v1', JSON.stringify(cachedLibretroBoxartList));
            } catch (_) {}
            return cachedLibretroBoxartList;
        } catch (e) {
            return [];
        } finally {
            libretroListFetchPromise = null;
        }
    })();

    return libretroListFetchPromise;
}

function normalizeGameSearchTokens(str) {
    return String(str || '')
        .replace(/\.(gba|bin|agb|png|zip)$/i, '')
        .replace(/\(.*?\)|\[.*?\]/g, ' ')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= 2);
}

function shrinkImageDataUrl(dataUrl, maxSide = 360, quality = 0.85) {
    return new Promise((resolve) => {
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
            return resolve(dataUrl || '');
        }
        const img = new Image();
        img.onload = () => {
            try {
                let w = img.naturalWidth || img.width;
                let h = img.naturalHeight || img.height;
                if (!w || !h) return resolve(dataUrl);

                if (w <= maxSide && h <= maxSide && dataUrl.length < 80000) {
                    return resolve(dataUrl);
                }

                if (w > h) {
                    if (w > maxSide) {
                        h = Math.round((h * maxSide) / w);
                        w = maxSide;
                    }
                } else {
                    if (h > maxSide) {
                        w = Math.round((w * maxSide) / h);
                        h = maxSide;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(dataUrl);

                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                const result = canvas.toDataURL('image/jpeg', quality);
                resolve(result || dataUrl);
            } catch (err) {
                resolve(dataUrl);
            }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

async function tryFetchImageAsDataUrl(url) {
    try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) return '';
        const blob = await res.blob();
        if (!blob || !blob.type.startsWith('image/')) return '';
        return await blobToDataUrl(blob);
    } catch (e) {
        return '';
    }
}

async function findAutoBoxArtForRom(romMeta) {
    if (!romMeta) return '';
    const candidates = [];

    const code4 = (romMeta.gameCode || '').toUpperCase();
    if (GAMECODE_BOXART_MAP[code4]) {
        candidates.push(LIBRETRO_BOXART_BASE + encodeURIComponent(GAMECODE_BOXART_MAP[code4]));
    } else if (code4.length === 4) {
        const prefix3 = code4.slice(0, 3);
        const matchKey = Object.keys(GAMECODE_BOXART_MAP).find(k => k.startsWith(prefix3));
        if (matchKey) {
            candidates.push(LIBRETRO_BOXART_BASE + encodeURIComponent(GAMECODE_BOXART_MAP[matchKey]));
        }
    }

    const rawBaseName = (romMeta.fileName || '').replace(/\.(gba|bin|agb)$/i, '').trim();
    if (rawBaseName) {
        candidates.push(LIBRETRO_BOXART_BASE + encodeURIComponent(rawBaseName + '.png'));
    }

    for (const url of candidates) {
        const dataUrl = await tryFetchImageAsDataUrl(url);
        if (dataUrl) return await shrinkImageDataUrl(dataUrl, 360, 0.85);
    }

    const boxartFiles = await getLibretroBoxartIndex();
    if (boxartFiles && boxartFiles.length > 0) {
        const fileTokens = normalizeGameSearchTokens(rawBaseName);
        const titleTokens = normalizeGameSearchTokens(romMeta.title);
        const queryTokens = fileTokens.length >= titleTokens.length ? fileTokens : titleTokens;

        if (queryTokens.length > 0) {
            let bestFile = null;
            let bestScore = 0;

            for (const fileName of boxartFiles) {
                const lowerName = fileName.toLowerCase();
                let score = 0;
                for (const tk of queryTokens) {
                    if (lowerName.includes(tk)) score += tk.length;
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestFile = fileName;
                }
            }

            if (bestFile && bestScore >= 4) {
                const dataUrl = await tryFetchImageAsDataUrl(LIBRETRO_BOXART_BASE + encodeURIComponent(bestFile));
                if (dataUrl) return await shrinkImageDataUrl(dataUrl, 360, 0.85);
            }
        }
    }

    return '';
}

async function autoFetchMissingCoversForLibrary() {
    const allRoms = await getAllRomMetasFromDB();
    let updatedAny = false;
    for (const rom of allRoms) {
        if (!rom.coverUrl && !rom.customCoverLocked) {
            const foundDataUrl = await findAutoBoxArtForRom(rom);
            if (foundDataUrl) {
                rom.coverUrl = foundDataUrl;
                rom.coverSource = 'AUTO_BOXART';
                await saveRomMetaToDB(rom);
                updatedAny = true;
                if (typeof renderDashboardRomGrid === 'function') {
                    await renderDashboardRomGrid();
                }
            }
        }
    }
    return updatedAny;
}

async function triggerManualAutoBoxArt() {
    if (!activeCoverEditRomId) return;
    const btn = document.getElementById('auto-boxart-btn');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tìm ảnh bìa...`;
    }

    try {
        const found = await getRomMetaById(activeCoverEditRomId);
        if (!found) return;

        const dataUrl = await findAutoBoxArtForRom(found);
        if (dataUrl) {
            await applyCoverUrlToRom(activeCoverEditRomId, dataUrl, 'AUTO_BOXART', false);
            const prev = document.getElementById('cover-modal-preview');
            if (prev) prev.src = dataUrl;
            showToast('Đã tự động tìm và cập nhật ảnh bìa gốc!', 'success');
        } else {
            showToast('Không tìm thấy ảnh bìa tự động cho ROM này, bạn hãy tải ảnh từ máy lên nhé.', 'error');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

/**************************************************************************
 * 4. NHÂN GIẢ LẬP NOSTALGIST (mGBA WASM)
 **************************************************************************/
let audioCtx = null;
function playGbaBeep(freq = 520, duration = 0.045, type = 'square') {
    if (AppState.isMuted) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
}

let nostalgistLoadPromise = null;

function ensureNostalgist() {
    if (typeof window !== 'undefined' && typeof window.Nostalgist !== 'undefined') {
        return Promise.resolve(true);
    }
    if (nostalgistLoadPromise) {
        return nostalgistLoadPromise;
    }

    nostalgistLoadPromise = new Promise((resolve) => {
        let finished = false;
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/nostalgist@0.16.0/dist/nostalgist.umd.min.js';
        script.async = true;

        const timer = setTimeout(() => {
            if (!finished) {
                finished = true;
                nostalgistLoadPromise = null;
                resolve(typeof window.Nostalgist !== 'undefined');
            }
        }, 20000);

        script.onload = () => {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                resolve(typeof window.Nostalgist !== 'undefined');
            }
        };

        script.onerror = () => {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                nostalgistLoadPromise = null;
                resolve(false);
            }
        };

        document.head.appendChild(script);
    });

    return nostalgistLoadPromise;
}

async function bootGbaRom(arrayBuffer, fileName) {
    try {
        if (AppState.nostalgistInstance && typeof persistBatterySave === 'function') {
            await persistBatterySave({ thorough: true });
        }

        const meta = parseGbaRomHeader(arrayBuffer, fileName);
        AppState.currentRom = { ...meta, buffer: arrayBuffer };
        AppState.romLoaded = true;
        AppState.isPaused = false;
        AppState.fastForwardSpeed = 1;
        AppState.retroFastForwardActive = false;
        AppState.lastCapturedFrameDataUrl = '';
        if (typeof updateFastForwardUI === 'function') updateFastForwardUI();

        AppState.cheats = await loadCheatsForRom(meta.id);

        const existingRecord = await getRomMetaById(meta.id);

        const romMetaRecord = {
            id: meta.id,
            fileName: meta.fileName,
            title: existingRecord?.customTitle || meta.title,
            customTitle: existingRecord?.customTitle || null,
            gameCode: meta.gameCode,
            makerCode: meta.makerCode,
            saveType: meta.saveType,
            checksumValid: meta.checksumValid,
            checksumHex: meta.checksumHex,
            sizeBytes: meta.sizeBytes,
            lastPlayed: Date.now(),
            coverUrl: existingRecord?.coverUrl || '',
            coverSource: existingRecord?.coverSource || null,
            customCoverLocked: existingRecord?.customCoverLocked || false
        };

        await saveRomMetaToDB(romMetaRecord);
        await saveRomDataToDB(meta.id, arrayBuffer);

        if (!romMetaRecord.coverUrl && !romMetaRecord.customCoverLocked) {
            findAutoBoxArtForRom(romMetaRecord).then(async (autoCover) => {
                if (autoCover) {
                    await applyCoverUrlToRom(romMetaRecord.id, autoCover, 'AUTO_BOXART', false);
                }
            }).catch(() => {});
        }

        updateRomMetadataUI();
        if (typeof renderDashboardRomGrid === 'function') await renderDashboardRomGrid();
        if (typeof switchToPlayerView === 'function') switchToPlayerView();
        const pauseOv = document.getElementById('pause-overlay');
        if (pauseOv) pauseOv.classList.add('hidden');

        const nostalgistLoaded = await ensureNostalgist();
        if (!nostalgistLoaded || typeof window.Nostalgist === 'undefined') {
            failToLibrary('Không tải được bộ giả lập mGBA. Hãy kiểm tra mạng rồi thử lại.');
            return;
        }
        const coreOk = await launchNostalgistWasmCore(arrayBuffer, fileName);
        if (!coreOk) return;

        setEmuAudioMuted(AppState.isMuted);
        kickEmulatorDisplay();
        if (typeof applyActiveCheatsToCore === 'function') {
            setTimeout(() => applyActiveCheatsToCore(), 700);
        }

        playGbaBeep(659.25, 0.08, 'square');
        setTimeout(() => playGbaBeep(1046.5, 0.14, 'square'), 80);
        showToast(`Đang chạy: ${romMetaRecord.title} (${meta.gameCode})`, 'success');
    } catch (err) {
        console.error('Lỗi khi nạp ROM:', err);
        failToLibrary('Không nạp được ROM này. Hãy thử một file .gba khác.');
    }
}

async function launchNostalgistWasmCore(arrayBuffer, fileName) {
    const wasmContainer = document.getElementById('wasm-mount-container');
    try {
        if (typeof stopAutoSaveLoop === 'function') stopAutoSaveLoop();
        if (AppState.nostalgistInstance) {
            try { AppState.nostalgistInstance.exit(); } catch (e) {}
            AppState.nostalgistInstance = null;
        }

        if (wasmContainer) {
            wasmContainer.innerHTML = '';
            wasmContainer.classList.remove('hidden');
            wasmContainer.classList.add('flex');
        }

        const wasmCanvas = document.createElement('canvas');
        wasmCanvas.id = 'emulator-webgl-canvas';
        wasmCanvas.width = 240;
        wasmCanvas.height = 160;
        wasmCanvas.className = 'w-full h-full object-contain';
        if (wasmContainer) wasmContainer.appendChild(wasmCanvas);

        const romBlob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
        const romFile = new File([romBlob], fileName.endsWith('.gba') ? fileName : `${fileName}.gba`);

        let sramFile = null;
        if (typeof lastSramSig !== 'undefined') lastSramSig = '';
        try {
            const rec = await getSramFromDB(AppState.currentRom.id);
            if (rec && rec.data && rec.data.byteLength) {
                sramFile = new File([rec.data], fileName.replace(/\.[^.]+$/, '') + '.srm');
                if (typeof sramSignature === 'function') {
                    lastSramSig = sramSignature(new Uint8Array(rec.data));
                }
            }
        } catch (e) {}

        AppState.nostalgistInstance = await window.Nostalgist.gba({
            element: wasmCanvas,
            rom: romFile,
            ...(sramFile ? { sram: sramFile } : {}),
            respondToGlobalEvents: true,
            retroarchConfig: {
                input_player1_up: 'up', input_player1_down: 'down',
                input_player1_left: 'left', input_player1_right: 'right',
                input_player1_a: 'x', input_player1_b: 'z',
                input_player1_l: 'q', input_player1_r: 'e',
                input_player1_start: 'enter', input_player1_select: 'rshift',
                input_audio_mute: 'nul',
                input_toggle_fast_forward: 'f9',
                fastforward_ratio: '4.0',
                fastforward_frameskip: 'true',
                autosave_interval: '10'
            },
            style: {
                width: '100%',
                height: '100%',
                display: 'block'
            }
        });

        AppState.activeCoreMode = 'mGBA WASM';
        AppState.sramRomId = AppState.currentRom.id;
        if (typeof startAutoSaveLoop === 'function') startAutoSaveLoop();
        return true;
    } catch (wasmErr) {
        console.warn('mGBA không khởi tạo được:', wasmErr);
        failToLibrary('mGBA không chạy được ROM này, đã quay về kệ game.');
        return false;
    }
}

function failToLibrary(msg) {
    if (typeof stopAutoSaveLoop === 'function') stopAutoSaveLoop();
    AppState.romLoaded = false;
    AppState.activeCoreMode = 'STANDBY';
    AppState.nostalgistInstance = null;
    const c = document.getElementById('wasm-mount-container');
    if (c) { c.classList.add('hidden'); c.classList.remove('flex'); c.innerHTML = ''; }
    showToast(msg, 'error');
    if (typeof switchToLibraryView === 'function') switchToLibraryView();
}

function updateRomMetadataUI() {
    const rom = AppState.currentRom;
    const menuRomEl = document.getElementById('menu-rom-name');
    if (menuRomEl) menuRomEl.textContent = `${rom.title} (${rom.fileName})`;

    const mobileResume = document.getElementById('mobile-resume-pill');
    if (mobileResume) {
        mobileResume.classList.remove('hidden');
        mobileResume.classList.add('inline-flex');
    }
    if (typeof updateActiveCheatsPill === 'function') updateActiveCheatsPill();
}

/**************************************************************************
 * MIGRATION DỮ LIỆU ROM TỪ ID CŨ SANG HASH 64-BIT (IDEMPOTENT & AN TOÀN)
 **************************************************************************/
async function migrateRomIdsAndData() {
    try {
        if (localStorage.getItem('delta_gba_id_migrated_v1') === '1') {
            return;
        }
        if (!dbInstance) await initIndexedDB();

        const allMetas = await getAllRomMetasFromDB();
        const oldIdPattern = /^[A-Za-z0-9]{4}_\d+$/;
        const targetMetas = allMetas.filter(r => r && typeof r.id === 'string' && oldIdPattern.test(r.id));
        let failedCount = 0;

        for (const oldMeta of targetMetas) {
            const oldId = oldMeta.id;
            try {
                const buffer = await getRomDataFromDB(oldId);
                if (!buffer || !(buffer instanceof ArrayBuffer || buffer.byteLength > 0)) {
                    console.warn(`[Migration] Không tìm thấy buffer cho ROM ${oldId}, bỏ qua.`);
                    failedCount++;
                    continue;
                }

                const cleanCode = (oldMeta.gameCode && oldMeta.gameCode.length === 4) ? oldMeta.gameCode : oldId.slice(0, 4);
                const hash16 = hashRomBuffer(buffer);
                const newId = `${cleanCode}-${hash16}`;

                if (newId === oldId) continue;

                const existingNewMeta = await getRomMetaById(newId);
                let finalMeta;
                if (existingNewMeta) {
                    const useOldMeta = (oldMeta.lastPlayed || 0) >= (existingNewMeta.lastPlayed || 0);
                    finalMeta = {
                        ...(useOldMeta ? oldMeta : existingNewMeta),
                        id: newId
                    };
                } else {
                    finalMeta = {
                        ...oldMeta,
                        id: newId
                    };
                    if (!finalMeta.customTitle) {
                        finalMeta.title = getFriendlyGameTitle(cleanCode, finalMeta.fileName, finalMeta.title);
                    }
                }

                if (finalMeta.coverUrl && finalMeta.coverUrl.length > 80000) {
                    finalMeta.coverUrl = await shrinkImageDataUrl(finalMeta.coverUrl, 360, 0.85);
                }

                await saveRomMetaToDB(finalMeta);
                await saveRomDataToDB(newId, buffer);

                const oldSram = await getSramFromDB(oldId);
                if (oldSram && oldSram.data) {
                    const existingNewSram = await getSramFromDB(newId);
                    if (!existingNewSram || (oldSram.timestamp || 0) >= (existingNewSram.timestamp || 0)) {
                        await putSramToDB({ ...oldSram, romId: newId });
                    }
                }

                const oldCheats = await loadCheatsForRom(oldId);
                if (oldCheats && oldCheats.length > 0) {
                    const existingNewCheats = await loadCheatsForRom(newId);
                    if (!existingNewCheats || existingNewCheats.length === 0) {
                        await saveCheatsForRom(newId, oldCheats);
                    }
                }

                const oldStates = await getSaveStatesForRom(oldId);
                if (oldStates && oldStates.length > 0) {
                    const newStates = existingNewMeta ? await getSaveStatesForRom(newId) : [];
                    for (const st of oldStates) {
                        const clash = newStates.find(n => n.slotId === st.slotId);
                        if (clash && (clash.timestamp || 0) >= (st.timestamp || 0)) continue;
                        const newSlotKey = `${newId}__${st.slotId}`;
                        await putSaveStateToDB({
                            ...st,
                            romId: newId,
                            slotKey: newSlotKey
                        });
                    }
                }

                await deleteRomAndAllAssociatedDataFromDB(oldId);
                console.info(`[Migration] Chuyển đổi thành công ROM: ${oldId} -> ${newId}`);
            } catch (romErr) {
                console.error(`[Migration] Lỗi khi chuyển đổi ROM ${oldId}:`, romErr);
                failedCount++;
            }
        }

        if (failedCount === 0) localStorage.setItem('delta_gba_id_migrated_v1', '1');
    } catch (err) {
        console.error('[Migration] Lỗi quá trình migration:', err);
    }
}
