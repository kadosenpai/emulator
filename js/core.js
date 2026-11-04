/**************************************************************************
 * 1. QUẢN LÝ TRẠNG THÁI TOÀN CỤC & BỘ ĐIỀU PHỐI TUA NHANH (FAST FORWARD)
 **************************************************************************/
const FF_MODE = 'retroarch'; // BẮT BUỘC DÙNG CORE CỦA RETROARCH/MGBA ĐỂ TỐI ƯU HIỆU NĂNG

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

/* Làm "tỉnh" màn hình giả lập ở lần mở game đầu tiên (sửa lỗi iPhone XS không load được game) */
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

// LƯU Ý ĐẶC BIỆT: ĐÃ XÓA HOÀN TOÀN TÍNH NĂNG ÉP KHUNG HÌNH (REQUEST ANIMATION FRAME INTERCEPTOR) 
// ĐỂ TRẢ LẠI 100% HIỆU NĂNG XỬ LÝ FAST FORWARD CHO NHÂN CORE MGBA. 
// ĐIỀU NÀY GIẢI QUYẾT TRIỆT ĐỂ VẤN ĐỀ LAG VÀ NÓNG MÁY!
