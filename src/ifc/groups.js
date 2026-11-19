import * as WebIFC from 'web-ifc';
import { computed } from 'vue';
import { getMeshKey, getPsetCacheKey, requestRender } from '../core/helpers.js';
import { ensureEdgesForVisibleMeshes } from '../scene/display.js';
import { getRebarColorByDiameter } from '../scene/sample-model.js';
import { clearSelection, updateSelectionOutlines } from '../selection/selection.js';
import { ENTITY_DEFAULT_COLORS, PALETTE } from '../state/constants.js';
import { allGroups, clashModeActive, deletedItems, edgesGroup, editHistoryCount, exportListVersion, filterFaultyBars, groupCriterion, groupSearchQuery, hasUnsavedChanges, isRebarOnly, manuallyHiddenExpressIDs, pendingDeletedExpressIDs, psetCache, rt, selectedMeshes, showEdges } from '../state/state.js';
import { showToast } from '../ui/panels.js';

export const indexAllPropertySets = (modelID, sourceId) => {
    try {
        const relDefinesLines = rt.ifcAPI.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
        for (let i = 0; i < relDefinesLines.size(); i++) {
            const relID = relDefinesLines.get(i);
            try {
                const rel = rt.ifcAPI.GetLine(modelID, relID, false);
                if (!rel || !rel.RelatedObjects || !rel.RelatingPropertyDefinition) continue;

                const psetID = rel.RelatingPropertyDefinition.value;
                const psetLine = rt.ifcAPI.GetLine(modelID, psetID, false);
                if (!psetLine) continue;

                const psetName = psetLine.Name?.value || 'PropertySet';
                const properties = [];

                if (psetLine.HasProperties) {
                    for (const propRef of psetLine.HasProperties) {
                        try {
                            const prop = rt.ifcAPI.GetLine(modelID, propRef.value, false);
                            if (prop && prop.Name) {
                                let val = prop.NominalValue?.value;
                                if (val === undefined || val === null) val = prop.Description?.value || '—';
                                properties.push({
                                    name: prop.Name.value,
                                    value: typeof val === 'object' ? JSON.stringify(val) : String(val)
                                });
                            }
                        } catch (e) {}
                    }
                }

                for (const objRef of rel.RelatedObjects) {
                    const targetID = objRef.value;
                    const cacheKey = getPsetCacheKey(sourceId, targetID);
                    if (!psetCache.has(cacheKey)) psetCache.set(cacheKey, []);
                    psetCache.get(cacheKey).push({ name: psetName, properties });
                }
            } catch (e) {}
        }
    } catch (err) {
        console.warn('Lỗi index Psets:', err);
    }
};

