import { nextTick, toRaw } from 'vue';
import * as THREE from 'three';
import { getMeshKey, getObjectMeshes, requestRender } from '../core/helpers.js';
import { filteredGroups } from '../ifc/groups.js';
import { applyHoverMaterial, restoreMeshMaterial, setElementOverlay } from '../scene/rendering.js';
import { fitCameraToSelectedObjects } from '../scene/scene.js';
import { allGroups, clippingPlanes, groupCriterion, groupListContainer, groupSearchQuery, hoveredType, isCropBoxActive, isEditingAttributes, leftActiveTab, manuallyHiddenExpressIDs, rt, selectMaterial, selectedMeshes, selectedObject, selectionOutlineMaterial, selectionOutlines, showLeftPanel, showRightPanel } from '../state/state.js';
import { applyModelOpacityToMaterial, playUiPop, showToast } from '../ui/panels.js';
import { showPropertiesForMesh } from '../ui/properties.js';

// --- 7. HIGHLIGHT ĐỐI TƯỢNG VÀ KHUNG VIỀN VÙNG CHỌN ---

export const isMeshSelected = (mesh) => {
    const rawMesh = toRaw(mesh);
    return selectedMeshes.value.some(selected => toRaw(selected) === rawMesh);
};

export const isMeshManuallyHidden = (mesh) => manuallyHiddenExpressIDs.has(getMeshKey(toRaw(mesh)));

export const updateSelectionOutlines = () => {
    if (!rt.scene) return;
    const selected = new Set(selectedMeshes.value.map(toRaw));
    selectionOutlines.forEach((entry, mesh) => {
        if (selected.has(mesh) && mesh.parent) return;
        rt.scene.remove(entry.outline);
        entry.outline.geometry.dispose();
        selectionOutlines.delete(mesh);
    });

    selected.forEach(mesh => {
        if (!mesh?.isMesh || !mesh.geometry) return;
        mesh.updateWorldMatrix(true, false);
        const matrixKey = mesh.matrixWorld.elements.map(value => value.toPrecision(10)).join(',');
        const existing = selectionOutlines.get(mesh);
        if (existing && existing.matrixKey === matrixKey) {
            existing.outline.visible = mesh.visible;
            return;
        }

        if (existing) {
            rt.scene.remove(existing.outline);
            existing.outline.geometry.dispose();
        }
        const geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
        geometry.applyMatrix4(mesh.matrixWorld);
        const outline = new THREE.LineSegments(geometry, selectionOutlineMaterial);
        outline.computeLineDistances();
        outline.renderOrder = 1001;
        outline.frustumCulled = false;
        outline.visible = mesh.visible;
        rt.scene.add(outline);
        selectionOutlines.set(mesh, { outline, matrixKey });
    });
};

export const updateSelectionDimmingEffect = (incremental = false) => {
    requestRender();
    const selected = new Set(selectedMeshes.value.map(toRaw));

    updateSelectionOutlines();
    const applyMeshSelectionState = (mesh) => {
        if (!mesh.isMesh) return;
        if (selected.has(mesh)) {
            applyModelOpacityToMaterial(selectMaterial);
            const planes = isCropBoxActive.value ? clippingPlanes : null;
            if (selectMaterial.clippingPlanes !== planes) {
                selectMaterial.clippingPlanes = planes;
                selectMaterial.needsUpdate = true;
            }
            setElementOverlay(mesh, selectMaterial);
        } else {
            restoreMeshMaterial(mesh);
        }
    };

    // Chế độ incremental chỉ xử lý mesh vừa chọn/bỏ chọn, tránh quét O(n) mỗi lần click
    if (incremental) {
        new Set([...rt.lastSelectedMeshes, ...selected]).forEach(applyMeshSelectionState);
    } else {
        rt.modelGroup.children.forEach(applyMeshSelectionState);
    }
    rt.lastSelectedMeshes = selected;
};

// Chuyển hit của raycast batch/overlay về đúng cấu kiện
export const resolveHitElement = (intersect) => {
    if (intersect.object.userData.element) return intersect.object.userData.element;
    if (intersect.object.isMesh && !intersect.object.userData.record) return intersect.object;
    return intersect.object.userData.record?.elements[intersect.batchId] ?? null;
};


export const onGroupMouseEnter = (grp) => {
    grp.objects.forEach(mesh => {
        if (!isMeshSelected(mesh) && mesh.visible) {
            applyHoverMaterial(mesh);
        }
    });
};

