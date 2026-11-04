/**************************************************************************
 * 11. NHẬP FILE ROM, XÓA ROM ĐỒNG BỘ & XÓA HẾT GAME (DÙNG POPUP KÍNH MỜ)
 **************************************************************************/
function triggerFileInput() {
    document.getElementById('rom-file-input').click();
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
}

async function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) await processRomFile(file);
}

async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) await processRomFile(file);
    e.target.value = '';
}

async function processRomFile(file) {
    if (!file.name.match(/\.(gba|bin|agb)$/i)) {
        showToast('Vui lòng chọn đúng định dạng file băng GBA (.gba, .agb hoặc .bin)', 'error');
        return;
    }
    const buffer = await file.arrayBuffer();
    await bootGbaRom(buffer, file.name);
}

async function bootCachedRom(romId) {
    const meta = await getRomMetaById(romId);
    const buffer = await getRomDataFromDB(romId);
    if (!meta || !buffer) {
        showToast('Không tìm thấy dữ liệu nhị phân của ROM này trong bộ nhớ!', 'error');
        return;
    }
    await bootGbaRom(buffer, meta.fileName);
}

// Xóa 1 ROM kèm Save State, Cheat và .sav bằng Popup kính mờ
async function removeCachedRom(romId, skipConfirm = false) {
    const target = await getRomMetaById(romId);
    const title = target ? target.title : romId;

    if (!skipConfirm) {
        const ok = await showGlassConfirm({
            title: `Xóa game "${title}"?`,
            message: `Băng game này cùng toàn bộ Save State, mã Cheat và file .sav đi kèm sẽ bị xóa vĩnh viễn khỏi trình duyệt.`,
            confirmText: 'Xóa vĩnh viễn',
            cancelText: 'Hủy',
            danger: true
        });
        if (!ok) return;
    }

    if (AppState.romLoaded && AppState.currentRom.id === romId) {
        stopAutoSaveLoop();
        if (AppState.nostalgistInstance) {
            try { AppState.nostalgistInstance.exit(); } catch (_) {}
            AppState.nostalgistInstance = null;
        }
        AppState.romLoaded = false;
        AppState.currentRom.id = null;
        document.getElementById('mobile-resume-pill')?.classList.add('hidden');
    }

    await deleteRomAndAllAssociatedDataFromDB(romId);
    await renderDashboardRomGrid();
    showToast(`Đã xóa game "${title}" cùng toàn bộ Save State, Cheat và file .sav đi kèm!`, 'success');
}

// Xóa hết game kèm toàn bộ Save State, Cheat và .sav bằng Popup kính mờ
async function confirmClearAllGames() {
    const metas = await getAllRomMetasFromDB();
    if (metas.length === 0) {
        showToast('Kệ game hiện đang trống!', 'info');
        return;
    }
    const ok = await showGlassConfirm({
        title: `Xóa hết ${metas.length} game trên kệ?`,
        message: `Toàn bộ ROM game, Save State, mã Cheat và dữ liệu .sav của tất cả ${metas.length} game sẽ bị xóa sạch vĩnh viễn.`,
        confirmText: 'Xóa hết game',
        cancelText: 'Hủy',
        danger: true
    });
    if (!ok) return;

    stopAutoSaveLoop();
    if (AppState.nostalgistInstance) {
        try { AppState.nostalgistInstance.exit(); } catch (_) {}
        AppState.nostalgistInstance = null;
    }
    AppState.romLoaded = false;
    AppState.currentRom.id = null;
    document.getElementById('mobile-resume-pill')?.classList.add('hidden');

    await clearAllGamesAndDataFromDB();
    await renderDashboardRomGrid();
    showToast('Đã xóa hết game cùng toàn bộ Save State, Cheat và dữ liệu .sav!', 'success');
}

/**************************************************************************
 * 12. CÁC ĐIỀU KHIỂN DELTA MENU, PAUSE, FAST FORWARD THỰC TẾ, SHADER, REMAP
 **************************************************************************/
