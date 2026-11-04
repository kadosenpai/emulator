/**************************************************************************
 * 5. QUẢN LÝ KỆ BĂNG, MENU HÀNH ĐỘNG & XÓA GAME ĐỒNG BỘ
 **************************************************************************/
let cardLongPressTimer = null;
let cardLongPressTriggered = false;
let activeCoverEditRomId = null;
let sheetRomId = null;

function handleCardPointerDown(event, romId) {
    if (event.button && event.button !== 0) return;
    cardLongPressTriggered = false;
    clearTimeout(cardLongPressTimer);
    cardLongPressTimer = setTimeout(() => {
        cardLongPressTriggered = true;
        triggerHaptic(35);
        openGameActionSheet(romId);
    }, 520);
}

function handleCardPointerCancel() {
    clearTimeout(cardLongPressTimer);
}

function handleCardClick(event, romId) {
    if (cardLongPressTriggered) {
        event.preventDefault();
        event.stopPropagation();
        cardLongPressTriggered = false;
        return;
    }
    bootCachedRom(romId);
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatRelativeTime(ts) {
    if (!ts) return 'Chưa chơi';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Vừa xong';
    if (min < 60) return `${min} phút trước`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} giờ trước`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} ngày trước`;
    return new Date(ts).toLocaleDateString('vi-VN');
}

async function openGameActionSheet(romId) {
    const r = await getRomMetaById(romId);
    if (!r) return;
    sheetRomId = romId;

    const statesCount = await countSaveStatesForRom(romId);
    const cheats = await loadCheatsForRom(romId);
    const sram = await getSramFromDB(romId);
    const sizeMb = (r.sizeBytes / (1024 * 1024)).toFixed(1);
    const isRunning = AppState.romLoaded && AppState.currentRom.id === romId;

    const cover = document.getElementById('sheet-cover');
    if (cover) cover.src = r.coverUrl || DEFAULT_COVER_PLACEHOLDER;
    const sTitle = document.getElementById('sheet-title');
    if (sTitle) sTitle.textContent = r.title;
    const sSub = document.getElementById('sheet-sub');
    if (sSub) sSub.textContent = `${r.gameCode} • ${sizeMb} MB • ${r.saveType}`;
    const sExtra = document.getElementById('sheet-extra');
    if (sExtra) sExtra.textContent = `Chơi lần cuối: ${formatRelativeTime(r.lastPlayed)} • ${statesCount} save state`;
    const sPlay = document.getElementById('sheet-play-label');
    if (sPlay) sPlay.textContent = isRunning ? 'Quay lại màn hình chơi' : 'Chơi ngay';

    const sRen = document.getElementById('sheet-rename');
    if (sRen) sRen.classList.add('hidden');
    const sInf = document.getElementById('sheet-info');
    if (sInf) sInf.classList.add('hidden');

    if (sInf) {
        sInf.innerHTML = `
            <div class="flex justify-between gap-3"><span class="text-white/50">File gốc</span><span class="truncate text-right">${escapeHtml(r.fileName)}</span></div>
            <div class="flex justify-between gap-3"><span class="text-white/50">Mã Game / Maker</span><span>${escapeHtml(r.gameCode)} / ${escapeHtml(r.makerCode || '01')}</span></div>
            <div class="flex justify-between gap-3"><span class="text-white/50">Dung lượng ROM</span><span>${sizeMb} MB (Đã tách riêng)</span></div>
            <div class="flex justify-between gap-3"><span class="text-white/50">Kiểu lưu (.sav)</span><span class="text-right">${escapeHtml(r.saveType)}</span></div>
            <div class="flex justify-between gap-3"><span class="text-white/50">Dữ liệu .sav</span><span>${sram ? Math.round(sram.size / 1024 * 10) / 10 + ' KB' : 'Chưa có'}</span></div>
            <div class="flex justify-between gap-3"><span class="text-white/50">Save States / Cheats</span><span>${statesCount} khe / ${cheats.length} mã</span></div>`;
    }

    const m = document.getElementById('game-action-sheet');
    if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');
    }
}

function closeGameActionSheet() {
    const m = document.getElementById('game-action-sheet');
    if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
    }
    sheetRomId = null;
}

