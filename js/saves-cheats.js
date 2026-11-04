/**************************************************************************
 * 9. SAVE STATES, ẢNH CHỤP TRONG GAME THỰC TẾ & AUTO BACKUP MỖI 1 PHÚT
 **************************************************************************/
const SAVE_SLOTS = [
    { id: 'quick', label: 'Khe Lưu Nhanh', badge: 'NHANH' },
    { id: 'auto', label: 'Auto Backup (Mỗi 1 phút)', badge: 'TỰ ĐỘNG 1P' },
    { id: 'slot1', label: 'Khe Lưu #1 (Slot 1)', badge: 'SLOT 1' },
    { id: 'slot2', label: 'Khe Lưu #2 (Slot 2)', badge: 'SLOT 2' },
    { id: 'slot3', label: 'Khe Lưu #3 (Slot 3)', badge: 'SLOT 3' },
    { id: 'slot4', label: 'Khe Lưu #4 (Slot 4)', badge: 'SLOT 4' }
];

async function openSaveStateModal() {
    const modal = document.getElementById('savestate-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    const sub = document.getElementById('savestate-subtitle');
    if (sub) {
        sub.textContent = AppState.romLoaded
            ? `Băng đang nạp: ${AppState.currentRom.title} (${AppState.currentRom.gameCode}) • Tự lưu vào Auto Backup mỗi 1 phút`
            : 'Hãy nạp một băng ROM (.gba) để lưu trạng thái trực tiếp';
    }
    await renderSaveStateSlots();
}

function closeSaveStateModal() {
    const modal = document.getElementById('savestate-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (typeof autoResumeAfterModal === 'function') {
        autoResumeAfterModal();
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => resolve('');
        fr.readAsDataURL(blob);
    });
}