export const onGroupMouseLeave = (grp) => {
    grp.objects.forEach(mesh => {
        if (!isMeshSelected(mesh)) {
            restoreMeshMaterial(mesh);
        }
    });
};

export const selectGroupMeshes = (grp) => {
    grp.meshes.forEach(mesh => {
        if (!isMeshSelected(mesh)) {
            selectedMeshes.value.push(toRaw(mesh));
        }
    });
    updateSelectionDimmingEffect();
    if (grp.meshes.length > 0) {
        showPropertiesForMesh(grp.meshes[0]);
    }
};

export const zoomToGroup = (grp) => {
    const visibleMeshes = grp.meshes.filter(mesh => mesh.visible);
    if (visibleMeshes.length === 0) {
        showToast('Không thể zoom', 'Nhóm này không có cấu kiện đang hiển thị.');
        return;
    }
    selectedMeshes.value = visibleMeshes.map(toRaw);
    showPropertiesForMesh(selectedMeshes.value[0]);
    updateSelectionDimmingEffect();
    fitCameraToSelectedObjects();
};

export const onItemMouseEnter = (mesh) => {
    if (!isMeshSelected(mesh) && mesh.visible) {
        applyHoverMaterial(mesh);
        hoveredType.value = `${mesh.userData.type} #${mesh.userData.expressID} (${mesh.userData.name})`;
    }
};

export const onItemMouseLeave = (mesh) => {
    if (!isMeshSelected(mesh)) {
        restoreMeshMaterial(mesh);
    }
    hoveredType.value = '';
};

export const onItemClick = (mesh, event) => {
    const isMultiSelect = event && (event.ctrlKey || event.metaKey);
    handleMeshSelection(mesh, isMultiSelect);
};

export const onItemDblClick = (mesh) => {
    handleMeshSelection(mesh);
    fitCameraToSelectedObjects();
};

export const handleMeshSelection = (mesh, isMultiSelect = false) => {
    mesh = toRaw(mesh);
    playUiPop(700);
    const objectMeshes = getObjectMeshes(mesh);
    if (!isMultiSelect) {
        selectedMeshes.value = [...objectMeshes];
        showPropertiesForMesh(mesh);
    } else if (isMeshSelected(mesh)) {
        selectedMeshes.value = selectedMeshes.value.filter(selected => !objectMeshes.includes(toRaw(selected)));
        if (selectedMeshes.value.length > 0) {
            showPropertiesForMesh(toRaw(selectedMeshes.value[selectedMeshes.value.length - 1]));
        } else {
            selectedObject.value = null;
            showRightPanel.value = false;
        }
    } else {
        objectMeshes.forEach(member => {
            if (!isMeshSelected(member)) selectedMeshes.value.push(member);
        });
        showPropertiesForMesh(mesh);
    }
    updateSelectionDimmingEffect(true);
    showRightPanel.value = true;
};

export const revealMeshInGroups = async (mesh) => {
    if (leftActiveTab.value !== 'groups' || !showLeftPanel.value) return;
    const rawMesh = toRaw(mesh);
    const group = allGroups[groupCriterion.value].find(grp =>
        grp.meshes.some(item => toRaw(item) === rawMesh));
    if (!group) return;
    const rowMesh = group.objects.find(obj => getMeshKey(obj) === getMeshKey(rawMesh)) || rawMesh;
    if (!filteredGroups.value.includes(group)) {
        groupSearchQuery.value = '';
        showToast('Danh sách nhóm', 'Đã xóa bộ lọc tìm kiếm để hiển thị cấu kiện được chọn.', 'success');
    }
    group.expanded = true;
    await nextTick();
    const container = groupListContainer.value;
    if (!container) return;
    const row = container.querySelector(`[data-mesh-uuid="${rowMesh.uuid}"]`);
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const listRect = container.getBoundingClientRect();
    if (rowRect.top < listRect.top || rowRect.bottom > listRect.bottom) {
        container.scrollTop += rowRect.top - listRect.top - (container.clientHeight - rowRect.height) / 2;
    }
};

export const clearSelection = () => {
    if (selectedMeshes.value.length > 0) playUiPop(520);
    selectedMeshes.value = [];
    selectedObject.value = null;
    isEditingAttributes.value = false;
    showRightPanel.value = false;
    updateSelectionDimmingEffect(true);
};
