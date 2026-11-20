import { getMeshKey, getPsetCacheKey } from '../core/helpers.js';
import { openPsetEditDialog } from '../ifc/pset-edit.js';
import { updateAllMeshesVisibility } from '../ifc/groups.js';
import { updateSelectionDimmingEffect } from '../selection/selection.js';
import { contextMenu, groupSearchQuery, leftActiveTab, manuallyHiddenExpressIDs, pendingDeletedExpressIDs, psetCache, rt, selectedMeshes } from '../state/state.js';
import { showToast } from './panels.js';
import { t } from '../i18n/index.js';

// --- 8. CONTEXT MENU ---
// psetName / editable: chỉ có khi chuột phải vào một thuộc tính trong Property Sets (để hiện mục "Sửa giá trị")
export const openContextMenu = (event, key, val, psetName = '', editable = false) => {
    contextMenu.visible = true;
    contextMenu.x = Math.min(event.clientX, window.innerWidth - 230);
    contextMenu.y = Math.min(event.clientY, window.innerHeight - 190);
    contextMenu.attrKey = key;
    contextMenu.attrValue = String(val);
    contextMenu.psetName = psetName;
    contextMenu.editable = !!editable;
};

export const closeContextMenu = () => {
    contextMenu.visible = false;
};

// Bấm chuột ra ngoài menu (kể cả chuột phải) thì đóng menu
export const handleContextMenuOutsidePointer = (event) => {
    if (!contextMenu.visible) return;
    if (event.target.closest && event.target.closest('[data-context-menu]')) return;
    closeContextMenu();
};

export const handleContextMenuEscape = (event) => {
    if (contextMenu.visible && event.key === 'Escape') closeContextMenu();
};

export const contextMenuAction = (action) => {
    const key = contextMenu.attrKey.toLowerCase();
    const val = contextMenu.attrValue.toLowerCase();
    closeContextMenu();

    if (action === 'editValue') {
        openPsetEditDialog(contextMenu.psetName, contextMenu.attrKey, contextMenu.attrValue);
        return;
    }

    const isMatch = (mesh) => {
        const ud = mesh.userData;
        if (ud.name && ud.name.toLowerCase().includes(val)) return true;
        if (ud.tag && ud.tag.toLowerCase().includes(val)) return true;
        if (ud.objectType && ud.objectType.toLowerCase().includes(val)) return true;
        if (ud.type && ud.type.toLowerCase().includes(val)) return true;
        if (key.includes('dia') && ud.diameter && String(ud.diameter) === val) return true;

        const psets = psetCache.get(getPsetCacheKey(ud.sourceId, ud.expressID));
        if (psets) {
            for (const ps of psets) {
                for (const p of ps.properties) {
                    if (p.name.toLowerCase() === key && String(p.value).toLowerCase() === val) {
                        return true;
                    }
                }
            }
        }
        return false;
    };

    if (action === 'selectSimilar') {
        selectedMeshes.value = rt.modelGroup.children.filter(mesh => mesh.isMesh && isMatch(mesh));
        updateSelectionDimmingEffect();
        // showToast('Select Similar', `Đã chọn ${selectedMeshes.value.length} đối tượng có cùng ${contextMenu.attrKey} = "${contextMenu.attrValue}"`, 'success');
    } else if (action === 'showSimilar') {
        // Ẩn/hiện qua manuallyHiddenExpressIDs (nguồn sự thật duy nhất) để bộ đếm "Ẩn" ở thanh status,
        // trạng thái mờ trong danh sách nhóm và nút mắt của nhóm đều đồng bộ
        let count = 0;
        rt.modelGroup.children.forEach(mesh => {
            if (!mesh.isMesh) return;
            const key = getMeshKey(mesh);
            if (isMatch(mesh)) {
                manuallyHiddenExpressIDs.delete(key);
                count++;
            } else if (!pendingDeletedExpressIDs.has(key)) {
                manuallyHiddenExpressIDs.add(key);
            }
        });
        updateAllMeshesVisibility();
        // showToast('Show Similar', `Đang chỉ hiển thị ${count} đối tượng tương tự`, 'success');
    } else if (action === 'filterWithAttribute') {
        leftActiveTab.value = 'groups';
        groupSearchQuery.value = contextMenu.attrValue;
        showToast(t('Lọc theo giá trị'), t('Đã áp bộ lọc: "{0}"', [contextMenu.attrValue]), 'success');
    }
};
