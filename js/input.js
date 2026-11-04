/**************************************************************************
 * 6. VÒNG LẶP CHÍNH QUÉT TAY CẦM
 **************************************************************************/
function mainEmulatorLoop() {
    pollGamepad();
    // Đã gỡ bỏ tính năng ghi RAM thô (Raw RAM) từ JS, nhường 100% cho RetroArch core
    nativeRequestAnimationFrame(mainEmulatorLoop);
}

/**************************************************************************
 * 7. NÚT BẤM ẢO, BÀN PHÍM, GIỮ NÚT TỰ ĐỘNG (HOLD)
 **************************************************************************/
const KEY_FOR_NOSTALGIST = {
    UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
    A: 'KeyX', B: 'KeyZ', L: 'KeyQ', R: 'KeyE', START: 'Enter', SELECT: 'ShiftRight'
};

const KEYCODE_FOR_NOSTALGIST = {
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
    KeyX: 88, KeyZ: 90, KeyQ: 81, KeyE: 69, Enter: 13, ShiftRight: 16
};

let _iosHapticLabel = null;
function ensureIosHaptic() {
    if (_iosHapticLabel) return _iosHapticLabel;
    try {
        const label = document.createElement('label');
        label.setAttribute('aria-hidden', 'true');
        label.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        label.appendChild(input);
        (document.head || document.body).appendChild(label);
        _iosHapticLabel = label;
    } catch (e) {}
    return _iosHapticLabel;
}
document.addEventListener('DOMContentLoaded', ensureIosHaptic);

function triggerHaptic(ms = 40, force = false) {
    if (!force && AppState.hapticEnabled === false) return;
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(ms);
            return;
        }
    } catch (e) {}
    // iOS Safari không có navigator.vibrate: dùng công tắc "switch" ẩn để tạo rung Taptic (iOS 18+)
    try {
        const lbl = ensureIosHaptic();
        if (lbl) lbl.click();
    } catch (e) {}
}