async function sheetPlay() {
    const id = sheetRomId;
    closeGameActionSheet();
    if (AppState.romLoaded && AppState.currentRom.id === id) { switchToPlayerView(); return; }
    await bootCachedRom(id);
}

function sheetChangeCover() {
    const id = sheetRomId;
    closeGameActionSheet();
    openCoverArtModal(id);
}

async function sheetExportSaves() {
    if (sheetRomId) await exportSavForRom(sheetRomId);
}

async function sheetOpenStates() {
    const id = sheetRomId;
    closeGameActionSheet();
    if (AppState.romLoaded && AppState.currentRom.id === id) {
        openSaveStateModal();
    } else {
        showToast('Hãy mở game này trước, rồi dùng Save State trong menu Δ', 'info');
    }
}

function sheetToggleRename() {
    const box = document.getElementById('sheet-rename');
    if (!box) return;
    const willShow = box.classList.contains('hidden');
    const sInf = document.getElementById('sheet-info');
    if (sInf) sInf.classList.add('hidden');
    box.classList.toggle('hidden', !willShow);
    if (willShow) {
        const inp = document.getElementById('sheet-rename-input');
        const tit = document.getElementById('sheet-title');
        if (inp && tit) {
            inp.value = tit.textContent;
            inp.focus();
        }
    }
}

async function sheetSaveRename() {
    const inp = document.getElementById('sheet-rename-input');
    const name = inp ? inp.value.trim() : '';
    if (!name || !sheetRomId) return;
    const r = await getRomMetaById(sheetRomId);
    if (!r) return;
    r.title = name;
    r.customTitle = name;
    await saveRomMetaToDB(r);
    if (AppState.romLoaded && AppState.currentRom.id === r.id) AppState.currentRom.title = name;
    const tit = document.getElementById('sheet-title');
    if (tit) tit.textContent = name;
    const box = document.getElementById('sheet-rename');
    if (box) box.classList.add('hidden');
    await renderDashboardRomGrid();
    showToast('Đã đổi tên băng game', 'success');
}

function sheetToggleInfo() {
    const ren = document.getElementById('sheet-rename');
    if (ren) ren.classList.add('hidden');
    const inf = document.getElementById('sheet-info');
    if (inf) inf.classList.toggle('hidden');
}

async function sheetDelete() {
    const id = sheetRomId;
    closeGameActionSheet();
    if (id) await removeCachedRom(id);
}

async function openCoverArtModal(romId) {
    activeCoverEditRomId = romId;
    const found = await getRomMetaById(romId);
    if (!found) return;

    const tit = document.getElementById('cover-modal-rom-title');
    if (tit) tit.textContent = `${found.title} (${found.fileName})`;
    const prev = document.getElementById('cover-modal-preview');
    if (prev) prev.src = found.coverUrl || DEFAULT_COVER_PLACEHOLDER;

    const modal = document.getElementById('cover-art-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeCoverArtModal() {
    const modal = document.getElementById('cover-art-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    activeCoverEditRomId = null;
}

function triggerCustomCoverUpload() {
    const inp = document.getElementById('cover-image-input');
    if (inp) inp.click();
}

async function handleCustomCoverFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeCoverEditRomId) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
        let dataUrl = ev.target.result;
        if (typeof shrinkImageDataUrl === 'function') {
            dataUrl = await shrinkImageDataUrl(dataUrl, 360, 0.85);
        }
        await applyCoverUrlToRom(activeCoverEditRomId, dataUrl, 'CUSTOM_UPLOAD', true);
        const prev = document.getElementById('cover-modal-preview');
        if (prev) prev.src = dataUrl;
        showToast('Đã cập nhật ảnh đại diện tải lên từ máy!', 'success');
    };
    reader.readAsDataURL(file);
}

async function applyCoverUrlToRom(romId, coverUrl, sourceType = 'CUSTOM', lockCover = true) {
    const found = await getRomMetaById(romId);
    if (!found) return;
    found.coverUrl = coverUrl;
    found.coverSource = sourceType;
    found.customCoverLocked = lockCover;
    await saveRomMetaToDB(found);
    await renderDashboardRomGrid();
}