function openDeltaMenu() {
    captureCanvasFrameSync();
    AppState.menuWasRunning = !AppState.isPaused;
    pauseGame();
    document.getElementById('pause-overlay').classList.add('hidden');
    document.getElementById('delta-menu-modal').classList.remove('hidden');
    document.getElementById('delta-menu-modal').classList.add('flex');
    if (typeof updateFastForwardUI === 'function') updateFastForwardUI();
    updateMenuToggleIcons();
}

function closeDeltaMenu() {
    if (AppState.isPaused && AppState.currentView === 'player') {
        document.getElementById('pause-overlay').classList.remove('hidden');
    }
    document.getElementById('delta-menu-modal').classList.add('hidden');
    document.getElementById('delta-menu-modal').classList.remove('flex');
}

function closeDeltaMenuToModal() {
    AppState.autoResumePending = !!AppState.menuWasRunning;
    AppState.menuWasRunning = false;
    document.getElementById('pause-overlay').classList.add('hidden');
    document.getElementById('delta-menu-modal').classList.add('hidden');
    document.getElementById('delta-menu-modal').classList.remove('flex');
}

function autoResumeAfterModal() {
    if (!AppState.autoResumePending) return;
    AppState.autoResumePending = false;
    if (AppState.currentView === 'player' && AppState.isPaused) resumeGame();
}

function pauseGame() {
    captureCanvasFrameSync();
    persistBatterySave().catch(() => {});
    AppState.isPaused = true;
    if (AppState.nostalgistInstance && AppState.activeCoreMode === 'mGBA WASM') {
        try { AppState.nostalgistInstance.pause(); } catch (e) {}
    }
    document.getElementById('pause-overlay').classList.remove('hidden');
}

function resumeGame() {
    AppState.isPaused = false;
    if (AppState.nostalgistInstance && AppState.activeCoreMode === 'mGBA WASM') {
        try { AppState.nostalgistInstance.resume(); } catch (e) {}
    }
    document.getElementById('pause-overlay').classList.add('hidden');
    closeDeltaMenu();
}