function dispatchSyntheticKeyToEmulator(btn, isDown) {
    const code = KEY_FOR_NOSTALGIST[btn];
    if (!code) return;
    const keyCode = KEYCODE_FOR_NOSTALGIST[code] || 0;
    const keyNames = { Enter: 'Enter', ShiftRight: 'Shift', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
    try {
        const evt = new KeyboardEvent(isDown ? 'keydown' : 'keyup', {
            code,
            key: keyNames[code] || code.replace('Key', '').toLowerCase(),
            location: code === 'ShiftRight' ? 2 : 0,
            bubbles: true,
            cancelable: true
        });
        Object.defineProperty(evt, 'keyCode', { get: () => keyCode });
        Object.defineProperty(evt, 'which', { get: () => keyCode });
        document.dispatchEvent(evt);
    } catch (e) {}
}

function setGbaButtonState(btn, pressed, fromSource = 'touch') {
    if (AppState.isEditingTouchLayout) return;
    if (!GBA_BUTTONS.includes(btn)) return;

    if (pressed && AppState.isSelectingHoldButton && fromSource === 'touch') {
        AppState.heldButtons[btn] = !AppState.heldButtons[btn];
        AppState.isSelectingHoldButton = false;
        const banner = document.getElementById('hold-selection-banner');
        if (banner) banner.classList.add('hidden');
        syncHoldBadgesUI();
        AppState.buttonStates[btn] = AppState.heldButtons[btn];
        updateVirtualButtonActiveUI(btn, AppState.buttonStates[btn]);
        dispatchSyntheticKeyToEmulator(btn, AppState.buttonStates[btn]);
        showToast(
            AppState.heldButtons[btn]
                ? `Đã ghim giữ tự động (Hold) nút ${btn}`
                : `Đã bỏ giữ tự động nút ${btn}`,
            'info'
        );
        return;
    }

    const finalState = AppState.heldButtons[btn] ? true : pressed;
    if (AppState.buttonStates[btn] !== finalState) {
        AppState.buttonStates[btn] = finalState;
        updateVirtualButtonActiveUI(btn, finalState);
        if (fromSource !== 'keyboard') {
            dispatchSyntheticKeyToEmulator(btn, finalState);
        }
        if (finalState && fromSource === 'touch') {
            triggerHaptic(40);
            if (typeof playGbaBeep === 'function') {
                playGbaBeep(btn === 'A' ? 680 : 440, 0.025, 'triangle');
            }
        } else if (!finalState && fromSource === 'touch' && !['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(btn)) {
            triggerHaptic(20);
        }
    }
}

function updateVirtualButtonActiveUI(btn, isActive) {
    document.querySelectorAll(`[data-gba-btn="${btn}"]`).forEach(el => {
        el.classList.toggle('active', isActive);
    });
}

function toggleHoldSelectionMode() {
    AppState.isSelectingHoldButton = !AppState.isSelectingHoldButton;
    const banner = document.getElementById('hold-selection-banner');
    if (banner) banner.classList.toggle('hidden', !AppState.isSelectingHoldButton);
    if (AppState.isSelectingHoldButton && !AppState.touchControlsVisible) {
        AppState.touchControlsVisible = true;
        if (typeof applyTouchControlsLayout === 'function') {
            applyTouchControlsLayout();
        }
    }
    showToast(
        AppState.isSelectingHoldButton
            ? 'Hãy chạm vào 1 nút GBA trên màn hình để ghim giữ tự động (Hold)'
            : 'Đã thoát chế độ chọn nút Hold',
        'info'
    );
}

function syncHoldBadgesUI() {
    const heldList = GBA_BUTTONS.filter(b => AppState.heldButtons[b]);
    const badge = document.getElementById('hold-indicator-badge');
    if (badge) {
        if (heldList.length > 0) {
            badge.classList.remove('hidden');
            badge.textContent = `HOLD: ${heldList.join(', ')}`;
        } else {
            badge.classList.add('hidden');
        }
    }
    GBA_BUTTONS.forEach(btn => {
        document.querySelectorAll(`[data-gba-btn="${btn}"]`).forEach(el => {
            el.classList.toggle('hold-active', !!AppState.heldButtons[btn]);
        });
    });
}

function initJoystick() {
    const zone = document.getElementById('joy-zone');
    const knob = document.getElementById('joy-knob');
    if (!zone || !knob) return;
    const DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
    const cur = { UP: false, DOWN: false, LEFT: false, RIGHT: false };
    let pid = null;

    function apply(dx, dy, radius) {
        const next = { UP: false, DOWN: false, LEFT: false, RIGHT: false };
        if (Math.hypot(dx, dy) / radius > 0.28) {
            const ang = Math.atan2(dy, dx), cx = Math.cos(ang), cy = Math.sin(ang), th = 0.38;
            next.RIGHT = cx > th; next.LEFT = cx < -th; next.DOWN = cy > th; next.UP = cy < -th;
        }
        for (const d of DIRS) {
            if (next[d] !== cur[d]) { cur[d] = next[d]; setGbaButtonState(d, next[d], 'touch'); }
        }
    }
    function move(e) {
        const r = zone.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        apply(dx, dy, r.width * 0.4);
        const dist = Math.hypot(dx, dy), max = r.width * 0.3, k = dist > max ? max / dist : 1;
        knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
    function end(e) {
        if (e.pointerId !== pid) return;
        pid = null;
        knob.style.transform = '';
        apply(0, 0, 1);
    }
    zone.addEventListener('pointerdown', (e) => {
        if (AppState.isEditingTouchLayout) return;
        e.preventDefault();
        pid = e.pointerId;
        try { zone.setPointerCapture(pid); } catch (_) {}
        move(e);
    });
    zone.addEventListener('pointermove', (e) => {
        if (!AppState.isEditingTouchLayout && e.pointerId === pid) move(e);
    });
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
}

function initVirtualControls() {
    initJoystick();
    initTouchLayoutCustomizationDrag();

    const deltaMenuTrigger = document.getElementById('delta-menu-trigger-btn');
    if (deltaMenuTrigger) {
        deltaMenuTrigger.addEventListener('pointerdown', () => triggerHaptic(14));
    }
    const menuFallback = document.getElementById('menu-fallback');
    if (menuFallback) {
        menuFallback.addEventListener('pointerdown', () => triggerHaptic(14));
    }

    document.querySelectorAll('.gba-touch-btn').forEach(btnEl => {
        const gbaBtn = btnEl.getAttribute('data-gba-btn');
        if (!gbaBtn) return;

        const onPress = (e) => {
            if (AppState.isEditingTouchLayout) return;
            e.preventDefault();
            setGbaButtonState(gbaBtn, true, 'touch');
        };
        const onRelease = (e) => {
            if (AppState.isEditingTouchLayout) return;
            e.preventDefault();
            setGbaButtonState(gbaBtn, false, 'touch');
        };

        btnEl.addEventListener('pointerdown', onPress);
        btnEl.addEventListener('pointerup', onRelease);
        btnEl.addEventListener('pointerleave', onRelease);
        btnEl.addEventListener('pointercancel', onRelease);
    });

    window.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

        if (glassConfirmResolver && e.code === 'Escape') {
            e.preventDefault();
            resolveGlassConfirm(false);
            return;
        }

        if (AppState.remappingTarget && AppState.remappingTarget.mode === 'keyboard') {
            e.preventDefault();
            const targetBtn = AppState.remappingTarget.btn;
            AppState.keyMap[targetBtn] = e.code;
            AppState.remappingTarget = null;
            saveCustomMappings();
            renderRemappingList();
            showToast(`Đã gán phím ${e.code} cho nút ${targetBtn}`, 'success');
            return;
        }

        if (e.code === 'Escape') {
            e.preventDefault();
            if (AppState.isEditingTouchLayout) {
                exitTouchLayoutEditMode(true);
                return;
            }
            if (sheetRomId) {
                closeGameActionSheet();
                return;
            }
            const menuModal = document.getElementById('delta-menu-modal');
            if (menuModal && !menuModal.classList.contains('hidden')) {
                closeDeltaMenu();
                resumeGame();
            } else if (AppState.currentView === 'player') {
                openDeltaMenu();
            }
            return;
        }
        if (e.code === 'KeyM') {
            e.preventDefault();
            toggleMute();
            return;
        }

        for (const btn of GBA_BUTTONS) {
            if (e.code === AppState.keyMap[btn] || e.code === AppState.altKeyMap[btn]) {
                setGbaButtonState(btn, true, 'keyboard');
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
        for (const btn of GBA_BUTTONS) {
            if (e.code === AppState.keyMap[btn] || e.code === AppState.altKeyMap[btn]) {
                setGbaButtonState(btn, false, 'keyboard');
            }
        }
    });
}

/**************************************************************************
 * 7B. TÙY CHỈNH NÚT ẢO TÁCH RIÊNG MÀN HÌNH DỌC (PORTRAIT) & NGANG (LANDSCAPE)
 **************************************************************************/
const TOUCH_LAYOUT_STORAGE_KEY = 'delta_gba_touch_layout_v2';
let touchLayoutConfig = {
    opacity: 100,
    portrait: {},
    landscape: {}
};

function getCurrentOrientationKey() {
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
}

function getActiveOrientationControlsMap() {
    const key = getCurrentOrientationKey();
    if (!touchLayoutConfig[key] || typeof touchLayoutConfig[key] !== 'object') {
        touchLayoutConfig[key] = {};
    }
    return touchLayoutConfig[key];
}

function updateOrientationBadgeUI() {
    const badge = document.getElementById('layout-orientation-badge');
    if (!badge) return;
    const isPortrait = getCurrentOrientationKey() === 'portrait';
    badge.textContent = isPortrait ? 'Màn hình: Dọc' : 'Màn hình: Ngang';
}

function loadTouchLayoutConfig() {
    try {
        const rawV2 = localStorage.getItem(TOUCH_LAYOUT_STORAGE_KEY);
        if (rawV2) {
            const parsed = JSON.parse(rawV2);
            if (parsed && typeof parsed === 'object') {
                touchLayoutConfig.opacity = parsed.opacity ?? 100;
                touchLayoutConfig.portrait = parsed.portrait || {};
                touchLayoutConfig.landscape = parsed.landscape || {};
            }
        } else {
            const rawV1 = localStorage.getItem('delta_gba_touch_layout_v1');
            if (rawV1) {
                const parsedV1 = JSON.parse(rawV1);
                if (parsedV1 && typeof parsedV1 === 'object') {
                    touchLayoutConfig.opacity = parsedV1.opacity ?? 100;
                    const orientKey = getCurrentOrientationKey();
                    touchLayoutConfig[orientKey] = parsedV1.controls || {};
                }
            }
        }
    } catch (e) {}
    applySavedTouchPositions();
}

function saveTouchLayoutConfig() {
    try {
        localStorage.setItem(TOUCH_LAYOUT_STORAGE_KEY, JSON.stringify(touchLayoutConfig));
    } catch (e) {}
}

function applySavedTouchPositions() {
    updateOrientationBadgeUI();
    document.documentElement.style.setProperty('--touch-opacity', String((touchLayoutConfig.opacity ?? 100) / 100));
    const opSlider = document.getElementById('layout-opacity-slider');
    const opLabel = document.getElementById('layout-opacity-label');
    if (opSlider) opSlider.value = String(touchLayoutConfig.opacity ?? 100);
    if (opLabel) opLabel.textContent = `${touchLayoutConfig.opacity ?? 100}%`;

    const activeControls = getActiveOrientationControlsMap();

    document.querySelectorAll('#eclipse-touch-overlay .ctl').forEach(el => {
        const id = el.getAttribute('data-ctl-id');
        const cfg = activeControls?.[id];
        if (cfg) {
            if (typeof cfg.xPct === 'number' && typeof cfg.yPct === 'number') {
                el.style.left = `${cfg.xPct}%`;
                el.style.top = `${cfg.yPct}%`;
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            } else {
                el.style.left = '';
                el.style.top = '';
                el.style.right = '';
                el.style.bottom = '';
            }
            const sc = (cfg.scale ?? 100) / 100;
            if (id === 'MID' && typeof cfg.xPct !== 'number') {
                el.style.transform = `translateX(-50%) scale(${sc})`;
            } else {
                el.style.transform = `scale(${sc})`;
            }
        } else {
            el.style.left = '';
            el.style.top = '';
            el.style.right = '';
            el.style.bottom = '';
            el.style.transform = '';
        }
    });
}

window.addEventListener('resize', () => {
    applySavedTouchPositions();
    if (AppState.isEditingTouchLayout) {
        selectLayoutControl(AppState.selectedLayoutControlId);
    }
});
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        applySavedTouchPositions();
        if (AppState.isEditingTouchLayout) {
            selectLayoutControl(AppState.selectedLayoutControlId);
        }
    }, 120);
});