function downloadBinaryFile(buffer, fileName) {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function captureCanvasFrameSync() {
    try {
        const canvas = document.querySelector('#wasm-mount-container canvas');
        if (canvas && canvas.width > 0 && canvas.height > 0) {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
            if (dataUrl && dataUrl.length > 200) {
                AppState.lastCapturedFrameDataUrl = dataUrl;
                return dataUrl;
            }
        }
    } catch (e) {}
    return AppState.lastCapturedFrameDataUrl || '';
}

async function captureCurrentScreenThumbnail() {
    const directDataUrl = captureCanvasFrameSync();
    if (directDataUrl) return directDataUrl;
    try {
        if (AppState.nostalgistInstance && typeof AppState.nostalgistInstance.screenshot === 'function') {
            const blob = await AppState.nostalgistInstance.screenshot();
            if (blob) {
                const url = await blobToDataUrl(blob);
                if (url) {
                    AppState.lastCapturedFrameDataUrl = url;
                    return url;
                }
            }
        }
    } catch (e) {}
    return AppState.lastCapturedFrameDataUrl || '';
}

async function saveStateToSlot(slotId, isSilentAuto = false) {
    if (!AppState.romLoaded || !AppState.currentRom.id) {
        if (!isSilentAuto) showToast('Vui lòng nạp một băng ROM (.gba) trước khi lưu trạng thái!', 'error');
        return false;
    }

    let wasmStateBlob = null;
    let thumbnail = await captureCurrentScreenThumbnail();

    if (AppState.nostalgistInstance && AppState.activeCoreMode === 'mGBA WASM') {
        try {
            const res = await AppState.nostalgistInstance.saveState();
            if (res && res.state) {
                wasmStateBlob = await res.state.arrayBuffer();
            }
            if (!thumbnail && res && res.thumbnail) {
                thumbnail = await blobToDataUrl(res.thumbnail);
            }
        } catch (e) {
            console.warn('Không lưu được trạng thái từ emulator:', e);
        }
    }

    if (!wasmStateBlob || wasmStateBlob.byteLength === 0) {
        if (!isSilentAuto) showToast('Lưu Save State thất bại: Trình giả lập chưa sẵn sàng!', 'error');
        return false;
    }

    if (thumbnail && typeof shrinkImageDataUrl === 'function') {
        thumbnail = await shrinkImageDataUrl(thumbnail, 320, 0.82);
    }

    const stateRecord = {
        slotKey: `${AppState.currentRom.id}__${slotId}`,
        romId: AppState.currentRom.id,
        romTitle: AppState.currentRom.title,
        slotId,
        timestamp: Date.now(),
        thumbnail,
        wasmStateBuffer: wasmStateBlob
    };

    await putSaveStateToDB(stateRecord);
    if (!isSilentAuto) {
        if (typeof playGbaBeep === 'function') playGbaBeep(880, 0.07, 'sine');
        await renderSaveStateSlots();
        showToast(`Đã lưu trạng thái kèm ảnh trong game vào [${slotId.toUpperCase()}]`, 'success');
    } else {
        const modal = document.getElementById('savestate-modal');
        if (modal && !modal.classList.contains('hidden')) {
            await renderSaveStateSlots();
        }
    }
    return true;
}

async function loadStateFromSlot(slotId) {
    if (!AppState.romLoaded || !AppState.currentRom.id) {
        showToast('Nạp Save State thất bại: Hãy nạp ROM tương ứng trước!', 'error');
        return;
    }

    const states = await getSaveStatesForRom(AppState.currentRom.id);
    const found = states.find(s => s.slotId === slotId);
    if (!found) {
        showToast(`Nạp Save State thất bại: Khe [${slotId.toUpperCase()}] đang trống!`, 'error');
        return;
    }

    if (!found.wasmStateBuffer || found.wasmStateBuffer.byteLength === 0 || !AppState.nostalgistInstance || AppState.activeCoreMode !== 'mGBA WASM') {
        showToast(`Nạp Save State thất bại: Dữ liệu tại khe [${slotId.toUpperCase()}] không hợp lệ hoặc trình giả lập chưa sẵn sàng!`, 'error');
        return;
    }

    try {
        const blob = new Blob([found.wasmStateBuffer], { type: 'application/octet-stream' });
        await AppState.nostalgistInstance.loadState(blob);
        if (typeof playGbaBeep === 'function') playGbaBeep(987.77, 0.08, 'sine');
        closeSaveStateModal();
        if (typeof resumeGame === 'function') resumeGame();
        setTimeout(() => {
            if (typeof applyActiveCheatsToCore === 'function') applyActiveCheatsToCore();
        }, 150);
        showToast(`Đã khôi phục tiến trình từ [${slotId.toUpperCase()}]`, 'success');
    } catch (e) {
        console.error('Lỗi khi nạp Save State:', e);
        showToast(`Nạp Save State thất bại! File trạng thái ở khe [${slotId.toUpperCase()}] bị lỗi hoặc không tương thích.`, 'error');
    }
}

/**************************************************************************
 * 9B. SAVE TRONG GAME (.sav) & VÒNG LẶP AUTO BACKUP MỖI 1 PHÚT
 **************************************************************************/
const SAV_MIN_BYTES = 512;
const SAV_MAX_BYTES = 131072 + 64;
let autoSaveTimer = null;
const SRAM_SYNC_INTERVAL_MS = 15000;
const AUTO_BACKUP_INTERVAL_MS = 60000;
let autoBackupElapsedMs = 0;
let sramBusy = false;
let lastSramSig = '';

function sramSignature(u8) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; }
    return u8.length + ':' + h;
}

function isBlankSave(u8) {
    const first = u8[0];
    if (first !== 0x00 && first !== 0xFF) return false;
    for (let i = 1; i < u8.length; i++) if (u8[i] !== first) return false;
    return true;
}

