import * as THREE from 'three';
import { getMeshKey, getObjectMeshes, requestRender } from '../core/helpers.js';
import { redo, undo } from '../core/history.js';
import { pickClashItem, selectClashFromView } from '../clash/clash.js';
import { queueSelectedForRemoval, toggleSelectedVisibility, updateEdgesVisibility } from '../ifc/groups.js';
import { clearCropHandleHover, cropHandleWorldUnitsPerPixel, syncCropBoxGeometryAndPlanes, toggleCropBox, updateCropHandleHover, updateCropHandleScales } from '../scene/cropbox.js';
import { cancelPendingDimension, clearDimensionHover, handleDimensionClick, toggleDimensionMode, updateDimensionHover } from '../dimension/dimension.js';
import { toggleXRayMode } from '../scene/display.js';
import { fitCameraToVisibleModel, resetOrbitPivotTracking } from '../scene/scene.js';
import { applyHoverMaterial, restoreMeshMaterial, syncBatchVisibility } from '../scene/rendering.js';
import { addToSelection, clearSelection, handleMeshSelection, isMeshSelected, resolveHitElement, revealMeshInGroups, updateSelectionDimmingEffect } from './selection.js';
import { boxEnd, boxStart, clashModeActive, cropBounds, cropGroup, dimModeActive, handleMeshes, hoveredType, isBoxSelecting, isCropBoxActive, isLoading, isShiftPressed, leftActiveTab, mouse, overlayByElement, overlayGroup, pendingDeletedExpressIDs, raycaster, rt, selectedMeshes, showRightPanel } from '../state/state.js';
import { showPropertiesForMesh } from '../ui/properties.js';
import { t } from '../i18n/index.js';

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

// firstHitOnly: chỉ cần điểm gần nhất (tâm xoay, hover) -> BVH dừng ở giao điểm đầu tiên của mỗi cấu kiện
export const getVisibleModelIntersections = (firstHitOnly = false) => {
    if (clashModeActive.value) {
        // Khi đang xem kết quả clash, batch/overlay đang ẩn: pick trực tiếp vào các cấu kiện thật (layer 1).
        const candidates = rt.modelGroup.children.filter(mesh =>
            mesh.isMesh && mesh.visible && !pendingDeletedExpressIDs.has(getMeshKey(mesh))
        );
        const previousLayers = raycaster.layers.mask;
        raycaster.layers.set(1);
        // CropBox: giao điểm đầu tiên có thể nằm trong phần bị cắt, phải xét đủ các giao điểm
        raycaster.firstHitOnly = firstHitOnly && !isCropBoxActive.value;
        const clashHits = raycaster.intersectObjects(candidates, false);
        raycaster.firstHitOnly = false;
        raycaster.layers.mask = previousLayers;
        return clashHits.filter(hit => isPointInsideCropBounds(hit.point));
    }
    syncBatchVisibility();
    const pickables = rt.batchRecords.map(record => record.batch);
    overlayByElement.forEach(overlay => { if (overlay.visible) pickables.push(overlay); });
    // Batch chọn chỉ pick được khi đang hiện (overlayGroup bị ẩn lúc xem clash)
    if (overlayGroup.visible) rt.selectionBatches.forEach(record => pickables.push(record.batch));
    return raycaster.intersectObjects(pickables, false)
        .filter(hit => isPointInsideCropBounds(hit.point));
};