function enterTouchLayoutEditMode(origin = null) {
    AppState.layoutEditOriginView = origin || AppState.currentView || 'dashboard';

    if (!AppState.touchControlsVisible) {
        AppState.touchControlsVisible = true;
        if (typeof applyTouchControlsLayout === 'function') {
            applyTouchControlsLayout();
        }
    }

    if (AppState.romLoaded && !AppState.isPaused && typeof pauseGame === 'function') {
        pauseGame();
    }

    const screenWrapper = document.getElementById('gba-screen-wrapper');
    const previewBackdrop = document.getElementById('layout-preview-backdrop');
    if (AppState.layoutEditOriginView === 'dashboard') {
        if (screenWrapper) screenWrapper.classList.add('hidden');
        if (previewBackdrop) {
            previewBackdrop.classList.remove('hidden');
            previewBackdrop.classList.add('flex');
        }
    } else {
        if (screenWrapper) screenWrapper.classList.remove('hidden');
        if (previewBackdrop) {
            previewBackdrop.classList.add('hidden');
            previewBackdrop.classList.remove('flex');
        }
    }

    const dash = document.getElementById('view-dashboard');
    if (dash) dash.classList.add('hidden');
    const pv = document.getElementById('view-player');
    if (pv) {
        pv.classList.remove('hidden');
        pv.classList.add('flex');
    }

    const pauseOv = document.getElementById('pause-overlay');
    if (pauseOv) pauseOv.classList.add('hidden');
    AppState.isEditingTouchLayout = true;
    document.body.classList.add('layout-editing');
    const edBar = document.getElementById('touch-layout-editor-bar');
    if (edBar) edBar.classList.remove('hidden');
    selectLayoutControl(null);
    applySavedTouchPositions();

    const orientLabel = getCurrentOrientationKey() === 'portrait' ? 'Dọc' : 'Ngang';
    showToast(`Đang chỉnh bố cục màn hình ${orientLabel}. Kéo các nút tới vị trí mong muốn rồi bấm Lưu bố cục.`, 'info');
}

