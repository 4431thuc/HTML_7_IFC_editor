import * as THREE from 'three';
import { getMeshKey, getObjectMeshes, requestRender } from '../core/helpers.js';
import { queueSelectedForRemoval, toggleSelectedVisibility, updateEdgesVisibility } from '../ifc/groups.js';
import { clearCropHandleHover, cropHandleWorldUnitsPerPixel, syncCropBoxGeometryAndPlanes, toggleCropBox, updateCropHandleHover, updateCropHandleScales } from '../scene/cropbox.js';
import { toggleXRayMode } from '../scene/display.js';
import { applyHoverMaterial, restoreMeshMaterial, syncBatchVisibility } from '../scene/rendering.js';
import { clearSelection, handleMeshSelection, isMeshSelected, resolveHitElement, revealMeshInGroups, updateSelectionDimmingEffect } from './selection.js';
import { boxEnd, boxStart, clashModeActive, cropBounds, cropGroup, handleMeshes, hoveredType, isBoxSelecting, isCropBoxActive, isLoading, isShiftPressed, leftActiveTab, mouse, overlayByElement, pendingDeletedExpressIDs, raycaster, rt, selectedMeshes, showRightPanel } from '../state/state.js';
import { showPropertiesForMesh } from '../ui/properties.js';

export const updateMouseCoords = (event) => {
    const rect = rt.renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
};

export const isPointInsideCropBounds = (point) => {
    if (!isCropBoxActive.value) return true;
    const tolerance = 1e-6;
    return point.x >= cropBounds.minX - tolerance && point.x <= cropBounds.maxX + tolerance
        && point.y >= cropBounds.minY - tolerance && point.y <= cropBounds.maxY + tolerance
        && point.z >= cropBounds.minZ - tolerance && point.z <= cropBounds.maxZ + tolerance;
};

export const getVisibleModelIntersections = () => {
    if (clashModeActive.value) {
        // Khi đang xem kết quả clash, batch/overlay đang ẩn: pick trực tiếp vào các cấu kiện thật (layer 1).
        const candidates = rt.modelGroup.children.filter(mesh =>
            mesh.isMesh && mesh.visible && !pendingDeletedExpressIDs.has(getMeshKey(mesh))
        );
        const previousLayers = raycaster.layers.mask;
        raycaster.layers.set(1);
        const clashHits = raycaster.intersectObjects(candidates, false);
        raycaster.layers.mask = previousLayers;
        return clashHits.filter(hit => isPointInsideCropBounds(hit.point));
    }
    syncBatchVisibility();
    const pickables = rt.batchRecords.map(record => record.batch);
    overlayByElement.forEach(overlay => { if (overlay.visible) pickables.push(overlay); });
    return raycaster.intersectObjects(pickables, false)
        .filter(hit => isPointInsideCropBounds(hit.point));
};

export const onPointerDown = (event) => {
    requestRender();
    rt.pointerDownPos = { x: event.clientX, y: event.clientY };

    if (event.button === 1) {
        rt.isMiddleMouseDown = true;
        return;
    }

    // Nếu CropBox đang bật: Kiểm tra xem người dùng có nhấp trúng 1 trong 6 mũi tên của 6 mặt không
    if (isCropBoxActive.value && event.button === 0) {
        updateCropHandleScales();
        cropGroup.updateMatrixWorld(true);
        updateMouseCoords(event);
        raycaster.setFromCamera(mouse, rt.camera);
        const intersects = raycaster.intersectObjects(handleMeshes, true);
        if (intersects.length > 0) {
            event.stopImmediatePropagation();
            event.preventDefault();
            rt.renderer.domElement.setPointerCapture(event.pointerId);
            let topHandle = intersects[0].object;
            while (topHandle.parent && !handleMeshes.includes(topHandle)) {
                topHandle = topHandle.parent;
            }
            clearCropHandleHover();
            // Bắt đầu custom drag: lưu handle, axis, giá trị cropBounds ban đầu
            rt.cropDragHandle = topHandle;
            rt.cropDragAxis = topHandle.userData.axis;
            rt.cropDragIsMin = topHandle.userData.isMin;
            rt.cropDragStartMouse = { x: event.clientX, y: event.clientY };
            rt.cropDragPixelToWorld = cropHandleWorldUnitsPerPixel(topHandle);
            const boundsKey = rt.cropDragIsMin ? `min${rt.cropDragAxis}` : `max${rt.cropDragAxis}`;
            rt.cropDragStartValue = cropBounds[boundsKey];
            rt.controls.enabled = false;
            rt.renderer.domElement.style.cursor = 'grabbing';
            return;
        }
    }

    if (event.shiftKey && event.button === 0) {
        rt.controls.enabled = false;
        isBoxSelecting.value = true;
        boxStart.x = event.clientX;
        boxStart.y = event.clientY;
        boxEnd.x = event.clientX;
        boxEnd.y = event.clientY;
    } else if (event.button === 0) {
        rt.isOrbiting = true;
    }
};