function setRetroArchFastForwardState(shouldBeActive) {
    if (typeof FF_MODE !== 'undefined' && FF_MODE !== 'retroarch') return;
    const nl = AppState.nostalgistInstance;
    if (!nl || AppState.retroFastForwardActive === shouldBeActive) return;
    try {
        if (typeof nl.sendCommand === 'function') {
            nl.sendCommand('FAST_FORWARD');
            AppState.retroFastForwardActive = shouldBeActive;
            return;
        }
    } catch (e) {}
    ['keydown', 'keyup'].forEach(type => {
        const evt = new KeyboardEvent(type, { code: 'F9', key: 'F9', bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'keyCode', { get: () => 120 });
        Object.defineProperty(evt, 'which', { get: () => 120 });
        document.dispatchEvent(evt);
    });
    AppState.retroFastForwardActive = shouldBeActive;
}

function updateFastForwardUI() {
    const menuFf = document.getElementById('menu-ff-text');
    const hudFf = document.getElementById('hud-ff-badge');
    if (menuFf) menuFf.textContent = `${AppState.fastForwardSpeed}x`;
    document.querySelectorAll('.ff-opt').forEach(el => {
        el.classList.toggle('active', Number(el.getAttribute('data-ff')) === AppState.fastForwardSpeed);
    });
    if (hudFf) {
        hudFf.innerHTML = `<i class="fa-solid fa-forward-fast mr-1"></i>${AppState.fastForwardSpeed}x`;
        hudFf.classList.toggle('opacity-50', AppState.fastForwardSpeed <= 1);
    }
}

// BẬT / TẮT Fast Forward 100% NATIVE
function setFastForwardSpeed(speed) {
    const n = Number(speed) || 1;
    AppState.fastForwardSpeed = n;
    
    // Bật Native Fast Forward nếu chọn 2x, 3x, 4x. Tắt nếu chọn 1x.
    if (typeof FF_MODE === 'undefined' || FF_MODE === 'retroarch') {
        setRetroArchFastForwardState(n > 1);
    }
    
    if (typeof triggerHaptic === 'function') triggerHaptic(40);
    updateFastForwardUI();
}

function cycleFastForward() {
    const speeds = [1, 2, 3, 4];
    const nextIdx = (speeds.indexOf(AppState.fastForwardSpeed) + 1) % speeds.length;
    setFastForwardSpeed(speeds[nextIdx]);
}

// 1b. Danh sách 4 bộ lọc chuẩn (Integer là mặc định)
const FILTER_MODES = [
    { value: 'integer', label: 'Pixel Tỉ Lệ' },
    { value: 'pixelated', label: 'Pixel Sắc Nét' },
    { value: 'warm', label: 'Màu Ấm GBA' },
    { value: 'smooth', label: 'Khử Răng Cưa' }
];

function applyScreenFilter(filterValue) {
    AppState.currentFilter = filterValue;
    try {
        localStorage.setItem('delta_gba_filter', filterValue);
    } catch (e) {}

    const wrapper = document.getElementById('gba-screen-wrapper');
    if (wrapper) {
        wrapper.classList.remove('filter-pixelated', 'filter-smooth', 'filter-warm');
        if (filterValue === 'integer' || filterValue === 'pixelated') {
            wrapper.classList.add('filter-pixelated');
        } else if (filterValue === 'smooth') {
            wrapper.classList.add('filter-smooth');
        } else if (filterValue === 'warm') {
            wrapper.classList.add('filter-warm');
        }
    }

    if (typeof updateIntegerScaleStage === 'function') {
        updateIntegerScaleStage();
    }

    const cur = FILTER_MODES.find(f => f.value === filterValue);
    const label = document.getElementById('menu-filter-text');
    if (label && cur) {
        label.textContent = cur.label;
    }
}

function cycleScreenFilter(btn) {
    const curIdx = FILTER_MODES.findIndex(f => f.value === AppState.currentFilter);
    const next = FILTER_MODES[(curIdx + 1) % FILTER_MODES.length];
    applyScreenFilter(next.value);
    showToast(`Bộ lọc màn hình: ${next.label}`, 'info');
}

function sendEmulatorMuteHotkey() {
    setEmuAudioMuted(AppState.isMuted);
}

function updateMenuToggleIcons() {
    const aIcon = document.getElementById('menu-audio-icon');
    const aText = document.getElementById('menu-audio-text');
    if (aIcon) aIcon.classList.toggle('icon-off', !!AppState.isMuted);
    if (aText) aText.textContent = AppState.isMuted ? 'Tắt' : 'Bật';
    const tIcon = document.getElementById('menu-touch-icon');
    const tText = document.getElementById('menu-touch-text');
    if (tIcon) tIcon.classList.toggle('icon-off', !AppState.touchControlsVisible);
    if (tText) tText.textContent = AppState.touchControlsVisible ? 'Bật' : 'Tắt';
}

function toggleMute() {
    AppState.isMuted = !AppState.isMuted;
    setEmuAudioMuted(AppState.isMuted);
    try { localStorage.setItem('delta_gba_muted', AppState.isMuted ? '1' : '0'); } catch (e) {}
    updateMenuToggleIcons();
    const setAudio = document.getElementById('set-audio-toggle');
    if (setAudio) setAudio.checked = !AppState.isMuted;
    showToast(AppState.isMuted ? 'Đã tắt âm thanh' : 'Đã bật âm thanh', 'info');
}

async function restartCurrentRom() {
    closeDeltaMenu();
    if (!AppState.romLoaded || !AppState.currentRom.buffer) {
        showToast('Chưa có ROM nào đang nạp để khởi động lại', 'error');
        return;
    }
    await bootGbaRom(AppState.currentRom.buffer, AppState.currentRom.fileName);
    showToast('Đã khởi động lại băng game', 'info');
}

function openControllerModal() {
    document.getElementById('controller-modal').classList.remove('hidden');
    document.getElementById('controller-modal').classList.add('flex');
    renderRemappingList();
}

function closeControllerModal() {
    AppState.remappingTarget = null;
    document.getElementById('controller-modal').classList.add('hidden');
    document.getElementById('controller-modal').classList.remove('flex');
    autoResumeAfterModal();
}

function startRemap(btn, mode) {
    AppState.remappingTarget = { btn, mode };
    renderRemappingList();
}

function renderRemappingList() {
    const container = document.getElementById('remapping-list');
    container.innerHTML = GBA_BUTTONS.map(btn => {
        const isWaitingKey = AppState.remappingTarget?.btn === btn && AppState.remappingTarget?.mode === 'keyboard';
        const isWaitingPad = AppState.remappingTarget?.btn === btn && AppState.remappingTarget?.mode === 'gamepad';
        return `
            <div class="p-2.5 rounded-2xl bg-black/[0.35] border border-white/20 flex items-center justify-between gap-2">
                <span class="text-xs font-extrabold text-white w-14 shrink-0">${btn}</span>
                <button onclick="startRemap('${btn}', 'keyboard')" class="flex-1 min-w-0 py-1.5 px-2 rounded-xl text-[11px] font-mono font-bold border truncate ${isWaitingKey ? 'bg-white text-black border-white animate-pulse' : 'bg-black/[0.35] border-white/20 text-white/90 hover:border-white/40'}">
                    <i class="fa-regular fa-keyboard mr-1 opacity-70"></i><span class="truncate">${isWaitingKey ? 'Nhấn phím...' : AppState.keyMap[btn]}</span>
                </button>
                <button onclick="startRemap('${btn}', 'gamepad')" class="flex-1 min-w-0 py-1.5 px-2 rounded-xl text-[11px] font-mono font-bold border truncate ${isWaitingPad ? 'bg-white text-black border-white animate-pulse' : 'bg-black/[0.35] border-white/20 text-white/[0.85] hover:border-white/40'}">
                    <i class="fa-solid fa-gamepad mr-1 opacity-70"></i><span class="truncate">${isWaitingPad ? 'Bấm nút...' : 'Btn #' + AppState.gamepadMap[btn]}</span>
                </button>
            </div>
        `;
    }).join('');
}

function saveCustomMappings() {
    localStorage.setItem('delta_gba_keymap', JSON.stringify(AppState.keyMap));
    localStorage.setItem('delta_gba_padmap', JSON.stringify(AppState.gamepadMap));
    localStorage.setItem('delta_gba_haptic', AppState.hapticEnabled ? '1' : '0');
}

function loadCustomMappings() {
    try {
        const savedKeys = localStorage.getItem('delta_gba_keymap');
        const savedPad = localStorage.getItem('delta_gba_padmap');
        if (savedKeys) Object.assign(AppState.keyMap, JSON.parse(savedKeys));
        if (savedPad) Object.assign(AppState.gamepadMap, JSON.parse(savedPad));
        if (localStorage.getItem('delta_gba_hide_controls') === '1') AppState.touchControlsVisible = false;
        if (localStorage.getItem('delta_gba_muted') === '1') {
            AppState.isMuted = true;
            setEmuAudioMuted(true);
            const menuAudio = document.getElementById('menu-audio-text');
            if (menuAudio) menuAudio.textContent = 'Tắt';
        }
        const savedHaptic = localStorage.getItem('delta_gba_haptic');
        if (savedHaptic !== null) AppState.hapticEnabled = (savedHaptic === '1');

        const savedFilter = localStorage.getItem('delta_gba_filter');
        if (savedFilter && FILTER_MODES.some(f => f.value === savedFilter)) {
            AppState.currentFilter = savedFilter;
        }

        const savedLcd = localStorage.getItem('delta_gba_lcd_grid');
        AppState.lcdGridEnabled = (savedLcd === '1');
    } catch (e) {}
}

function resetDefaultMappings() {
    localStorage.removeItem('delta_gba_keymap');
    localStorage.removeItem('delta_gba_padmap');
    AppState.keyMap = {
        UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
        A: 'KeyX', B: 'KeyZ', L: 'KeyQ', R: 'KeyE', START: 'Enter', SELECT: 'ShiftRight'
    };
    AppState.gamepadMap = {
        B: 0, A: 1, SELECT: 8, START: 9, L: 4, R: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15
    };
    AppState.remappingTarget = null;
    renderRemappingList();
    showToast('Đã khôi phục cấu hình phím mặc định', 'info');
}

/**************************************************************************
 * 13. HỆ THỐNG THÔNG BÁO TOAST (TRẮNG - ĐEN - KÍNH MỜ, ĐỎ CHO LỖI)
 **************************************************************************/
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const colorMap = {
        success: 'bg-black/80 backdrop-blur-xl border-white/30 text-white',
        error: 'bg-red-500/20 backdrop-blur-xl border-red-400/35 text-red-100',
        info: 'bg-black/75 backdrop-blur-xl border-white/20 text-white/90'
    };
    const iconMap = {
        success: 'fa-circle-check text-white',
        error: 'fa-triangle-exclamation text-red-300',
        info: 'fa-circle-info text-white/85'
    };

    toast.className = `max-w-[92vw] px-4 py-2.5 rounded-2xl border shadow-2xl backdrop-blur-md text-xs font-bold flex items-center gap-2 transition-all duration-300 ${colorMap[type] || colorMap.info}`;
    const iconEl = document.createElement('i');
    iconEl.className = `fa-solid ${iconMap[type] || iconMap.info} shrink-0`;
    const textEl = document.createElement('span');
    textEl.textContent = message;
    textEl.className = 'leading-relaxed';
    toast.append(iconEl, textEl);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        setTimeout(() => toast.remove(), 280);
    }, 2800);
}