function exitTouchLayoutEditMode(saveChanges = true) {
    AppState.isEditingTouchLayout = false;
    document.body.classList.remove('layout-editing');
    const edBar = document.getElementById('touch-layout-editor-bar');
    if (edBar) edBar.classList.add('hidden');
    const bdrop = document.getElementById('layout-preview-backdrop');
    if (bdrop) {
        bdrop.classList.add('hidden');
        bdrop.classList.remove('flex');
    }
    const wrap = document.getElementById('gba-screen-wrapper');
    if (wrap) wrap.classList.remove('hidden');

    document.querySelectorAll('#eclipse-touch-overlay .ctl').forEach(el => el.classList.remove('ctl-selected'));
    if (saveChanges) {
        saveTouchLayoutConfig();
        const orientLabel = getCurrentOrientationKey() === 'portrait' ? 'Dọc' : 'Ngang';
        showToast(`Đã lưu bố cục nút ảo cho màn hình ${orientLabel}!`, 'success');
    }

    if (AppState.layoutEditOriginView === 'dashboard' || !AppState.romLoaded) {
        AppState.currentView = 'dashboard';
        const playerView = document.getElementById('view-player');
        if (playerView) {
            playerView.classList.add('hidden');
            playerView.classList.remove('flex');
        }
        const dash = document.getElementById('view-dashboard');
        if (dash) dash.classList.remove('hidden');
        if (typeof renderDashboardRomGrid === 'function') {
            renderDashboardRomGrid();
        }
    } else {
        AppState.currentView = 'player';
        if (typeof resumeGame === 'function') resumeGame();
    }
}