// --- 5. TỔ CHỨC CÁC BỘ NHÓM (GROUPS) ---
export const buildAllGroupingCollections = () => {
    const groupBuilders = {
        pos: new Map(),
        name: new Map(),
        objectType: new Map(),
        entity: new Map()
    };

    let colorIdx = 0;
    const getColor = (key) => {
        if (ENTITY_DEFAULT_COLORS[key]) return ENTITY_DEFAULT_COLORS[key];
        const color = PALETTE[colorIdx % PALETTE.length];
        colorIdx++;
        return color;
    };

    rt.modelGroup.children.forEach(mesh => {
        if (!mesh.isMesh) return;
        const ud = mesh.userData;
        const isRebar = !!ud.isRebar;

        // 1. Pos Thép
        const posKey = ud.tag || (isRebar ? 'Khác / Chưa đặt Pos' : 'Không có Tag/Pos');
        if (!groupBuilders.pos.has(posKey)) {
            groupBuilders.pos.set(posKey, {
                id: `pos_${posKey}`,
                name: posKey,
                subText: isRebar ? 'Số hiệu cốt thép' : 'Nhãn định danh',
                isRebarGroup: isRebar,
                color: isRebar ? (ud.diameter ? getRebarColorByDiameter(ud.diameter) : '#f59e0b') : '#64748b',
                count: 0,
                visible: true,
                expanded: false,
                meshes: []
            });
        }
        const posGrp = groupBuilders.pos.get(posKey);
        posGrp.count++;
        posGrp.meshes.push(mesh);

        // 2. Name
        const nameKey = ud.name || 'Chưa đặt tên (Unnamed)';
        if (!groupBuilders.name.has(nameKey)) {
            groupBuilders.name.set(nameKey, {
                id: `name_${nameKey}`,
                name: nameKey,
                subText: ud.type || 'IFC Element',
                isRebarGroup: isRebar,
                color: getColor(nameKey),
                count: 0,
                visible: true,
                expanded: false,
                meshes: []
            });
        }
        const nameGrp = groupBuilders.name.get(nameKey);
        nameGrp.count++;
        nameGrp.meshes.push(mesh);

        // 3. ObjectType
        const objTypeKey = ud.objectType || 'Chưa có ObjectType';
        if (!groupBuilders.objectType.has(objTypeKey)) {
            groupBuilders.objectType.set(objTypeKey, {
                id: `obj_${objTypeKey}`,
                name: objTypeKey,
                subText: ud.type || 'IFC Element',
                isRebarGroup: isRebar,
                color: getColor(objTypeKey),
                count: 0,
                visible: true,
                expanded: false,
                meshes: []
            });
        }
        const objGrp = groupBuilders.objectType.get(objTypeKey);
        objGrp.count++;
        objGrp.meshes.push(mesh);

        // 4. IFC Entity Type
        const entKey = ud.type || 'IFCELEMENT';
        if (!groupBuilders.entity.has(entKey)) {
            groupBuilders.entity.set(entKey, {
                id: `ent_${entKey}`,
                name: entKey,
                subText: getEntityLabel(entKey),
                isRebarGroup: isRebar,
                color: ENTITY_DEFAULT_COLORS[entKey] || '#78716c',
                count: 0,
                visible: true,
                expanded: false,
                meshes: []
            });
        }
        const entGrp = groupBuilders.entity.get(entKey);
        entGrp.count++;
        entGrp.meshes.push(mesh);
    });

    Object.values(groupBuilders).forEach(builder => builder.forEach(grp => {
        const byKey = new Map();
        grp.meshes.forEach(mesh => {
            const key = getMeshKey(mesh);
            if (!byKey.has(key)) byKey.set(key, mesh);
        });
        grp.objects = Array.from(byKey.values());
        grp.count = grp.objects.length;
    }));

    const sortFn = (a, b) => {
        if (a.isRebarGroup && !b.isRebarGroup) return -1;
        if (!a.isRebarGroup && b.isRebarGroup) return 1;
        return b.count - a.count;
    };

    allGroups.pos = Array.from(groupBuilders.pos.values()).sort(sortFn);
    allGroups.name = Array.from(groupBuilders.name.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    allGroups.objectType = Array.from(groupBuilders.objectType.values()).sort(sortFn);
    allGroups.entity = Array.from(groupBuilders.entity.values()).sort(sortFn);

    // Sắp xếp các đối tượng con bên trong mỗi nhóm theo Name tăng dần
    ['pos', 'name', 'objectType', 'entity'].forEach(key => {
        allGroups[key].forEach(grp => {
            const byName = (m1, m2) => {
                const n1 = m1.userData.name || '';
                const n2 = m2.userData.name || '';
                return n1.localeCompare(n2, undefined, { numeric: true, sensitivity: 'base' });
            };
            grp.meshes.sort(byName);
            grp.objects.sort(byName);
        });
    });
};

export const getEntityLabel = (type) => {
    const labels = {
        'IFCREINFORCINGBAR': 'Thanh cốt thép',
        'IFCREINFORCINGMESH': 'Lưới thép hàn',
        'IFCMECHANICALFASTENER': 'Ống nối ren / Bu-lông',
        'IFCTENDON': 'Cáp dự ứng lực',
        'IFCTENDONANCHOR': 'Neo dự ứng lực',
        'IFCBEAM': 'Dầm kết cấu',
        'IFCCOLUMN': 'Cột kết cấu',
        'IFCSLAB': 'Bản sàn bê tông',
        'IFCWALL': 'Tường',
        'IFCWALLSTANDARDCASE': 'Tường tiêu chuẩn',
        'IFCFOOTING': 'Móng công trình',
        'IFCPILE': 'Cọc ép/khoan nhồi',
        'IFCDOOR': 'Cửa đi',
        'IFCWINDOW': 'Cửa sổ',
        'IFCSTAIR': 'Cầu thang',
        'IFCROOF': 'Mái công trình',
        'IFCBUILDINGELEMENTPROXY': 'Cấu kiện Proxy'
    };
    return labels[type] || 'Thực thể IFC';
};

export const clashTypeOptions = computed(() => allGroups.entity.map(group => {
    const label = getEntityLabel(group.name);
    return {
        value: group.name,
        label: label === 'Thực thể IFC' ? group.name : `${label} (${group.name})`
    };
}));

export const filteredGroups = computed(() => {
    const list = allGroups[groupCriterion.value] || [];
    if (!groupSearchQuery.value.trim()) return list;
    const q = groupSearchQuery.value.toLowerCase();
    return list.filter(g => g.name.toLowerCase().includes(q) || g.subText.toLowerCase().includes(q));
});

export const toggleSingleGroupVisibility = (grp) => {
    grp.visible = !grp.visible;
    if (grp.visible) {
        grp.meshes.forEach(mesh => manuallyHiddenExpressIDs.delete(getMeshKey(mesh)));
    }
    const groupVisibilityMap = buildGroupVisibilityMap();
    grp.meshes.forEach(mesh => {
        mesh.visible = shouldMeshBeVisible(mesh, groupVisibilityMap);
    });
    updateEdgesVisibility();
};

export const setAllActiveGroupsVisibility = (visible) => {
    const list = allGroups[groupCriterion.value] || [];
    list.forEach(grp => {
        grp.visible = visible;
        if (visible) {
            grp.meshes.forEach(mesh => manuallyHiddenExpressIDs.delete(getMeshKey(mesh)));
        }
    });
    const groupVisibilityMap = buildGroupVisibilityMap();
    list.forEach(grp => {
        grp.meshes.forEach(mesh => {
            mesh.visible = shouldMeshBeVisible(mesh, groupVisibilityMap);
        });
    });
    updateEdgesVisibility();
    updateSelectionOutlines();
};

export const buildGroupVisibilityMap = () => {
    const visibilityByName = new Map();
    (allGroups[groupCriterion.value] || []).forEach(g => {
        if (!visibilityByName.has(g.name)) visibilityByName.set(g.name, g.visible);
    });
    return visibilityByName;
};

export const shouldMeshBeVisible = (mesh, groupVisibilityMap = buildGroupVisibilityMap()) => {
    const meshKey = getMeshKey(mesh);
    if (pendingDeletedExpressIDs.has(meshKey) || manuallyHiddenExpressIDs.has(meshKey)) return false;
    if (mesh.userData.sourceVisible === false) return false;
    if (filterFaultyBars.value && mesh.userData.isFaulty) return false;
    if (isRebarOnly.value && !mesh.userData.isRebar) return false;

    let key = '';
    if (groupCriterion.value === 'pos') key = mesh.userData.tag || (mesh.userData.isRebar ? 'Khác / Chưa đặt Pos' : 'Không có Tag/Pos');
    else if (groupCriterion.value === 'name') key = mesh.userData.name || 'Chưa đặt tên (Unnamed)';
    else if (groupCriterion.value === 'objectType') key = mesh.userData.objectType || 'Chưa có ObjectType';
    else if (groupCriterion.value === 'entity') key = mesh.userData.type || 'IFCELEMENT';

    if (groupVisibilityMap.get(key) === false) return false;

    return true;
};

export const updateAllMeshesVisibility = () => {
    requestRender();
    const groupVisibilityMap = buildGroupVisibilityMap();
    rt.modelGroup.children.forEach(mesh => {
        if (mesh.isMesh) {
            mesh.visible = shouldMeshBeVisible(mesh, groupVisibilityMap);
        }
    });
    updateEdgesVisibility();
    updateSelectionOutlines();
};

export const updateEdgesVisibility = () => {
    requestRender();
    if (showEdges.value && !isRebarOnly.value) ensureEdgesForVisibleMeshes();
    edgesGroup.visible = showEdges.value && !clashModeActive.value;
    edgesGroup.children.forEach(line => {
        const parentMesh = line.userData.parentMesh;
        line.visible = showEdges.value && parentMesh && parentMesh.visible && !isRebarOnly.value;
    });
    exportListVersion.value++;
    hasUnsavedChanges.value = false;
};

export const toggleSelectedVisibility = () => {
    const keys = Array.from(new Set(selectedMeshes.value.map(getMeshKey)));
    if (keys.length === 0) return;
    const hide = keys.some(key => !manuallyHiddenExpressIDs.has(key));
    keys.forEach(key => {
        if (hide) manuallyHiddenExpressIDs.add(key);
        else manuallyHiddenExpressIDs.delete(key);
    });
    updateAllMeshesVisibility();
    // showToast(hide ? 'Đã ẩn đối tượng' : 'Đã hiện đối tượng', `${keys.length} đối tượng được ${hide ? 'ẩn' : 'hiện'} bằng phím Space.`, 'success');
};

export const queueSelectedForRemoval = () => {
    const selectedKeys = new Set(selectedMeshes.value.map(getMeshKey));
    if (selectedKeys.size === 0) {
        showToast('Chưa chọn đối tượng', 'Chọn đối tượng trước khi đưa vào danh sách xóa.');
        return;
    }
    const itemsById = new Map();
    rt.modelGroup.children.forEach(mesh => {
        const key = mesh.isMesh ? getMeshKey(mesh) : '';
        if (mesh.isMesh && selectedKeys.has(key) && !itemsById.has(key)) {
            itemsById.set(key, {
                key,
                expressID: mesh.userData.expressID,
                name: mesh.userData.name,
                type: mesh.userData.type,
                fileName: mesh.userData.sourceFileName || 'Mô hình mẫu',
                sourceId: mesh.userData.sourceId
            });
        }
    });
    itemsById.forEach(item => {
        if (!pendingDeletedExpressIDs.has(item.key)) {
            pendingDeletedExpressIDs.add(item.key);
            deletedItems.value.push(item);
        }
    });
    if (itemsById.size > 0) hasUnsavedChanges.value = true;
    updateAllMeshesVisibility();
    clearSelection();
    showToast('Đã đánh dấu xóa', `${itemsById.size} cấu kiện sẽ bị xóa khi xuất IFC.`, 'success');
};

export const restoreRemovedItem = (key) => {
    pendingDeletedExpressIDs.delete(key);
    deletedItems.value = deletedItems.value.filter(item => item.key !== key);
    if (deletedItems.value.length === 0 && editHistoryCount.value === 0) {
        hasUnsavedChanges.value = false;
    }
    updateAllMeshesVisibility();
};