function switchToPlayerView() {
    if (!AppState.romLoaded) {
        showToast('Hãy chọn hoặc nhập 1 file ROM .gba để mở màn hình chơi!', 'info');
        return;
    }
    AppState.currentView = 'player';
    const dash = document.getElementById('view-dashboard');
    if (dash) dash.classList.add('hidden');
    const bdrop = document.getElementById('layout-preview-backdrop');
    if (bdrop) {
        bdrop.classList.add('hidden');
        bdrop.classList.remove('flex');
    }
    const wrap = document.getElementById('gba-screen-wrapper');
    if (wrap) wrap.classList.remove('hidden');

    const playerView = document.getElementById('view-player');
    if (playerView) {
        playerView.classList.remove('hidden');
        playerView.classList.add('flex');
    }
    applyTouchControlsLayout();
    applySavedTouchPositions();
    if (typeof updateIntegerScaleStage === 'function') {
        updateIntegerScaleStage();
    }
    resumeGame();
}

function switchToLibraryView() {
    if (AppState.isEditingTouchLayout) exitTouchLayoutEditMode(false);
    AppState.autoResumePending = false;
    AppState.menuWasRunning = false;
    pauseGame();
    AppState.currentView = 'dashboard';
    try { if (document.fullscreenElement) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } } catch (e) {}
    const playerView = document.getElementById('view-player');
    if (playerView) {
        playerView.classList.add('hidden');
        playerView.classList.remove('flex');
    }
    const dash = document.getElementById('view-dashboard');
    if (dash) dash.classList.remove('hidden');
    renderDashboardRomGrid();
}

function toggleTouchControlsVisibility() {
    AppState.touchControlsVisible = !AppState.touchControlsVisible;
    try { localStorage.setItem('delta_gba_hide_controls', AppState.touchControlsVisible ? '0' : '1'); } catch (e) {}
    applyTouchControlsLayout();
    if (typeof updateMenuToggleIcons === 'function') updateMenuToggleIcons();
    showToast(
        AppState.touchControlsVisible
            ? 'Đã hiện bàn phím cảm ứng ảo'
            : 'Đã ẩn bàn phím ảo',
        'info'
    );
}

function applyTouchControlsLayout() {
    const overlay = document.getElementById('eclipse-touch-overlay');
    const playerView = document.getElementById('view-player');
    const fb = document.getElementById('menu-fallback');
    if (!overlay || !playerView) return;
    if (fb) fb.classList.toggle('hidden', AppState.touchControlsVisible);
    if (AppState.touchControlsVisible) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

function getCoverGradientFromCode(code = 'AGB0') {
    const palettes = [
        'from-white/[0.14] via-white/[0.04] to-black/85',
        'from-white/[0.18] via-white/[0.05] to-black/90',
        'from-white/[0.10] via-white/[0.03] to-black/80'
    ];
    let sum = 0;
    for (let i = 0; i < code.length; i++) sum += code.charCodeAt(i);
    return palettes[sum % palettes.length];
}

function getLibrarySort() {
    try { return localStorage.getItem('delta_library_sort') || 'recent'; } catch (e) { return 'recent'; }
}

function syncSettingsUI() {
    const a = document.getElementById('set-audio-toggle');
    const h = document.getElementById('set-hide-controls-toggle');
    const hap = document.getElementById('set-haptic-toggle');
    const lcd = document.getElementById('set-lcd-grid-toggle');
    if (a) a.checked = !AppState.isMuted;
    if (h) h.checked = !AppState.touchControlsVisible;
    if (hap) hap.checked = !!AppState.hapticEnabled;
    if (lcd) lcd.checked = !!AppState.lcdGridEnabled;
}

function settingsToggleHaptic(on) {
    AppState.hapticEnabled = !!on;
    try {
        localStorage.setItem('delta_gba_haptic', AppState.hapticEnabled ? '1' : '0');
    } catch (e) {}
    if (AppState.hapticEnabled && typeof triggerHaptic === 'function') {
        triggerHaptic(15, true);
    }
    syncSettingsUI();
}

function settingsToggleLcdGrid(on) {
    AppState.lcdGridEnabled = !!on;
    try {
        localStorage.setItem('delta_gba_lcd_grid', AppState.lcdGridEnabled ? '1' : '0');
    } catch (e) {}
    const overlay = document.getElementById('lcd-grid');
    if (overlay) {
        overlay.classList.toggle('active-lcd', AppState.lcdGridEnabled);
    }
    syncSettingsUI();
    showToast(AppState.lcdGridEnabled ? 'Đã bật lưới LCD cũ' : 'Đã tắt lưới LCD cũ', 'info');
}

function openSettingsModal() {
    closeMobileMenu();
    syncSettingsUI();
    const m = document.getElementById('settings-modal');
    if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');
    }
}