export const onPointerMove = (event) => {
    requestRender();
    if (isBoxSelecting.value) {
        boxEnd.x = event.clientX;
        boxEnd.y = event.clientY;
        return;
    }

    // Xử lý kéo tay cầm CropBox (custom drag theo trục)
    if (rt.cropDragHandle) {
        const dx = event.clientX - rt.cropDragStartMouse.x;
        const dy = event.clientY - rt.cropDragStartMouse.y;

        // Lấy vector trục trong không gian màn hình (chiếu trục world vào camera)
        const axisWorld = rt.cropDragAxis === 'X' ? new THREE.Vector3(1,0,0)
                       : rt.cropDragAxis === 'Y' ? new THREE.Vector3(0,1,0)
                       : new THREE.Vector3(0,0,1);

        // Project trục vào không gian màn hình: dot với camera right/up
        const camRight = new THREE.Vector3();
        const camUp = new THREE.Vector3();
        rt.camera.getWorldDirection(new THREE.Vector3()); // ensure matrix updated
        rt.camera.matrix.extractBasis(camRight, camUp, new THREE.Vector3());

        const dotX = axisWorld.dot(camRight);
        const dotY = axisWorld.dot(camUp);
        const screenDelta = dx * dotX - dy * dotY; // y đảo do screen-Y ngược với world-Y
        const worldDelta = screenDelta * rt.cropDragPixelToWorld;

        const boundsKey = rt.cropDragIsMin ? `min${rt.cropDragAxis}` : `max${rt.cropDragAxis}`;
        let newValue = rt.cropDragStartValue + worldDelta;

        // Giữ mặt không vượt qua mặt đối diện (khoảng cách tối thiểu 0.1m)
        if (rt.cropDragIsMin) {
            const maxKey = `max${rt.cropDragAxis}`;
            newValue = Math.min(newValue, cropBounds[maxKey] - 0.1);
        } else {
            const minKey = `min${rt.cropDragAxis}`;
            newValue = Math.max(newValue, cropBounds[minKey] + 0.1);
        }

        cropBounds[boundsKey] = newValue;
        syncCropBoxGeometryAndPlanes();
        updateEdgesVisibility();
        return;
    }

    if (isCropBoxActive.value) {
        const handle = updateCropHandleHover(event);
        if (handle) {
            if (rt.hoveredMesh && !isMeshSelected(rt.hoveredMesh)) restoreMeshMaterial(rt.hoveredMesh);
            rt.hoveredMesh = null;
            hoveredType.value = '';
            rt.renderer.domElement.style.cursor = 'move';
            return;
        }
    } else {
        clearCropHandleHover();
    }

    if (isLoading.value || rt.modelGroup.children.length === 0 || rt.isMiddleMouseDown || rt.isOrbiting) return;
    updateMouseCoords(event);
    raycaster.setFromCamera(mouse, rt.camera);
    const intersects = getVisibleModelIntersections();

    if (rt.hoveredMesh && !isMeshSelected(rt.hoveredMesh)) {
        restoreMeshMaterial(rt.hoveredMesh);
    }
    rt.hoveredMesh = null;
    hoveredType.value = '';

    if (intersects.length > 0) {
        const hit = resolveHitElement(intersects[0]);
        rt.hoveredMesh = hit;
        rt.renderer.domElement.style.cursor = 'pointer';

        if (!isMeshSelected(hit)) {
            applyHoverMaterial(hit);
        }
        hoveredType.value = `${hit.userData.type || 'IFC'} #${hit.userData.expressID} (${hit.userData.name || 'Unnamed'})`;
    } else {
        rt.renderer.domElement.style.cursor = 'default';
    }
};

export const onPointerUp = (event) => {
    requestRender();
    if (event.button === 1) {
        rt.isMiddleMouseDown = false;
    }
    rt.isOrbiting = false;

    // Kết thúc kéo tay cầm CropBox
    if (rt.cropDragHandle) {
        rt.cropDragHandle = null;
        rt.controls.enabled = true;
        rt.renderer.domElement.style.cursor = isCropBoxActive.value && updateCropHandleHover(event) ? 'move' : 'default';
        updateEdgesVisibility();
        return;
    }

    if (isBoxSelecting.value) {
        isBoxSelecting.value = false;
        rt.controls.enabled = true;
        performBoxSelection(boxStart, boxEnd, event.ctrlKey || event.metaKey);
        return;
    }

    const dist = Math.hypot(event.clientX - rt.pointerDownPos.x, event.clientY - rt.pointerDownPos.y);
    if (dist > 5) return;

    updateMouseCoords(event);
    raycaster.setFromCamera(mouse, rt.camera);
    const intersects = getVisibleModelIntersections();

    if (intersects.length > 0) {
        const hit = resolveHitElement(intersects[0]);
        const isMultiSelect = event.ctrlKey || event.metaKey;
        handleMeshSelection(hit, isMultiSelect);
        if (isMeshSelected(hit)) revealMeshInGroups(hit);
    } else if (!event.ctrlKey) {
        clearSelection();
    }
};

