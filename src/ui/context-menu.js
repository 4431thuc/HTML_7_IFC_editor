import { getPsetCacheKey } from '../core/helpers.js';
import { updateEdgesVisibility } from '../ifc/groups.js';
import { updateSelectionDimmingEffect } from '../selection/selection.js';
import { contextMenu, groupSearchQuery, leftActiveTab, psetCache, rt, selectedMeshes } from '../state/state.js';
import { showToast } from './panels.js';

// --- 8. CONTEXT MENU ---
export const openContextMenu = (event, key, val) => {
    contextMenu.visible = true;
    contextMenu.x = Math.min(event.clientX, window.innerWidth - 230);
    contextMenu.y = Math.min(event.clientY, window.innerHeight - 150);
    contextMenu.attrKey = key;
    contextMenu.attrValue = String(val);
};

export const closeContextMenu = () => {
    contextMenu.visible = false;
};

export const contextMenuAction = (action) => {
    const key = contextMenu.attrKey.toLowerCase();
    const val = contextMenu.attrValue.toLowerCase();
    closeContextMenu();

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
        selectedMeshes.value = [];
        rt.modelGroup.children.forEach(mesh => {
            if (mesh.isMesh && isMatch(mesh)) {
                selectedMeshes.value.push(mesh);
            }
        });
        updateSelectionDimmingEffect();
        // showToast('Select Similar', `Đã chọn ${selectedMeshes.value.length} đối tượng có cùng ${contextMenu.attrKey} = "${contextMenu.attrValue}"`, 'success');
    } else if (action === 'showSimilar') {
        let count = 0;
        rt.modelGroup.children.forEach(mesh => {
            if (mesh.isMesh) {
                const match = isMatch(mesh);
                mesh.visible = match;
                if (match) count++;
            }
        });
        updateEdgesVisibility();
        // showToast('Show Similar', `Đang chỉ hiển thị ${count} đối tượng tương tự`, 'success');
    } else if (action === 'filterWithAttribute') {
        leftActiveTab.value = 'groups';
        groupSearchQuery.value = contextMenu.attrValue;
        showToast('Filter with attribute', `Đã áp bộ lọc: "${contextMenu.attrValue}"`, 'success');
    }
};