function closeSettingsModal() {
    const m = document.getElementById('settings-modal');
    if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
    }
}

function settingsToggleAudio(on) {
    if (on === AppState.isMuted && typeof toggleMute === 'function') toggleMute();
    syncSettingsUI();
}

function settingsToggleHideControls() {
    toggleTouchControlsVisibility();
    syncSettingsUI();
}

function settingsOpenKeyboard() {
    closeSettingsModal();
    if (typeof openControllerModal === 'function') openControllerModal();
}

function settingsOpenTouchCustomization() {
    closeSettingsModal();
    if (typeof enterTouchLayoutEditMode === 'function') enterTouchLayoutEditMode('dashboard');
}

let mobileMenuKind = null;
function closeMobileMenu() {
    const m = document.getElementById('mobile-menu');
    if (m) m.classList.add('hidden');
    mobileMenuKind = null;
}

function toggleMobileMenu(kind) {
    const m = document.getElementById('mobile-menu');
    if (!m) return;
    if (mobileMenuKind === kind) { closeMobileMenu(); return; }
    mobileMenuKind = kind;
    const item = (icon, label, action, extra = '') =>
        `<button class="m-menu-item ${extra}" onclick="closeMobileMenu(); ${action}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`;

    const cur = getLibrarySort();
    const sortItem = (val, label) =>
        item(cur === val ? 'fa-check' : 'fa-minus', label, `setLibrarySort('${val}')`, cur === val ? 'font-extrabold' : '');
    const hasRoms = !document.getElementById('clear-library-btn')?.classList.contains('hidden');
    m.innerHTML =
        sortItem('recent', 'Chơi gần đây') +
        sortItem('name', 'Tên A–Z') +
        sortItem('size', 'Dung lượng') +
        (hasRoms
            ? '<div class="my-1 border-t border-white/10"></div>' +
              item('fa-trash-can', 'Xóa hết game', 'confirmClearAllGames()', '!text-red-300')
            : '');
    m.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
    if (mobileMenuKind && !e.target.closest('#mobile-menu') && !e.target.closest('[onclick^="toggleMobileMenu"]')) {
        closeMobileMenu();
    }
});

function setLibrarySort(mode) {
    try { localStorage.setItem('delta_library_sort', mode); } catch (e) {}
    renderDashboardRomGrid();
}

