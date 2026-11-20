import { computed, nextTick, toRaw } from 'vue';
import * as THREE from 'three';
import { getMeshKey, getObjectMeshes, requestRender } from '../core/helpers.js';
import { filteredGroups } from '../ifc/groups.js';
import { applyHoverMaterial, rebuildSelectionBatches, removeElementOverlay, restoreMeshMaterial } from '../scene/rendering.js';
import { fitCameraToSelectedObjects } from '../scene/scene.js';
import { allGroups, clippingPlanes, groupCriterion, groupListContainer, groupSearchQuery, hoveredType, isCropBoxActive, isEditingAttributes, leftActiveTab, manuallyHiddenExpressIDs, pendingDeletedExpressIDs, rt, overlayByElement, selectMaterial, selectedMeshes, selectedObject, selectionOutlineMaterial, showLeftPanel, showRightPanel } from '../state/state.js';
import { applyModelOpacityToMaterial, playUiPop, showToast } from '../ui/panels.js';
import { showPropertiesForMesh } from '../ui/properties.js';
import { t } from '../i18n/index.js';

// --- 7. HIGHLIGHT ĐỐI TƯỢNG VÀ KHUNG VIỀN VÙNG CHỌN ---

// Tập cấu kiện đang chọn (tính lại một lần mỗi khi selectedMeshes đổi) để kiểm tra "đã chọn" là O(1).
// Khi thêm nhiều cấu kiện cùng lúc, gán selectedMeshes một lần thay vì push từng cái (mỗi push làm tính lại tập).
export const selectedMeshSet = computed(() => new Set(selectedMeshes.value.map(toRaw)));

export const isMeshSelected = (mesh) => selectedMeshSet.value.has(toRaw(mesh));

// Thêm các mesh vào vùng chọn (không trùng) bằng một lần gán
export const addToSelection = (meshes) => {
    const current = selectedMeshSet.value;
    const additions = [];
    const seen = new Set();
    meshes.forEach(mesh => {
        const raw = toRaw(mesh);
        if (current.has(raw) || seen.has(raw)) return;
        seen.add(raw);
        additions.push(raw);
    });
    if (additions.length) selectedMeshes.value = [...selectedMeshes.value, ...additions];
};

export const isMeshManuallyHidden = (mesh) => manuallyHiddenExpressIDs.has(getMeshKey(toRaw(mesh)));

// Cấu kiện đã đưa vào danh sách xóa: mờ, không chọn/hover/zoom được trong nhóm
export const isMeshPendingRemoval = (mesh) => pendingDeletedExpressIDs.has(getMeshKey(toRaw(mesh)));

// Cạnh (EdgesGeometry) theo không gian local của từng hình học, tính một lần rồi dùng lại
const localEdgesCache = new WeakMap();
const getLocalEdges = (geometry) => {
    let positions = localEdgesCache.get(geometry);
    if (!positions) {
        const edges = new THREE.EdgesGeometry(geometry, 15);
        positions = edges.attributes.position.array.slice();
        edges.dispose();
        localEdgesCache.set(geometry, positions);
    }
    return positions;
};

// Viền nét đứt của toàn bộ cấu kiện đang chọn gộp thành MỘT LineSegments (một lệnh vẽ),
// dựng lại mỗi khi vùng chọn / hiển thị / vị trí thay đổi
export const updateSelectionOutlines = () => {
    if (!rt.scene) return;
    const meshes = [];
    let floatCount = 0;
    selectedMeshSet.value.forEach(mesh => {
        if (!mesh?.isMesh || !mesh.geometry || !mesh.parent || !mesh.visible) return;
        const edges = getLocalEdges(mesh.geometry);
        meshes.push({ mesh, edges });
        floatCount += edges.length;
    });

    let outline = rt.selectionOutline;
    if (floatCount === 0) {
        if (outline) outline.visible = false;
        requestRender();
        return;
    }
    const merged = new Float32Array(floatCount);
    const point = new THREE.Vector3();
    let offset = 0;
    meshes.forEach(({ mesh, edges }) => {
        mesh.updateWorldMatrix(true, false);
        const matrix = mesh.matrixWorld;
        for (let i = 0; i < edges.length; i += 3) {
            point.set(edges[i], edges[i + 1], edges[i + 2]).applyMatrix4(matrix);
            merged[offset++] = point.x;
            merged[offset++] = point.y;
            merged[offset++] = point.z;
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3));
    if (!outline) {
        outline = new THREE.LineSegments(geometry, selectionOutlineMaterial);
        outline.renderOrder = 1001;
        outline.frustumCulled = false;
        rt.scene.add(outline);
        rt.selectionOutline = outline;
    } else {
        outline.geometry.dispose();
        outline.geometry = geometry;
    }
    outline.computeLineDistances();
    outline.visible = true;
    requestRender();
};

export const updateSelectionDimmingEffect = () => {
    requestRender();
    const selected = selectedMeshSet.value;
    // Material chọn theo trạng thái hiện tại (độ mờ model, CropBox)
    applyModelOpacityToMaterial(selectMaterial);
    const planes = isCropBoxActive.value ? clippingPlanes : null;
    if (selectMaterial.clippingPlanes !== planes) {
        selectMaterial.clippingPlanes = planes;
        selectMaterial.needsUpdate = true;
    }
    // Bỏ overlay hover còn sót của cấu kiện không chọn (chỉ duyệt overlay đang có, không quét cả model)
    Array.from(overlayByElement.keys()).forEach(mesh => {
        if (!selected.has(mesh)) removeElementOverlay(mesh);
    });
    rebuildSelectionBatches(selected);
    updateSelectionOutlines();
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
    const meshes = grp.meshes.filter(mesh => !isMeshPendingRemoval(mesh));
    addToSelection(meshes);
    updateSelectionDimmingEffect();
    if (meshes.length > 0) {
        showPropertiesForMesh(meshes[0]);
    }
};

export const zoomToGroup = (grp) => {
    const visibleMeshes = grp.meshes.filter(mesh => mesh.visible && !isMeshPendingRemoval(mesh));
    if (visibleMeshes.length === 0) {
        showToast(t('Không thể zoom'), t('Nhóm này không có cấu kiện đang hiển thị.'));
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
        addToSelection(objectMeshes);
        showPropertiesForMesh(mesh);
    }
    updateSelectionDimmingEffect();
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
        showToast(t('Danh sách nhóm'), t('Đã xóa bộ lọc tìm kiếm để hiển thị cấu kiện được chọn.'), 'success');
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
    updateSelectionDimmingEffect();
};