function selectLayoutControl(ctlId) {
    AppState.selectedLayoutControlId = ctlId;
    document.querySelectorAll('#eclipse-touch-overlay .ctl').forEach(el => {
        el.classList.toggle('ctl-selected', el.getAttribute('data-ctl-id') === ctlId);
    });
    const nameEl = document.getElementById('layout-selected-name');
    const scaleSlider = document.getElementById('layout-scale-slider');
    const scaleLabel = document.getElementById('layout-scale-label');
    const activeControls = getActiveOrientationControlsMap();

    if (!ctlId) {
        if (nameEl) nameEl.textContent = 'Tất cả';
        if (scaleSlider) scaleSlider.value = '100';
        if (scaleLabel) scaleLabel.textContent = '100%';
        return;
    }
    const el = document.querySelector(`#eclipse-touch-overlay .ctl[data-ctl-id="${ctlId}"]`);
    const label = el ? el.getAttribute('data-ctl-label') : ctlId;
    const curScale = activeControls?.[ctlId]?.scale ?? 100;
    if (nameEl) nameEl.textContent = label;
    if (scaleSlider) scaleSlider.value = String(curScale);
    if (scaleLabel) scaleLabel.textContent = `${curScale}%`;
}

function onTouchLayoutScaleInput(val) {
    const num = Number(val) || 100;
    const sLabel = document.getElementById('layout-scale-label');
    if (sLabel) sLabel.textContent = `${num}%`;
    const activeControls = getActiveOrientationControlsMap();
    const targetIds = AppState.selectedLayoutControlId
        ? [AppState.selectedLayoutControlId]
        : ['L', 'R', 'JOY', 'A', 'B', 'MID'];
    for (const id of targetIds) {
        if (!activeControls[id]) activeControls[id] = {};
        activeControls[id].scale = num;
    }
    applySavedTouchPositions();
}

