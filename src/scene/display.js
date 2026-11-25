import * as THREE from 'three';
import { updateAllMeshesVisibility, updateEdgesVisibility } from '../ifc/groups.js';
import { refreshBatchMaterials } from './rendering.js';
import { updateSelectionDimmingEffect } from '../selection/selection.js';
import { edgeMaterial, edgesGroup, filterFaultyBars, hoverMaterial, isFlatShading, isRebarOnly, isWireframe, isXRayMode, materialCache, rt, selectMaterial, showEdges, showGrid } from '../state/state.js';
import { showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';
import { modelEdgeAngleDeg, modelEdgeAngleStorageKey } from '../state/state.js';

// TỐI ƯU HÓA HIỆU NĂNG: CHỈ TẠO VIỀN EDGES CHO CÁC KHỐI LỚN
export const toggleEdges = () => {
    showEdges.value = !showEdges.value;
    updateEdgesVisibility();
};

export const recalculateAllNormals = () => {
    let count = 0;
    rt.modelGroup.children.forEach(child => {
        if (child.isMesh && child.geometry) {
            child.geometry.computeVertexNormals();
            count++;
        }
    });
    showToast(t('Đã tính lại Normals'), t('Đã chuẩn hóa pháp tuyến cho {0} cấu kiện để khử tam giác đen.', [count]), 'success');
};

export const createEdgeOutline = (mesh, bufferGeo) => {
    if (mesh.userData.edgesBuilt) return;
    mesh.userData.edgesBuilt = true;
    try {
        // Tối ưu hóa: Chỉ tạo edges cho các cấu kiện có số đỉnh vừa phải để tránh lag khi mở file 30MB
        if (bufferGeo.attributes.position.count > 4000) return;

        const edgesGeo = new THREE.EdgesGeometry(bufferGeo, modelEdgeAngleDeg.value);
        const line = new THREE.LineSegments(edgesGeo, edgeMaterial);
        line.matrixAutoUpdate = false;
        mesh.updateMatrix();
        line.matrix.copy(mesh.matrix);
        line.userData = { parentMesh: mesh };
        edgesGroup.add(line);
    } catch (e) {
        console.error('Không thể tạo viền cấu kiện:', e);
    }
};

// Viền chỉ được tạo khi cần hiển thị (lazy), tránh tạo EdgesGeometry cho toàn bộ cấu kiện lúc mở file
export const ensureEdgesForVisibleMeshes = () => {
    rt.modelGroup.children.forEach(mesh => {
        if (mesh.isMesh && mesh.visible && !mesh.userData.isRebar && !mesh.userData.edgesBuilt) {
            createEdgeOutline(mesh, mesh.geometry);
        }
    });
};

// Đổi ngưỡng góc nếp gấp: bỏ viền riêng của từng cấu kiện (giữ đường giao giữa các cấu kiện), tạo lại theo góc mới.
// Gọi khi thả thanh kéo (không gọi liên tục lúc kéo vì EdgesGeometry của cả model khá nặng).
export const applyModelEdgeAngle = () => {
    try {
        localStorage.setItem(modelEdgeAngleStorageKey, String(modelEdgeAngleDeg.value));
    } catch (error) {
        console.error('Không thể lưu cài đặt góc nếp gấp:', error);
    }
    edgesGroup.children.slice().forEach(line => {
        if (line.userData.pairMesh) return;
        line.geometry?.dispose();
        edgesGroup.remove(line);
    });
    rt.modelGroup?.children.forEach(mesh => {
        if (mesh.isMesh) mesh.userData.edgesBuilt = false;
    });
    updateEdgesVisibility();
};

// --- 6. CÁC TÙY CHỌN HIỂN THỊ ---
export const toggleRebarOnly = () => {
    isRebarOnly.value = !isRebarOnly.value;
    updateAllMeshesVisibility();
};

export const toggleXRayMode = () => {
    isXRayMode.value = !isXRayMode.value;
    applyXRayMaterialEffect();
};

export const applyXRayMaterialEffect = () => {
    refreshBatchMaterials();
    updateSelectionDimmingEffect();
};

export const toggleFlatShading = () => {
    isFlatShading.value = !isFlatShading.value;
    refreshBatchMaterials();
    updateSelectionDimmingEffect();
};

export const toggleFilterFaultyBars = () => {
    filterFaultyBars.value = !filterFaultyBars.value;
    updateAllMeshesVisibility();
};

export const toggleWireframe = () => {
    isWireframe.value = !isWireframe.value;
    materialCache.forEach(mat => { mat.wireframe = isWireframe.value; });
    rt.modelGroup.children.forEach(mesh => {
        if (mesh.isMesh && mesh.material) mesh.material.wireframe = isWireframe.value;
    });
    hoverMaterial.wireframe = isWireframe.value;
    selectMaterial.wireframe = isWireframe.value;
    refreshBatchMaterials();
};

export const toggleGrid = () => {
    showGrid.value = !showGrid.value;
    if (rt.gridHelper) rt.gridHelper.visible = showGrid.value;
};