export const onPointerLeave = () => {
    requestRender();
    if (rt.cropDragHandle) return;
    clearCropHandleHover();
    if (rt.hoveredMesh && !isMeshSelected(rt.hoveredMesh)) restoreMeshMaterial(rt.hoveredMesh);
    rt.hoveredMesh = null;
    hoveredType.value = '';
    if (rt.renderer) rt.renderer.domElement.style.cursor = 'default';
};

export const performBoxSelection = (start, end, isCtrl) => {
    const rect = rt.renderer.domElement.getBoundingClientRect();
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const isContainmentSelection = end.x >= start.x;

    if (maxX - minX < 5 && maxY - minY < 5) return;

    if (!isCtrl) {
        selectedMeshes.value = [];
    }

    rt.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(rt.camera.projectionMatrix, rt.camera.matrixWorldInverse)
    );
    const visibleMeshes = rt.modelGroup.children.filter(m => m.isMesh && m.visible);

    visibleMeshes.forEach(mesh => {
        const box = new THREE.Box3().setFromObject(mesh);
        if (box.isEmpty() || !frustum.intersectsBox(box)) return;
        if (isCropBoxActive.value && (
            box.min.x < cropBounds.minX || box.max.x > cropBounds.maxX ||
            box.min.y < cropBounds.minY || box.max.y > cropBounds.maxY ||
            box.min.z < cropBounds.minZ || box.max.z > cropBounds.maxZ
        )) return;

        const corners = [
            new THREE.Vector3(box.min.x, box.min.y, box.min.z),
            new THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new THREE.Vector3(box.min.x, box.max.y, box.min.z),
            new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.min.y, box.min.z),
            new THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z),
            new THREE.Vector3(box.max.x, box.max.y, box.max.z)
        ];
        let screenMinX = Infinity;
        let screenMaxX = -Infinity;
        let screenMinY = Infinity;
        let screenMaxY = -Infinity;
        let allCornersInViewDepth = true;
        let allCornersInSelection = true;

        corners.forEach(corner => {
            corner.project(rt.camera);
            const screenX = rect.left + ((corner.x + 1) * rect.width) / 2;
            const screenY = rect.top + ((1 - corner.y) * rect.height) / 2;
            screenMinX = Math.min(screenMinX, screenX);
            screenMaxX = Math.max(screenMaxX, screenX);
            screenMinY = Math.min(screenMinY, screenY);
            screenMaxY = Math.max(screenMaxY, screenY);
            if (corner.z < -1 || corner.z > 1) allCornersInViewDepth = false;
            if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) {
                allCornersInSelection = false;
            }
        });

        const fullyContained = allCornersInViewDepth && allCornersInSelection;
        const intersectsSelection = screenMaxX >= minX && screenMinX <= maxX &&
            screenMaxY >= minY && screenMinY <= maxY;
        if (!(isContainmentSelection ? fullyContained : intersectsSelection)) return;
        getObjectMeshes(mesh).forEach(member => {
            if (!isMeshSelected(member)) selectedMeshes.value.push(member);
        });
    });

    updateSelectionDimmingEffect(true);

    if (selectedMeshes.value.length > 0) {
        showPropertiesForMesh(selectedMeshes.value[selectedMeshes.value.length - 1]);
        showRightPanel.value = true;
        revealMeshInGroups(selectedMeshes.value[selectedMeshes.value.length - 1]);
        // showToast('Đã chọn theo vùng', `Đã chọn ${selectedMeshes.value.length} cấu kiện trong vùng kéo chuột.`, 'success');
    } else {
        showRightPanel.value = false;
    }
};

export const handleKeyDown = (event) => {
    if (event.key === 'Shift') isShiftPressed.value = true;
    if (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (!event.repeat && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault();
        toggleCropBox();
    }
    if (event.key === 'x' || event.key === 'X') toggleXRayMode();
    if (event.code === 'Space' && event.target.tagName !== 'BUTTON' && selectedMeshes.value.length > 0) {
        event.preventDefault();
        toggleSelectedVisibility();
    }
    if (event.key === 'Delete' && leftActiveTab.value === 'remove') {
        event.preventDefault();
        queueSelectedForRemoval();
    }
};

export const handleKeyUp = (event) => {
    if (event.key === 'Shift') isShiftPressed.value = false;
};