function onTouchLayoutOpacityInput(val) {
    const num = Number(val) || 100;
    touchLayoutConfig.opacity = num;
    const oLabel = document.getElementById('layout-opacity-label');
    if (oLabel) oLabel.textContent = `${num}%`;
    document.documentElement.style.setProperty('--touch-opacity', String(num / 100));
}

async function resetTouchLayoutToDefault() {
    const orientKey = getCurrentOrientationKey();
    const orientLabel = orientKey === 'portrait' ? 'Dọc' : 'Ngang';
    const ok = await showGlassConfirm({
        title: `Đặt lại bố cục màn hình ${orientLabel}?`,
        message: `Vị trí và kích thước các nút ảo của chế độ màn hình ${orientLabel} sẽ về mặc định (bố cục chiều kia vẫn được giữ nguyên).`,
        confirmText: 'Đặt lại mặc định',
        cancelText: 'Hủy',
        danger: false
    });
    if (!ok) return;

    touchLayoutConfig[orientKey] = {};
    touchLayoutConfig.opacity = 100;
    saveTouchLayoutConfig();
    selectLayoutControl(null);
    applySavedTouchPositions();
    showToast(`Đã khôi phục bố cục nút ảo mặc định cho màn hình ${orientLabel}`, 'info');
}

function initTouchLayoutCustomizationDrag() {
    document.querySelectorAll('#eclipse-touch-overlay .ctl').forEach(ctlEl => {
        const ctlId = ctlEl.getAttribute('data-ctl-id');
        let dragging = false;
        let dragPointerId = null;
        let offsetX = 0;
        let offsetY = 0;

        ctlEl.addEventListener('pointerdown', (e) => {
            if (!AppState.isEditingTouchLayout) return;
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            dragPointerId = e.pointerId;
            selectLayoutControl(ctlId);
            const rect = ctlEl.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            try { ctlEl.setPointerCapture(dragPointerId); } catch (_) {}
        }, true);

        ctlEl.addEventListener('pointermove', (e) => {
            if (!AppState.isEditingTouchLayout || !dragging || e.pointerId !== dragPointerId) return;
            e.preventDefault();
            e.stopPropagation();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const rect = ctlEl.getBoundingClientRect();
            let newLeft = e.clientX - offsetX;
            let newTop = e.clientY - offsetY;
            newLeft = Math.max(0, Math.min(vw - rect.width, newLeft));
            newTop = Math.max(0, Math.min(vh - rect.height, newTop));

            const xPct = Math.round((newLeft / vw) * 1000) / 10;
            const yPct = Math.round((newTop / vh) * 1000) / 10;

            const activeControls = getActiveOrientationControlsMap();
            if (!activeControls[ctlId]) activeControls[ctlId] = {};
            activeControls[ctlId].xPct = xPct;
            activeControls[ctlId].yPct = yPct;
            applySavedTouchPositions();
        }, true);

        const endDrag = (e) => {
            if (!dragging || e.pointerId !== dragPointerId) return;
            dragging = false;
            dragPointerId = null;
            saveTouchLayoutConfig();
        };
        ctlEl.addEventListener('pointerup', endDrag, true);
        ctlEl.addEventListener('pointercancel', endDrag, true);
    });
}

/**************************************************************************
 * 8. KẾT NỐI TAY CẦM BÊN NGOÀI (HTML5 GAMEPAD API)
 **************************************************************************/