async function putSramToDB(rec) {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = dbInstance.transaction('sram', 'readwrite');
        tx.objectStore('sram').put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function getSramFromDB(romId) {
    if (!dbInstance) await initIndexedDB();
    return new Promise((resolve) => {
        const tx = dbInstance.transaction('sram', 'readonly');
        const req = tx.objectStore('sram').get(romId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

function findSrmFiles(FS, dir, out, depth = 0) {
    if (depth > 6) return;
    let names;
    try { names = FS.readdir(dir); } catch (e) { return; }
    for (const n of names) {
        if (n === '.' || n === '..') continue;
        const p = dir.replace(/\/$/, '') + '/' + n;
        let st;
        try { st = FS.stat(p); } catch (e) { continue; }
        if (FS.isDir(st.mode)) findSrmFiles(FS, p, out, depth + 1);
        else if (/\.(srm|sav)$/i.test(n)) out.push({ path: p, mtime: +st.mtime || 0 });
    }
}

async function readBatterySaveFromCore(thorough) {
    const nl = AppState.nostalgistInstance;
    if (!nl || AppState.activeCoreMode !== 'mGBA WASM') return null;

    if (thorough && typeof nl.saveSRAM === 'function') {
        try {
            const r = await nl.saveSRAM();
            const blob = r && r.sram ? r.sram : r;
            if (blob && typeof blob.arrayBuffer === 'function') {
                const b = await blob.arrayBuffer();
                if (b.byteLength) return b;
            }
        } catch (e) {}
    }

    if (thorough) {
        const wasPaused = AppState.isPaused;
        try {
            if (wasPaused) { try { nl.resume(); } catch (e) {} }
            if (typeof nl.sendCommand === 'function') await Promise.resolve(nl.sendCommand('SAVE_FILES'));
            await new Promise(r => setTimeout(r, wasPaused ? 400 : 250));
        } catch (e) {
        } finally {
            if (wasPaused) { try { nl.pause(); } catch (e) {} }
        }
    }
    try {
        const FS = typeof nl.getEmscriptenFS === 'function' ? nl.getEmscriptenFS() : null;
        if (!FS) return null;
        const found = [];
        findSrmFiles(FS, '/home/web_user/retroarch/userdata', found);
        if (!found.length) findSrmFiles(FS, '/home/web_user', found);
        if (!found.length) return null;
        found.sort((x, y) => y.mtime - x.mtime);
        const u8 = FS.readFile(found[0].path);
        return u8 && u8.length ? u8.slice().buffer : null;
    } catch (e) {
        return null;
    }
}

async function persistBatterySave(opts = {}) {
    const romId = AppState.sramRomId;
    if (!romId || !AppState.nostalgistInstance || sramBusy) return false;
    sramBusy = true;
    try {
        const buf = await readBatterySaveFromCore(!!opts.thorough);
        if (!buf) return false;
        const u8 = new Uint8Array(buf);
        if (u8.length < SAV_MIN_BYTES || u8.length > SAV_MAX_BYTES) return false;
        const sig = sramSignature(u8);
        if (sig === lastSramSig) return true;
        if (!lastSramSig && isBlankSave(u8)) return true;
        await putSramToDB({ romId, data: buf, size: u8.length, timestamp: Date.now() });
        lastSramSig = sig;
        return true;
    } catch (e) {
        return false;
    } finally {
        sramBusy = false;
    }
}

function startAutoSaveLoop() {
    stopAutoSaveLoop();
    autoBackupElapsedMs = 0;
    autoSaveTimer = setInterval(async () => {
        if (!AppState.isPaused && AppState.romLoaded && AppState.currentView === 'player') {
            await persistBatterySave();
            autoBackupElapsedMs += SRAM_SYNC_INTERVAL_MS;
            if (autoBackupElapsedMs >= AUTO_BACKUP_INTERVAL_MS) {
                autoBackupElapsedMs = 0;
                await saveStateToSlot('auto', true);
            }
        }
    }, SRAM_SYNC_INTERVAL_MS);
}

function stopAutoSaveLoop() {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
        autoSaveTimer = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden && AppState.romLoaded) {
        persistBatterySave();
        saveStateToSlot('auto', true);
    }
});
window.addEventListener('pagehide', () => {
    if (AppState.romLoaded) persistBatterySave();
});

async function exportSavForRom(romId) {
    if (!romId) {
        showToast('Hãy nạp một băng ROM trước khi xuất .sav.', 'error');
        return;
    }
    const rom = await getRomMetaById(romId);
    if (AppState.romLoaded && AppState.sramRomId === romId) {
        await persistBatterySave({ thorough: true });
    }
    const rec = await getSramFromDB(romId);
    if (!rec || !rec.data || !rec.data.byteLength) {
        showToast('Băng này chưa có dữ liệu lưu trong game (.sav). Hãy lưu trong menu của chính trò chơi trước.', 'error');
        return;
    }
    const baseName = ((rom && rom.fileName) || AppState.currentRom.fileName || 'game').replace(/\.[^.]+$/, '');
    const fileName = baseName + '.sav';
    downloadBinaryFile(rec.data, fileName);
    showToast(`Đã xuất ${fileName} (${Math.round(rec.data.byteLength / 1024 * 10) / 10} KB)`, 'success');
}

async function importSavForRom(file, target) {
    try {
        const buf = await file.arrayBuffer();
        const u8 = new Uint8Array(buf);

        if (u8.length < SAV_MIN_BYTES || u8.length > SAV_MAX_BYTES) {
            showToast(`File .sav không hợp lệ (${u8.length} byte). Save GBA chuẩn dài 512 B, 8 KB, 32 KB, 64 KB hoặc 128 KB.`, 'error');
            return 0;
        }

        const running = AppState.romLoaded && AppState.sramRomId === target.id && AppState.currentRom.buffer;
        if (running) stopAutoSaveLoop();

        await putSramToDB({ romId: target.id, data: buf, size: u8.length, timestamp: Date.now() });
        lastSramSig = sramSignature(u8);

        if (running) {
            const wasPaused = AppState.isPaused;
            const ok = await launchNostalgistWasmCore(AppState.currentRom.buffer, AppState.currentRom.fileName);
            if (!ok) return 0;
            if (wasPaused && AppState.nostalgistInstance) { try { AppState.nostalgistInstance.pause(); } catch (e) {} }
        }
        showToast(`Đã nhập ${file.name} vào "${target.title}"${running ? ' — game đã khởi động lại để nạp save' : ''}`, 'success');
        return 1;
    } catch (err) {
        showToast('Không đọc được file .sav', 'error');
        return 0;
    }
}

async function handleImportStateFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const cur = AppState.currentRom;
    const n = await importSavForRom(file, {
        id: cur.id || 'CUSTOM_ROM', title: cur.title, gameCode: cur.gameCode
    });
    if (n > 0) await renderSaveStateSlots();
}

async function handleSheetImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !sheetRomId) return;
    const rom = await getRomMetaById(sheetRomId);
    if (!rom) return;
    const n = await importSavForRom(file, { id: rom.id, title: rom.title, gameCode: rom.gameCode });
    if (n > 0) {
        const states = await getSaveStatesForRom(rom.id);
        const extra = document.getElementById('sheet-extra');
        if (extra) {
            extra.textContent = `Chơi lần cuối: ${formatRelativeTime(rom.lastPlayed)} • ${states.length} save state`;
        }
    }
}

