import * as THREE from 'three';
import { markRaw, toRaw } from 'vue';
import { getMeshKey, getObjectMeshes, requestRender } from '../core/helpers.js';
import { isMeshSelected, updateSelectionDimmingEffect } from '../selection/selection.js';
import { batchGroup, batchSlotByElement, clippingPlanes, selectionSlotByElement, flatMaterialCache, hoverMaterial, isCropBoxActive, isFlatShading, isWireframe, isXRayMode, overlayByElement, overlayGroup, rt, selectMaterial, selectedMeshes, xrayMaterials, xrayOpacity } from '../state/state.js';
import { applyModelOpacityToMaterial, getModelOpacityBase } from '../ui/panels.js';

// Vật liệu hiển thị của một batch theo chế độ X-ray / Flat / bình thường
export const getDisplayMaterial = (original, isRebar) => {
    let material;
    if (isXRayMode.value && !isRebar) {
        material = isFlatShading.value ? xrayMaterials.flat : xrayMaterials.lit;
        applyModelOpacityToMaterial(material, xrayOpacity.value);
    } else {
        material = original;
        if (isFlatShading.value) {
            material = flatMaterialCache.get(original);
            if (!material) {
                const base = getModelOpacityBase(original);
                material = new THREE.MeshBasicMaterial({
                    color: original.color,
                    opacity: base.opacity,
                    transparent: base.transparent,
                    side: original.side,
                    depthWrite: base.depthWrite
                });
                flatMaterialCache.set(original, material);
            }
        }
        applyModelOpacityToMaterial(material);
    }
    const planes = isCropBoxActive.value ? clippingPlanes : null;
    if (material.clippingPlanes !== planes) {
        material.clippingPlanes = planes;
        material.needsUpdate = true;
    }
    material.wireframe = isWireframe.value;
    return material;
};

export const refreshBatchMaterials = () => {
    rt.batchRecords.forEach(record => {
        record.batch.material = getDisplayMaterial(record.original, record.isRebar);
    });
};

// Cấu kiện đang chọn được vẽ trong batch chọn riêng (rebuildSelectionBatches) nên instance gốc luôn ẩn
const isDrawnElsewhere = (element) => overlayByElement.has(element) || selectionSlotByElement.has(element);

export const setBatchInstanceVisible = (element, visible) => {
    const slot = batchSlotByElement.get(element);
    if (slot) slot.batch.setVisibleAt(slot.id, visible);
};

// Đồng bộ visibility logic của từng cấu kiện vào instance trong batch (instance đang được overlay thì ẩn)
export const syncBatchVisibility = () => {
    rt.batchRecords.forEach(record => {
        record.elements.forEach((element, id) => {
            record.batch.setVisibleAt(id, element.visible && !isDrawnElsewhere(element));
        });
    });
    rt.selectionBatches.forEach(record => {
        record.elements.forEach((element, id) => record.batch.setVisibleAt(id, element.visible));
    });
    overlayByElement.forEach((overlay, element) => {
        overlay.visible = element.visible;
    });
};

// Overlay: vẽ cấu kiện được chọn/hover bằng material riêng, ẩn instance gốc trong batch
export const setElementOverlay = (mesh, material) => {
    // Cấu kiện đang chọn đã nằm trong batch chọn, không tạo overlay hover đè lên
    if (selectionSlotByElement.has(mesh)) return;
    let overlay = overlayByElement.get(mesh);
    if (!overlay) {
        overlay = new THREE.Mesh(mesh.geometry, material);
        overlay.userData.element = mesh;
        overlayGroup.add(overlay);
        overlayByElement.set(mesh, overlay);
    }
    overlay.material = material;
    mesh.matrix.decompose(overlay.position, overlay.quaternion, overlay.scale);
    overlay.visible = mesh.visible;
    setBatchInstanceVisible(mesh, false);
};

export const removeElementOverlay = (mesh) => {
    const overlay = overlayByElement.get(mesh);
    if (!overlay) return;
    overlayGroup.remove(overlay);
    overlayByElement.delete(mesh);
    setBatchInstanceVisible(mesh, mesh.visible && !selectionSlotByElement.has(mesh));
};

const disposeSelectionBatches = () => {
    rt.selectionBatches.forEach(record => {
        overlayGroup.remove(record.batch);
        record.batch.dispose();
    });
    rt.selectionBatches = [];
    selectionSlotByElement.clear();
};