async function renderDashboardRomGrid() {
    const gridEl = document.getElementById('dashboard-rom-grid');
    if (!gridEl) return;

    const allRoms = await getAllRomMetasFromDB();
    const sortMode = getLibrarySort();
    const sortSel = document.getElementById('library-sort-select');
    if (sortSel && sortSel.value !== sortMode) sortSel.value = sortMode;
    allRoms.sort((a, b) => {
        if (sortMode === 'name') return a.title.localeCompare(b.title, 'vi');
        if (sortMode === 'size') return (b.sizeBytes || 0) - (a.sizeBytes || 0);
        return (b.lastPlayed || 0) - (a.lastPlayed || 0);
    });

    const gridCounter = document.getElementById('grid-rom-counter');
    if (gridCounter) gridCounter.textContent = `(${allRoms.length} băng)`;

    const clearBtn = document.getElementById('clear-library-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', allRoms.length === 0);

    const query = (document.getElementById('library-search-input')?.value || '').trim().toLowerCase();
    const filtered = query
        ? allRoms.filter(r => r.title.toLowerCase().includes(query) || r.gameCode.toLowerCase().includes(query) || r.fileName.toLowerCase().includes(query))
        : allRoms;

    if (filtered.length === 0) {
        gridEl.innerHTML = `
            <div class="col-span-full py-12 px-6 rounded-3xl bg-white/[0.06] border border-white/5 text-center">
                <div class="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3 text-white/[0.45]">
                    <i class="fa-solid fa-box-open text-xl"></i>
                </div>
                <p class="text-sm font-bold text-white/90">
                    ${allRoms.length === 0 ? 'Kệ băng của bạn đang trống' : 'Không tìm thấy băng ROM phù hợp'}
                </p>
                <p class="text-xs text-white/[0.45] mt-1 max-w-md mx-auto">
                    ${allRoms.length === 0
                        ? 'Bấm nút + ở góc trên bên phải hoặc kéo thả file ROM (.gba) vào trang web để thêm game vào kệ.'
                        : 'Thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc.'}
                </p>
            </div>
        `;
        return;
    }

    gridEl.innerHTML = filtered.map(r => {
        const sizeMb = (r.sizeBytes / (1024 * 1024)).toFixed(1);
        const grad = getCoverGradientFromCode(r.gameCode);
        const isRunning = AppState.romLoaded && AppState.currentRom.id === r.id;
        const hasCover = !!r.coverUrl;

        return `
            <div class="game-card group rounded-3xl border ${isRunning ? 'border-white/30' : 'border-white/10'} overflow-hidden flex flex-col justify-between select-none"
                 oncontextmenu="event.preventDefault(); openGameActionSheet('${r.id}');">
                <div onpointerdown="handleCardPointerDown(event, '${r.id}')"
                     onpointerup="handleCardPointerCancel()"
                     onpointerleave="handleCardPointerCancel()"
                     onpointercancel="handleCardPointerCancel()"
                     onclick="handleCardClick(event, '${r.id}')"
                     class="relative aspect-[4/3] bg-gradient-to-br ${grad} p-3.5 flex flex-col justify-between cursor-pointer overflow-hidden">

                    ${hasCover ? `
                    <img src="${r.coverUrl}"
                         alt="${escapeHtml(r.title)}"
                         loading="lazy"
                         decoding="async"
                         onerror="this.style.display='none'"
                         class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-300">
                    <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/35"></div>
                    ` : `
                    <div class="absolute -right-4 -bottom-4 text-6xl font-black text-white/10 italic select-none pointer-events-none">GBA</div>
                    <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
                    `}

                    <div class="flex items-center justify-between z-10 gap-1.5">
                        <span class="text-[9px] sm:text-[10px] font-black tracking-wider uppercase px-1.5 sm:px-2 py-0.5 rounded-md bg-black/[0.65] backdrop-blur-md text-white border border-white/[0.15] shrink-0">
                            ${r.gameCode}
                        </span>
                        <div class="flex items-center gap-1 min-w-0">
                            ${isRunning ? `
                            <span class="whitespace-nowrap text-[8px] sm:text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-white text-black shadow shrink-0">
                                CHẠY
                            </span>` : ''}
                            <button onclick="event.stopPropagation(); openCoverArtModal('${r.id}')"
                                    class="w-6 h-6 rounded-lg bg-black/[0.55] hover:bg-white/[0.15] text-white/80 hover:text-white flex items-center justify-center border border-white/[0.15] transition shrink-0"
                                    title="Đổi ảnh đại diện băng game">
                                <i class="fa-solid fa-image text-[10px]"></i>
                            </button>
                        </div>
                    </div>

                    <div class="z-10 mt-auto flex items-end justify-between gap-2">
                        <div class="min-w-0">
                            <h4 class="text-sm font-black text-white tracking-tight leading-tight line-clamp-2 drop-shadow">${escapeHtml(r.title)}</h4>
                            <p class="text-[10px] text-white/90 truncate mt-0.5">${sizeMb} MB</p>
                        </div>
                        <span class="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-lg shrink-0 group-hover:scale-110 transition">
                            <i class="fa-solid fa-play text-xs ml-0.5"></i>
                        </span>
                    </div>
                </div>

                <div class="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-black/50">
                    <p class="text-[11px] font-semibold text-white/90 truncate" title="${escapeHtml(r.fileName)}">${escapeHtml(r.fileName)}</p>
                    <div class="flex items-center gap-1 shrink-0">
                        <button onclick="openCoverArtModal('${r.id}')" class="w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.15] text-white/60 hover:text-white flex items-center justify-center transition" title="Đổi ảnh bìa">
                            <i class="fa-solid fa-camera text-[10px]"></i>
                        </button>
                        <button onclick="removeCachedRom('${r.id}')" class="w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-red-500/25 text-white/60 hover:text-red-300 flex items-center justify-center transition" title="Xóa băng cùng save & cheat">
                            <i class="fa-solid fa-trash-can text-[10px]"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}