/**************************************************************************
 * KHỞI ĐỘNG HỆ THỐNG
 **************************************************************************/
document.addEventListener('DOMContentLoaded', async () => {
    await initIndexedDB();
    loadCustomMappings();
    loadTouchLayoutConfig();
    initVirtualControls();
    applyTouchControlsLayout();

    if (typeof applyScreenFilter === 'function') {
        applyScreenFilter(AppState.currentFilter);
    }
    const overlay = document.getElementById('lcd-grid');
    if (overlay) {
        overlay.classList.toggle('active-lcd', AppState.lcdGridEnabled);
    }

    if (typeof migrateRomIdsAndData === 'function') {
        await migrateRomIdsAndData();
    }

    await renderDashboardRomGrid();
    autoFetchMissingCoversForLibrary().catch(() => {});

    setTimeout(() => {
        if (typeof ensureNostalgist === 'function') {
            ensureNostalgist().catch(() => {});
        }
    }, 1500);

    nativeRequestAnimationFrame(mainEmulatorLoop);

    // Đăng ký Service Worker cho PWA (Hỗ trợ cài đặt & chạy Offline)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        });
    }

});

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

                // Cấu hình NATIVE để trị dứt điểm lỗi màn hình 120Hz (như Oppo) chạy x2 tốc độ
                video_vsync: 'true',
                audio_sync: 'true',
                audio_rate_control: 'true',
                vrr_runloop_enable: 'true', // Bật hỗ trợ màn hình tần số quét biến thiên / cao

                // Cấu hình Fast Forward Native (0.0 = Không giới hạn, chạy bung nóc sức mạnh máy)
                fastforward_ratio: '0.0',
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