// Vẽ toàn bộ cấu kiện đang chọn bằng vài BatchedMesh dùng selectMaterial (nhóm theo bộ thuộc tính hình học),
// thay vì mỗi cấu kiện một mesh overlay: chọn hàng nghìn cấu kiện vẫn chỉ thêm vài lệnh vẽ, xoay không bị lag.
// selected: Set các mesh (raw) đang chọn.
export const rebuildSelectionBatches = (selected) => {
    const previous = Array.from(selectionSlotByElement.keys());
    disposeSelectionBatches();
    previous.forEach(element => {
        if (!selected.has(element)) setBatchInstanceVisible(element, element.visible && !overlayByElement.has(element));
    });

    const groups = new Map();
    selected.forEach(element => {
        if (!element?.isMesh || !element.geometry?.attributes?.position || !element.parent) return;
        const attrNames = Object.keys(element.geometry.attributes).sort().join(',');
        if (!groups.has(attrNames)) groups.set(attrNames, []);
        groups.get(attrNames).push(element);
    });

    groups.forEach(elements => {
        let vertexCount = 0;
        let indexCount = 0;
        elements.forEach(element => {
            const geo = element.geometry;
            if (!geo.index) geo.setIndex(Array.from({ length: geo.attributes.position.count }, (_, i) => i));
            vertexCount += geo.attributes.position.count;
            indexCount += geo.index.count;
        });
        const batch = new THREE.BatchedMesh(elements.length, vertexCount, indexCount, selectMaterial);
        batch.frustumCulled = false;
        // Sắp xếp từng cấu kiện theo khoảng cách khi trong suốt, giống các mesh overlay riêng trước đây
        batch.sortObjects = true;
        const record = { batch, elements: [], isSelection: true };
        batch.userData.record = record;
        elements.forEach(element => {
            const id = batch.addGeometry(element.geometry);
            element.updateMatrix();
            batch.setMatrixAt(id, element.matrix);
            batch.setVisibleAt(id, element.visible);
            record.elements[id] = element;
            selectionSlotByElement.set(element, { batch, id });
            // Overlay hover (nếu có) của cấu kiện vừa được chọn không còn cần
            const overlay = overlayByElement.get(element);
            if (overlay) {
                overlayGroup.remove(overlay);
                overlayByElement.delete(element);
            }
            setBatchInstanceVisible(element, false);
        });
        batch.computeBoundingBox();
        batch.computeBoundingSphere();
        overlayGroup.add(batch);
        rt.selectionBatches.push(record);
    });
    requestRender();
};

export const restoreMeshMaterial = (mesh) => {
    getObjectMeshes(mesh).forEach(member => {
        if (!isMeshSelected(member)) removeElementOverlay(member);
    });
};

export const applyHoverMaterial = (mesh) => {
    applyModelOpacityToMaterial(hoverMaterial);
    const planes = isCropBoxActive.value ? clippingPlanes : null;
    if (hoverMaterial.clippingPlanes !== planes) {
        hoverMaterial.clippingPlanes = planes;
        hoverMaterial.needsUpdate = true;
    }
    hoverMaterial.wireframe = isWireframe.value;
    getObjectMeshes(mesh).forEach(member => setElementOverlay(member, hoverMaterial));
};

// Xây lại toàn bộ batch từ các cấu kiện hiện có trong modelGroup (gọi sau khi load/xóa/đổi tập cấu kiện)
export const rebuildBatches = () => {
    overlayByElement.forEach(overlay => overlayGroup.remove(overlay));
    overlayByElement.clear();
    disposeSelectionBatches();
    rt.batchRecords.forEach(record => {
        batchGroup.remove(record.batch);
        record.batch.dispose();
    });
    rt.batchRecords = [];
    rt.hoveredMesh = null;

    const groups = new Map();
    rt.meshesByKey = new Map();
    rt.modelGroup.children.forEach(child => {
        if (!child.isMesh) return;
        child.layers.set(1);
        child.updateMatrix();
        markRaw(child);
        const objectKey = getMeshKey(child);
        if (!rt.meshesByKey.has(objectKey)) rt.meshesByKey.set(objectKey, []);
        rt.meshesByKey.get(objectKey).push(child);
        const original = toRaw(child.userData.originalMaterial);
        const isRebar = !!child.userData.isRebar;
        const attrNames = Object.keys(child.geometry.attributes).sort().join(',');
        const key = `${original.uuid}|${isRebar}|${attrNames}`;
        if (!groups.has(key)) groups.set(key, { original, isRebar, elements: [] });
        groups.get(key).elements.push(child);
    });

    groups.forEach(({ original, isRebar, elements }) => {
        let vertexCount = 0;
        let indexCount = 0;
        elements.forEach(element => {
            const geo = element.geometry;
            if (!geo.index) geo.setIndex(Array.from({ length: geo.attributes.position.count }, (_, i) => i));
            vertexCount += geo.attributes.position.count;
            indexCount += geo.index.count;
        });
        const batch = new THREE.BatchedMesh(elements.length, vertexCount, indexCount, getDisplayMaterial(original, isRebar));
        batch.frustumCulled = false;
        const record = { batch, original, isRebar, elements };
        batch.userData.record = record;
        elements.forEach((element, id) => {
            const geometryId = batch.addGeometry(element.geometry);
            batch.setMatrixAt(geometryId, element.matrix);
            batchSlotByElement.set(element, { batch, id: geometryId });
        });
        // Tính sẵn bounds của từng instance lúc load, tránh lazy-init gây khựng ở lần xoay/pan đầu tiên
        batch.computeBoundingBox();
        batch.computeBoundingSphere();
        batchGroup.add(batch);
        rt.batchRecords.push(record);
    });
    syncBatchVisibility();
    // Compile sẵn shader của material overlay (chọn/hover) để lần hover đầu không gây khựng
    const warmupGeometry = new THREE.BoxGeometry(0.001, 0.001, 0.001);
    const warmupMeshes = [hoverMaterial, selectMaterial].map(material => new THREE.Mesh(warmupGeometry, material));
    warmupMeshes.forEach(mesh => rt.scene.add(mesh));
    rt.renderer.compile(rt.scene, rt.camera);
    warmupMeshes.forEach(mesh => rt.scene.remove(mesh));
    warmupGeometry.dispose();
    if (selectedMeshes.value.length > 0) updateSelectionDimmingEffect();
};