async function renderSaveStateSlots() {
    const grid = document.getElementById('savestate-grid');
    if (!grid) return;

    const savedList = AppState.currentRom.id
        ? await getSaveStatesForRom(AppState.currentRom.id)
        : [];

    grid.innerHTML = SAVE_SLOTS.map(slot => {
        const record = savedList.find(s => s.slotId === slot.id);
        const dateText = record
            ? new Date(record.timestamp).toLocaleString('vi-VN')
            : (slot.id === 'auto' ? 'Tự động lưu mỗi 1 phút khi chơi' : 'Chưa có dữ liệu lưu');

        return `
            <div class="p-3.5 rounded-2xl bg-black/[0.35] border ${record ? 'border-white/25' : 'border-white/10'} flex flex-col justify-between gap-3">
                <div class="flex items-center gap-3">
                    <div class="w-24 h-16 rounded-xl bg-black/[0.5] border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                        ${record && record.thumbnail
                            ? `<img src="${record.thumbnail}" alt="Save Thumbnail" class="w-full h-full object-cover">`
                            : `<i class="fa-solid fa-camera text-white/40 text-lg"></i>`}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center justify-between gap-1">
                            <span class="text-xs font-extrabold text-white truncate">${slot.label}</span>
                            <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/[0.85]">${slot.badge}</span>
                        </div>
                        <p class="text-[11px] text-white/60 mt-1 truncate">${dateText}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="saveStateToSlot('${slot.id}')" class="flex-1 py-1.5 rounded-xl bg-white/25 hover:bg-white/35 text-xs font-bold text-white shadow">
                        <i class="fa-solid fa-floppy-disk mr-1"></i> Lưu (Save)
                    </button>
                    <button onclick="loadStateFromSlot('${slot.id}')" ${record ? '' : 'disabled'} class="flex-1 py-1.5 rounded-xl ${record ? 'bg-white/25 hover:bg-white/35 text-white' : 'bg-white/[0.06] text-white/[0.45] cursor-not-allowed'} text-xs font-bold">
                        <i class="fa-solid fa-rotate-left mr-1"></i> Nạp (Load)
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**************************************************************************
 * 10. QUẢN LÝ MÃ CHEAT HOẠT ĐỘNG THỰC TẾ TRÊN NHÂN mGBA WASM
 **************************************************************************/
function openCheatModal() {
    const modal = document.getElementById('cheat-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    renderCheatList();
}

function closeCheatModal() {
    const modal = document.getElementById('cheat-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (typeof autoResumeAfterModal === 'function') {
        autoResumeAfterModal();
    }
}

function fillSampleCheatFormat() {
    const n = document.getElementById('cheat-name-input');
    const c = document.getElementById('cheat-code-input');
    if (n) n.value = 'Bất tử Năng Lượng / Rare Candy';
    if (c) c.value = '82025840 0044\n8202404C 03E7';
}

function validateGbaCheatCode(rawText) {
    const lines = rawText.trim().split(/\r?\n/).map(l => l.trim().toUpperCase()).filter(Boolean);
    if (lines.length === 0) return null;
    const hexPattern = /^[0-9A-F]{8}[\s:]+[0-9A-F]{2,8}$/;
    for (const line of lines) {
        if (!hexPattern.test(line)) return null;
    }
    return lines.join('\n');
}

function getEmscriptenModuleSafe() {
    const nl = AppState.nostalgistInstance;
    if (!nl) return null;
    try {
        if (typeof nl.getEmscriptenModule === 'function') return nl.getEmscriptenModule();
        if (typeof nl.getEmscripten === 'function') {
            const em = nl.getEmscripten();
            return em?.Module || em;
        }
    } catch (e) {}
    return null;
}

// LƯU Ý: TOÀN BỘ CHỨC NĂNG "GHI RAM THÔ (RAW RAM)" ĐÃ BỊ GỠ BỎ THEO YÊU CẦU ĐỂ TỐI ƯU HÓA HIỆU NĂNG VÀ CHỐNG TREO GAME
// TẤT CẢ CHEAT BÂY GIỜ ĐƯỢC GỬI THẲNG VÀO CORE MGBA ĐỂ XỬ LÝ (NATIVE RETROARCH CHEAT API)

function applyActiveCheatsToCore() {
    const mod = getEmscriptenModuleSafe();
    const enabledCheats = AppState.cheats.filter(c => c.enabled);
    let coreApplied = false;

    if (mod && typeof mod._retro_cheat_reset === 'function' && typeof mod._retro_cheat_set === 'function') {
        try {
            mod._retro_cheat_reset();
            let cheatIndex = 0;
            let sentCount = 0;
            for (const c of enabledCheats) {
                const normalized = c.code
                    .split(/\r?\n/)
                    .map(l => l.trim().replace(':', ' '))
                    .filter(Boolean)
                    .join('+');

                let ptr = 0;
                if (typeof mod.stringToNewUTF8 === 'function') {
                    ptr = mod.stringToNewUTF8(normalized);
                    mod._retro_cheat_set(cheatIndex++, 1, ptr); sentCount++;
                    if (typeof mod._free === 'function') mod._free(ptr);
                } else if (typeof mod.allocateUTF8 === 'function') {
                    ptr = mod.allocateUTF8(normalized);
                    mod._retro_cheat_set(cheatIndex++, 1, ptr); sentCount++;
                    if (typeof mod._free === 'function') mod._free(ptr);
                } else if (typeof mod.stackSave === 'function' && typeof mod.stackAlloc === 'function' && typeof mod.stringToUTF8 === 'function') {
                    const sp = mod.stackSave();
                    const len = normalized.length * 4 + 1;
                    ptr = mod.stackAlloc(len);
                    mod.stringToUTF8(normalized, ptr, len);
                    mod._retro_cheat_set(cheatIndex++, 1, ptr); sentCount++;
                    mod.stackRestore(sp);
                }
            }
            coreApplied = sentCount > 0;
        } catch (e) {
            coreApplied = false;
        }
    }

    try {
        const nl = AppState.nostalgistInstance;
        const FS = nl && typeof nl.getEmscriptenFS === 'function' ? nl.getEmscriptenFS() : null;
        if (FS) {
            const chtLines = [`cheats = "${enabledCheats.length}"`];
            enabledCheats.forEach((c, idx) => {
                const codeJoined = c.code.split(/\r?\n/).map(l => l.trim().replace(':', ' ')).filter(Boolean).join('+');
                chtLines.push(`cheat${idx}_desc = "${c.name.replace(/"/g, '')}"`);
                chtLines.push(`cheat${idx}_code = "${codeJoined}"`);
                chtLines.push(`cheat${idx}_enable = "true"`);
            });
            try { FS.mkdir('/home/web_user/retroarch/userdata/cheats'); } catch (_) {}
            FS.writeFile('/home/web_user/retroarch/userdata/cheats/active.cht', chtLines.join('\n'));
        }
    } catch (e) {}

    AppState.cheatCoreApplied = coreApplied;

    for (const c of enabledCheats) {
        if (coreApplied) c.runtimeStatus = 'core';
        else c.runtimeStatus = 'unsupported'; 
    }

    updateActiveCheatsPill();
}