function safeGetGamepads() {
    try {
        if (typeof navigator.getGamepads === 'function') return navigator.getGamepads() || [];
    } catch (e) {}
    return [];
}

window.addEventListener('gamepadconnected', (e) => {
    updateGamepadIndicatorUI(e.gamepad);
    showToast(`Đã kết nối tay cầm: ${e.gamepad.id}`, 'success');
});

window.addEventListener('gamepaddisconnected', () => {
    updateGamepadIndicatorUI(null);
    showToast('Tay cầm ngoài đã ngắt kết nối', 'info');
});

function updateGamepadIndicatorUI(pad) {
    const modalName = document.getElementById('modal-gamepad-name');
    const modalBadge = document.getElementById('modal-gamepad-badge');
    if (pad) {
        if (modalName) modalName.textContent = pad.id;
        if (modalBadge) modalBadge.className = 'w-10 h-10 rounded-2xl bg-white/[0.1] border border-white/20 flex items-center justify-center text-white/[0.85]';
    } else {
        if (modalName) modalName.textContent = 'Chưa phát hiện tay cầm ngoài';
        if (modalBadge) modalBadge.className = 'w-10 h-10 rounded-2xl bg-white/[0.06] flex items-center justify-center text-white/60';
    }
}

function pollGamepad() {
    const pads = safeGetGamepads();
    const pad = pads[0];
    if (!pad) return;

    updateGamepadIndicatorUI(pad);

    if (AppState.remappingTarget && AppState.remappingTarget.mode === 'gamepad') {
        for (let i = 0; i < pad.buttons.length; i++) {
            if (pad.buttons[i].pressed) {
                const targetBtn = AppState.remappingTarget.btn;
                AppState.gamepadMap[targetBtn] = i;
                AppState.remappingTarget = null;
                saveCustomMappings();
                renderRemappingList();
                showToast(`Đã gán Button #${i} trên tay cầm cho nút ${targetBtn}`, 'success');
                break;
            }
        }
        return;
    }

    const pressedIndices = [];
    pad.buttons.forEach((b, idx) => {
        if (b.pressed) pressedIndices.push(`#${idx}`);
    });
    const liveInputEl = document.getElementById('modal-gamepad-live-input');
    if (liveInputEl && pressedIndices.length > 0) {
        liveInputEl.textContent = `Đang nhấn: ${pressedIndices.join(', ')}`;
    }

    const axisX = pad.axes[0] || 0;
    const axisY = pad.axes[1] || 0;
    const deadzone = 0.45;

    for (const btn of GBA_BUTTONS) {
        const btnIdx = AppState.gamepadMap[btn];
        let isPressed = !!(pad.buttons[btnIdx] && pad.buttons[btnIdx].pressed);

        if (btn === 'LEFT' && axisX < -deadzone) isPressed = true;
        if (btn === 'RIGHT' && axisX > deadzone) isPressed = true;
        if (btn === 'UP' && axisY < -deadzone) isPressed = true;
        if (btn === 'DOWN' && axisY > deadzone) isPressed = true;

        if (AppState.lastGamepadState[btn] !== isPressed) {
            AppState.lastGamepadState[btn] = isPressed;
            setGbaButtonState(btn, isPressed, 'gamepad');
        }
    }
}

function testGamepadRumble() {
    const pads = safeGetGamepads();
    const pad = pads[0];
    if (!pad) {
        showToast('Hãy kết nối tay cầm Bluetooth/USB và bấm 1 nút trước khi Test Rung!', 'error');
        return;
    }
    if (pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
        pad.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: 320,
            weakMagnitude: 0.7,
            strongMagnitude: 1.0
        });
        showToast('Đang kích hoạt mô-tơ rung trên tay cầm!', 'success');
    } else {
        triggerHaptic(150, true);
        showToast('Trình duyệt hoặc tay cầm này không hỗ trợ API Dual-Rumble', 'info');
    }
}