export const onPointerDown = (event) => {
    requestRender();
    rt.pointerDownPos = { x: event.clientX, y: event.clientY };

    if (event.button === 1) {
        rt.isMiddleMouseDown = true;
        // Nhấp đúp nút giữa (con lăn): zoom toàn bộ cấu kiện đang hiển thị
        const now = performance.now();
        const last = rt.lastMiddleClick;
        if (last && now - last.time < 400 && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 8) {
            rt.lastMiddleClick = null;
            if (!isLoading.value) fitCameraToVisibleModel();
        } else {
            rt.lastMiddleClick = { time: now, x: event.clientX, y: event.clientY };
        }
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
        // Click trúng mesh: lấy điểm đó làm tâm xoay view
        rt.orbitPivot = null;
        if (!isLoading.value && rt.modelGroup.children.length > 0) {
            updateMouseCoords(event);
            raycaster.setFromCamera(mouse, rt.camera);
            const pivotHits = getVisibleModelIntersections(true);
            if (pivotHits.length > 0) {
                rt.orbitPivot = pivotHits[0].point.clone();
                resetOrbitPivotTracking();
            }
        }
        if (dimModeActive.value && rt.renderer.domElement.style.cursor === 'grab') rt.renderer.domElement.style.cursor = 'grabbing';
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
    // Đang giữ nút chuột (pan chuột phải/giữa, xoay): không dò hover, mỗi lần dò là một raycast toàn mô hình
    if (event.buttons !== 0) return;
    // Hover chỉ dò tối đa 1 lần mỗi khung hình (pointermove có thể bắn nhiều lần/khung)
    rt.pendingHoverEvent = { clientX: event.clientX, clientY: event.clientY };
    if (rt.hoverFrameRequested) return;
    rt.hoverFrameRequested = true;
    requestAnimationFrame(processPendingHover);
};

// Vừa lăn chuột zoom thì bỏ qua hover một lúc: camera đang đổi liên tục, dò hover chỉ làm chậm khung hình
const WHEEL_HOVER_PAUSE_MS = 250;
export const onCanvasWheel = () => { rt.lastWheelTime = performance.now(); };

const processPendingHover = () => {
    rt.hoverFrameRequested = false;
    const event = rt.pendingHoverEvent;
    rt.pendingHoverEvent = null;
    if (!event || isLoading.value || rt.isMiddleMouseDown || rt.isOrbiting || isBoxSelecting.value || rt.cropDragHandle) return;
    if (performance.now() - (rt.lastWheelTime || 0) < WHEEL_HOVER_PAUSE_MS) return;
    // View va chạm: không tô hover cấu kiện (overlay đang ẩn), đỡ một lượt raycast mỗi lần rê chuột
    if (clashModeActive.value && !dimModeActive.value) {
        hoveredType.value = '';
        rt.renderer.domElement.style.cursor = 'default';
        return;
    }
    updateMouseCoords(event);
    raycaster.setFromCamera(mouse, rt.camera);
    // Chế độ đo cần cả danh sách giao điểm để bắt điểm; hover thường chỉ cần điểm gần nhất
    const intersects = getVisibleModelIntersections(!dimModeActive.value);

    if (rt.hoveredMesh && !isMeshSelected(rt.hoveredMesh)) {
        restoreMeshMaterial(rt.hoveredMesh);
    }
    rt.hoveredMesh = null;
    hoveredType.value = '';

    // Chế độ đo: không highlight cấu kiện, chỉ hiện quả cầu nhỏ tại điểm sẽ được chọn
    if (dimModeActive.value) {
        // Không có gì để bắt điểm (không trung, đối tượng ẩn, vùng bị CropBox cắt): cursor bàn tay như khi xoay view
        const pick = updateDimensionHover(intersects);
        rt.renderer.domElement.style.cursor = pick ? 'crosshair' : 'grab';
        return;
    }

    if (intersects.length > 0) {
        const hit = resolveHitElement(intersects[0]);
        rt.hoveredMesh = hit;
        rt.renderer.domElement.style.cursor = 'pointer';

        if (!isMeshSelected(hit)) {
            applyHoverMaterial(hit);
        }
        hoveredType.value = `${hit.userData.type || 'IFC'} #${hit.userData.expressID} (${hit.userData.name || t('Chưa đặt tên')})`;
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
    rt.orbitPivot = null;
    if (dimModeActive.value && rt.renderer.domElement.style.cursor === 'grabbing') rt.renderer.domElement.style.cursor = 'grab';

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

    // Chỉ chuột trái mới chọn cấu kiện (nút giữa/phải dùng để pan/dịch)
    if (event.button !== 0) return;

    const dist = Math.hypot(event.clientX - rt.pointerDownPos.x, event.clientY - rt.pointerDownPos.y);
    if (dist > 5) return;

    updateMouseCoords(event);
    raycaster.setFromCamera(mouse, rt.camera);

    // View va chạm: click chỉ chọn khối va chạm; trúng nền / cấu kiện thì bỏ chọn
    if (clashModeActive.value && !dimModeActive.value) {
        selectClashFromView(pickClashItem(raycaster));
        return;
    }

    const intersects = getVisibleModelIntersections();

    if (dimModeActive.value) {
        handleDimensionClick(intersects);
        return;
    }

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
    rt.pendingHoverEvent = null;
    if (rt.cropDragHandle) return;
    clearCropHandleHover();
    clearDimensionHover();
    if (rt.hoveredMesh && !isMeshSelected(rt.hoveredMesh)) restoreMeshMaterial(rt.hoveredMesh);
    rt.hoveredMesh = null;
    hoveredType.value = '';
    if (rt.renderer) rt.renderer.domElement.style.cursor = dimModeActive.value ? 'grab' : 'default';
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
    const viewProjection = new THREE.Matrix4().multiplyMatrices(rt.camera.projectionMatrix, rt.camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
    const toScreenX = (ndcX) => rect.left + ((ndcX + 1) * rect.width) / 2;
    const toScreenY = (ndcY) => rect.top + ((1 - ndcY) * rect.height) / 2;
    const insideRect = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;

    // Gom theo cấu kiện logic (một cấu kiện có thể gồm nhiều mesh)
    const objects = new Map();
    rt.modelGroup.children.forEach(mesh => {
        if (!mesh.isMesh || !mesh.visible || !mesh.geometry?.attributes?.position) return;
        const key = getMeshKey(mesh);
        if (!objects.has(key)) objects.set(key, []);
        objects.get(key).push(mesh);
    });

    // Chiếu đỉnh thật của hình học lên màn hình (không dùng hộp bao: hộp bao của thanh thép xiên rất lớn,
    // làm quét chéo chọn nhầm và quét gọn bỏ sót). behind = đỉnh nằm sau camera / ngoài độ sâu nhìn thấy.
    const projectMesh = (mesh) => {
        mesh.updateWorldMatrix(true, false);
        const e = new THREE.Matrix4().multiplyMatrices(viewProjection, mesh.matrixWorld).elements;
        const positions = mesh.geometry.attributes.position.array;
        const count = positions.length / 3;
        const xs = new Float32Array(count);
        const ys = new Float32Array(count);
        const behind = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            const w = e[3] * x + e[7] * y + e[11] * z + e[15];
            if (w <= 1e-9) {
                behind[i] = 1;
                continue;
            }
            const ndcZ = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
            if (ndcZ < -1 || ndcZ > 1) behind[i] = 1;
            xs[i] = toScreenX((e[0] * x + e[4] * y + e[8] * z + e[12]) / w);
            ys[i] = toScreenY((e[1] * x + e[5] * y + e[9] * z + e[13]) / w);
        }
        return { xs, ys, behind, count, index: mesh.geometry.index?.array ?? null };
    };

    // Hai đoạn thẳng cắt nhau (trên màn hình)
    const segmentsCross = (ax, ay, bx, by, cx, cy, dx, dy) => {
        const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
        const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
        const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
        return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
    };
    const rectEdges = [[minX, minY, maxX, minY], [maxX, minY, maxX, maxY], [maxX, maxY, minX, maxY], [minX, maxY, minX, minY]];
    const segmentHitsRect = (ax, ay, bx, by) => insideRect(ax, ay) || insideRect(bx, by)
        || rectEdges.some(([cx, cy, dx, dy]) => segmentsCross(ax, ay, bx, by, cx, cy, dx, dy));
    const pointInTriangle = (px, py, ax, ay, bx, by, cx, cy) => {
        const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
        const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
        const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
        return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
    };
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Quét từ trái sang phải: mọi đỉnh của cấu kiện phải nằm gọn trong vùng chọn
    const meshContained = (mesh) => {
        const { xs, ys, behind, count } = projectMesh(mesh);
        for (let i = 0; i < count; i++) {
            if (behind[i] || !insideRect(xs[i], ys[i])) return false;
        }
        return true;
    };
    // Quét từ phải sang trái: chỉ cần một phần hình (đỉnh, cạnh tam giác) chạm vùng chọn,
    // hoặc vùng chọn nằm trong một tam giác
    const meshCrosses = (mesh) => {
        const { xs, ys, behind, count, index } = projectMesh(mesh);
        for (let i = 0; i < count; i++) {
            if (!behind[i] && insideRect(xs[i], ys[i])) return true;
        }
        const triangleCount = Math.floor((index ? index.length : count) / 3);
        for (let tri = 0; tri < triangleCount; tri++) {
            const a = index ? index[tri * 3] : tri * 3;
            const b = index ? index[tri * 3 + 1] : tri * 3 + 1;
            const c = index ? index[tri * 3 + 2] : tri * 3 + 2;
            if (behind[a] || behind[b] || behind[c]) continue;
            if (segmentHitsRect(xs[a], ys[a], xs[b], ys[b]) || segmentHitsRect(xs[b], ys[b], xs[c], ys[c])
                || segmentHitsRect(xs[c], ys[c], xs[a], ys[a])
                || pointInTriangle(centerX, centerY, xs[a], ys[a], xs[b], ys[b], xs[c], ys[c])) return true;
        }
        return false;
    };

    // Hộp bao của mesh chiếu lên màn hình: chỉ dùng để loại nhanh trước khi xét từng đỉnh
    const screenBoxOf = (box) => {
        let sMinX = Infinity; let sMaxX = -Infinity; let sMinY = Infinity; let sMaxY = -Infinity;
        let allInDepth = true;
        const corner = new THREE.Vector3();
        for (let k = 0; k < 8; k++) {
            corner.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(viewProjection);
            if (corner.z < -1 || corner.z > 1) allInDepth = false;
            const x = toScreenX(corner.x);
            const y = toScreenY(corner.y);
            sMinX = Math.min(sMinX, x); sMaxX = Math.max(sMaxX, x);
            sMinY = Math.min(sMinY, y); sMaxY = Math.max(sMaxY, y);
        }
        return { sMinX, sMaxX, sMinY, sMaxY, allInDepth };
    };
    const missesRect = (sb) => sb.sMaxX < minX || sb.sMinX > maxX || sb.sMaxY < minY || sb.sMinY > maxY;

    const boxSelected = [];
    objects.forEach(meshes => {
        const candidates = [];
        for (const mesh of meshes) {
            const box = new THREE.Box3().setFromObject(mesh);
            if (box.isEmpty()) continue;
            // Giữ quy tắc cũ: khi bật CropBox, cấu kiện phải nằm trọn trong hộp cắt
            if (isCropBoxActive.value && (
                box.min.x < cropBounds.minX || box.max.x > cropBounds.maxX ||
                box.min.y < cropBounds.minY || box.max.y > cropBounds.maxY ||
                box.min.z < cropBounds.minZ || box.max.z > cropBounds.maxZ
            )) return;
            candidates.push({ mesh, box });
        }
        if (candidates.length === 0) return;

        const selected = isContainmentSelection
            ? candidates.every(({ mesh, box }) => {
                const sb = screenBoxOf(box);
                if (missesRect(sb)) return false;
                // Hộp bao đã nằm gọn thì chắc chắn gọn, khỏi xét từng đỉnh
                if (sb.allInDepth && sb.sMinX >= minX && sb.sMaxX <= maxX && sb.sMinY >= minY && sb.sMaxY <= maxY) return true;
                return meshContained(mesh);
            })
            : candidates.some(({ mesh, box }) => frustum.intersectsBox(box) && !missesRect(screenBoxOf(box)) && meshCrosses(mesh));
        if (selected) boxSelected.push(...meshes);
    });

    addToSelection(boxSelected);
    updateSelectionDimmingEffect();

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
    // Ctrl+Z hoàn tác, Ctrl+Y / Ctrl+Shift+Z làm lại (thao tác ghi vào IFC)
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'z' || key === 'y') {
            event.preventDefault();
            if (isLoading.value) return;
            if (key === 'y' || event.shiftKey) redo();
            else undo();
            return;
        }
    }
    if (!event.repeat && (event.key === 'c' || event.key === 'C') && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        toggleCropBox();
    }
    if (!event.repeat && (event.key === 'd' || event.key === 'D') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        toggleDimensionMode();
    }
    if (event.key === 'Escape' && dimModeActive.value && rt.dimPendingPoint) cancelPendingDimension();
    if (event.key === 'x' || event.key === 'X') toggleXRayMode();
    if (event.code === 'Space' && event.target.tagName !== 'BUTTON' && selectedMeshes.value.length > 0) {
        event.preventDefault();
        toggleSelectedVisibility();
    }
    if (event.key === 'Delete') {
        event.preventDefault();
        queueSelectedForRemoval();
    }
};

export const handleKeyUp = (event) => {
    if (event.key === 'Shift') isShiftPressed.value = false;
};