async function addNewCheat() {
    const nameInput = document.getElementById('cheat-name-input');
    const codeInput = document.getElementById('cheat-code-input');
    const typeSelect = document.getElementById('cheat-type-select');

    const name = (nameInput && nameInput.value.trim()) || 'Mã Cheat tùy chỉnh';
    const validatedCode = codeInput ? validateGbaCheatCode(codeInput.value) : null;

    if (!validatedCode) {
        showToast('Định dạng mã chưa đúng! Vui lòng nhập mã HEX dạng: XXXXXXXX YYYYYYYY hoặc XXXXXXXX YYYY', 'error');
        return;
    }

    const newCheat = {
        id: 'cheat_' + Date.now(),
        name,
        type: typeSelect ? typeSelect.value : 'GameShark',
        code: validatedCode,
        enabled: true
    };

    AppState.cheats.push(newCheat);
    if (AppState.currentRom.id) {
        await saveCheatsForRom(AppState.currentRom.id, AppState.cheats);
    }

    if (nameInput) nameInput.value = '';
    if (codeInput) codeInput.value = '';
    applyActiveCheatsToCore();
    renderCheatList();
    showToast(`Đã thêm và kích hoạt mã Cheat: ${name}`, 'success');
}

async function toggleCheatItem(cheatId) {
    const target = AppState.cheats.find(c => c.id === cheatId);
    if (!target) return;
    target.enabled = !target.enabled;
    if (AppState.currentRom.id) {
        await saveCheatsForRom(AppState.currentRom.id, AppState.cheats);
    }
    applyActiveCheatsToCore();
    renderCheatList();
    showToast(target.enabled ? `Đã bật mã: ${target.name}` : `Đã tắt mã: ${target.name}`, 'info');
}

async function deleteCheatItem(cheatId) {
    AppState.cheats = AppState.cheats.filter(c => c.id !== cheatId);
    if (AppState.currentRom.id) {
        await saveCheatsForRom(AppState.currentRom.id, AppState.cheats);
    }
    applyActiveCheatsToCore();
    renderCheatList();
    showToast('Đã xóa mã Cheat', 'info');
}

function updateActiveCheatsPill() {
    const count = AppState.cheats.filter(c => c.enabled).length;
    const hudBadge = document.getElementById('hud-cheat-badge');
    const menuText = document.getElementById('menu-cheat-text');
    if (hudBadge) {
        hudBadge.textContent = `${count} CHEAT BẬT`;
        hudBadge.classList.toggle('hidden', count === 0);
    }
    if (menuText) {
        menuText.textContent = count > 0 ? `Cheat (${count})` : 'Cheat Codes';
    }
}

function renderCheatList() {
    const container = document.getElementById('cheat-list-container');
    if (!container) return;
    if (AppState.cheats.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-xs text-white/[0.45]">
                Chưa có mã Cheat nào cho băng game này. Hãy nhập mã ở khung bên trên!
            </div>
        `;
        return;
    }

    container.innerHTML = AppState.cheats.map(c => {
        let statusBadge = '';
        if (!c.enabled) {
            statusBadge = '<span class="text-[10px] text-white/40">Đang tắt</span>';
        } else if (c.runtimeStatus === 'core') {
            statusBadge = '<span class="text-[10px] text-white/80 font-semibold flex items-center gap-1"><i class="fa-solid fa-circle-check text-[9px]"></i> Đã gửi vào nhân</span>';
        } else if (c.runtimeStatus === 'unsupported') {
            statusBadge = '<span class="text-[10px] text-red-400 font-semibold flex items-center gap-1"><i class="fa-solid fa-circle-xmark text-[9px]"></i> Core từ chối</span>';
        } else {
            statusBadge = '<span class="text-[10px] text-white/70">Sẵn sàng</span>';
        }

        return `
        <div class="p-3 rounded-2xl bg-black/[0.35] border ${c.enabled ? 'border-white/35' : 'border-white/10'} flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-white truncate">${escapeHtml(c.name)}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-white/[0.85] font-mono">${escapeHtml(c.type)}</span>
                </div>
                <div class="mt-0.5">${statusBadge}</div>
                <pre class="text-[11px] font-mono text-white/60 mt-1 whitespace-pre-wrap">${escapeHtml(c.code)}</pre>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button onclick="toggleCheatItem('${c.id}')" class="px-3 py-1 rounded-xl text-xs font-extrabold transition ${c.enabled ? 'bg-white text-black shadow' : 'bg-white/[0.06] border border-white/15 text-white/60'}">
                    ${c.enabled ? 'ĐANG BẬT' : 'TẮT'}
                </button>
                <button onclick="deleteCheatItem('${c.id}')" class="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-red-500/25 text-white/[0.85] hover:text-red-300 flex items-center justify-center transition" title="Xóa mã Cheat">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        </div>
        `;
    }).join('');
}
