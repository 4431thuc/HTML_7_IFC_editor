import * as THREE from 'three';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import { markRaw, nextTick } from 'vue';
import { getMeshKey, getObjectMeshes, requestRender } from '../core/helpers.js';
import { refreshBatchMaterials } from '../scene/rendering.js';
import { clearSelection } from '../selection/selection.js';
import { getEntityLabel } from '../ifc/groups.js';
import { batchGroup, clashAnnotationGroup, clashCancelPrompt, clashResultsReady, clashVolumeMaterial, clashFlashMaterial, clashHideOtherRebar, clashInvolvedMaterial, CLASH_GHOST_LAYER, clashBusy, clashContextGroup, clashContextMaterial, clashCount, clashError, clashGroup, clashItems, clashModeActive, clashOutlineMaterial, clashPairGroup, clashPairMaterialA, clashPairMaterialB, clashProgress, clashSelectionGroup, clashToleranceMm, clashTypeA, clashTypeB, clashVolume, clashYellowMaterial, edgesGroup, isOrthographic, overlayGroup, pendingDeletedExpressIDs, rt, selectedClashId, selectionOutlineMaterial, showClashPairObjects, showEdges } from '../state/state.js';
import { applyModelOpacityToScene, showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';

// --- GỘP HÌNH HỌC ĐỂ GIẢM LỆNH VẼ ---
// View clash trước đây vẽ mỗi cấu kiện một LineSegments đường bao + mỗi khối clash một mesh và một viền
// (hàng nghìn draw call mỗi khung hình). Nay gộp: 1 LineSegments đường bao, 1 mesh khối clash, 1 LineSegments viền.

// Cạnh local của từng geometry (ngưỡng 18°), tính một lần rồi dùng lại cho các lần kiểm tra sau
const contextEdgesCache = new WeakMap();
const getContextEdges = (geometry) => {
    let positions = contextEdgesCache.get(geometry);
    if (!positions) {
        const edges = new THREE.EdgesGeometry(geometry, 18);
        positions = edges.attributes.position.array.slice();
        edges.dispose();
        contextEdgesCache.set(geometry, positions);
    }
    return positions;
};

// Nối các mảng tọa độ local (mỗi phần kèm ma trận world) thành một Float32Array world
const mergeWorldPositions = (parts) => {
    const total = parts.reduce((sum, part) => sum + part.positions.length, 0);
    const merged = new Float32Array(total);
    const vertex = new THREE.Vector3();
    let offset = 0;
    parts.forEach(({ positions, matrix }) => {
        for (let i = 0; i < positions.length; i += 3) {
            vertex.set(positions[i], positions[i + 1], positions[i + 2]);
            if (matrix) vertex.applyMatrix4(matrix);
            merged[offset++] = vertex.x;
            merged[offset++] = vertex.y;
            merged[offset++] = vertex.z;
        }
    });
    return merged;
};

const createMergedLines = (positions, material, renderOrder) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = renderOrder;
    lines.raycast = () => {};
    return lines;
};

// Tọa độ tam giác (không index) của một geometry
const getTrianglePositions = (geometry) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const positions = source.attributes.position.array.slice();
    if (source !== geometry) source.dispose();
    return positions;
};

export const clearClashPairObjects = () => {
    while (clashPairGroup.children.length) {
        clashPairGroup.remove(clashPairGroup.children[0]);
    }
};
export const refreshClashPairObjects = () => {
    clearClashPairObjects();
    const item = clashItems.value.find(entry => entry.id === selectedClashId.value);
    if (showClashPairObjects.value && item) {
        [[item.sourceA, clashPairMaterialA], [item.sourceB, clashPairMaterialB]].forEach(([source, material]) => {
            if (!source?.geometry) return;
            // Dùng chung geometry gốc của cấu kiện (không dispose), chỉ đặt lại ma trận world.
            const pairMesh = new THREE.Mesh(source.geometry, material);
            pairMesh.matrixAutoUpdate = false;
            pairMesh.matrix.copy(source.matrixWorld);
            pairMesh.matrixWorld.copy(source.matrixWorld);
            pairMesh.frustumCulled = false;
            pairMesh.renderOrder = 50;
            clashPairGroup.add(pairMesh);
        });
    }
    requestRender();
};
export const toggleClashPairObjects = () => {
    showClashPairObjects.value = !showClashPairObjects.value;
    refreshClashPairObjects();
};
export const clearClashSelectionVisuals = () => {
    clearClashPairObjects();
    if (rt.clashFlashInterval) clearInterval(rt.clashFlashInterval);
    if (rt.clashFlashTimeout) clearTimeout(rt.clashFlashTimeout);
    rt.clashFlashInterval = null;
    rt.clashFlashTimeout = null;
    rt.selectedClashMesh = null;
    selectedClashId.value = null;
    while (clashSelectionGroup.children.length) {
        const child = clashSelectionGroup.children[0];
        // Mesh tô vàng/đỏ dùng chung geometry của khối clash (giữ lại để chọn lần sau)
        if (!child.userData.sharedGeometry) child.geometry?.dispose();
        clashSelectionGroup.remove(child);
    }
    while (clashAnnotationGroup.children.length) {
        const child = clashAnnotationGroup.children[0];
        child.traverse(node => {
            node.geometry?.dispose();
            if (node.material) {
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                materials.forEach(material => {
                    material.map?.dispose();
                    material.dispose();
                });
            }
        });
        clashAnnotationGroup.remove(child);
    }
};
// --- NHÃN VA CHẠM: cỡ cố định theo pixel màn hình (giống nhãn đo kích thước), zoom gần/xa không đổi ---
const LABEL_FONT_PX = 12;
const LABEL_LINE_PX = 18;
const LABEL_PADDING_PX = 8;
const LABEL_SWATCH_PX = 10;
// Góc dưới trái nhãn cách điểm va chạm bao nhiêu pixel (sang phải, lên trên)
const LABEL_OFFSET_PX = { x: 36, y: 30 };
const PAIR_COLORS = { A: '#3b82f6', B: '#a855f7' };

// Kích thước world của 1 pixel màn hình tại vị trí position
const worldUnitsPerPixel = (position) => {
    const height = Math.max(rt.renderer.domElement.clientHeight, 1);
    if (isOrthographic.value) return (rt.camera.top - rt.camera.bottom) / rt.camera.zoom / height;
    const distance = rt.camera.position.distanceTo(position);
    return 2 * distance * Math.tan(THREE.MathUtils.degToRad(rt.camera.fov) / 2) / height;
};

// Mô tả ngắn một cấu kiện: thép -> Pos + Ø, loại khác -> tên loại + Tag/Name
export const describeClashElement = (mesh) => {
    const ud = mesh?.userData || {};
    if (ud.isRebar) return `Pos ${ud.tag || '?'} · Ø${ud.diameter || '?'}`;
    const label = getEntityLabel(ud.type);
    const typeText = label === 'Thực thể IFC' ? (ud.type || 'IFC') : t(label);
    return `${typeText} · ${ud.tag || ud.name || `#${ud.expressID}`}`;
};

export const formatClashVolume = (cubicMeters) => {
    const cm3 = cubicMeters * 1e6;
    if (cm3 < 1000) return `${cm3 < 10 ? cm3.toFixed(2) : cm3.toFixed(1)} cm³`;
    return `${(cubicMeters * 1000).toFixed(2)} dm³`;
};

const drawClashLabelTexture = (item, itemIndex) => {
    const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
    const rows = [
        { text: `${t('Va chạm #{0}', [itemIndex + 1])}  ·  ${formatClashVolume(item.volume)}`, bold: true, color: '#fde68a' },
        { text: `A: ${describeClashElement(item.sourceA)}`, swatch: PAIR_COLORS.A, color: '#e2e8f0' },
        { text: `B: ${describeClashElement(item.sourceB)}`, swatch: PAIR_COLORS.B, color: '#e2e8f0' }
    ];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = (bold) => `${bold ? 'bold ' : ''}${LABEL_FONT_PX * scale}px Arial, sans-serif`;
    let maxTextPx = 0;
    rows.forEach(row => {
        ctx.font = font(row.bold);
        const swatchSpace = row.swatch ? (LABEL_SWATCH_PX + 6) * scale : 0;
        maxTextPx = Math.max(maxTextPx, ctx.measureText(row.text).width + swatchSpace);
    });
    const widthPx = Math.ceil(maxTextPx / scale + LABEL_PADDING_PX * 2);
    const heightPx = rows.length * LABEL_LINE_PX + LABEL_PADDING_PX * 2 - 4;
    canvas.width = widthPx * scale;
    canvas.height = heightPx * scale;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.roundRect(ctx.lineWidth / 2, ctx.lineWidth / 2, canvas.width - ctx.lineWidth, canvas.height - ctx.lineWidth, 6 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.textBaseline = 'middle';
    rows.forEach((row, index) => {
        const y = (LABEL_PADDING_PX - 2 + LABEL_LINE_PX * index + LABEL_LINE_PX / 2) * scale;
        let x = LABEL_PADDING_PX * scale;
        if (row.swatch) {
            ctx.fillStyle = row.swatch;
            ctx.fillRect(x, y - (LABEL_SWATCH_PX / 2) * scale, LABEL_SWATCH_PX * scale, LABEL_SWATCH_PX * scale);
            x += (LABEL_SWATCH_PX + 6) * scale;
        }
        ctx.font = font(row.bold);
        ctx.fillStyle = row.color;
        ctx.fillText(row.text, x, y);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, widthPx, heightPx };
};

export const addClashLocationLabel = (item, itemIndex) => {
    if (!item?.bounds?.min || !item?.bounds?.max) return;
    const box = new THREE.Box3(
        new THREE.Vector3(...item.bounds.min),
        new THREE.Vector3(...item.bounds.max)
    );
    const anchor = box.getCenter(new THREE.Vector3());

    const leader = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
        color: 0xffd21f, transparent: false, depthTest: false, depthWrite: false, toneMapped: false
    }));
    leader.renderOrder = 2000;
    leader.frustumCulled = false;

    const { texture, widthPx, heightPx } = drawClashLabelTexture(item, itemIndex);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false
    }));
    // Neo góc dưới trái của nhãn vào đầu đường dẫn
    sprite.center.set(0, 0);
    sprite.renderOrder = 2001;
    sprite.frustumCulled = false;

    const annotation = new THREE.Group();
    annotation.add(leader, sprite);
    annotation.userData.clashLabel = { anchor, widthPx, heightPx, leader, sprite };
    annotation.frustumCulled = false;
    clashAnnotationGroup.add(annotation);
    updateClashAnnotationCamera();
};

// Mỗi khung hình: giữ nhãn và đường dẫn đúng cỡ pixel, luôn lệch lên trên-phải của điểm va chạm theo màn hình
export const updateClashAnnotationCamera = () => {
    if (!rt.camera || !rt.renderer || !clashAnnotationGroup.visible) return;
    rt.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(rt.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(rt.camera.matrixWorld, 1).normalize();
    clashAnnotationGroup.children.forEach(annotation => {
        const data = annotation.userData.clashLabel;
        if (!data) return;
        const unit = worldUnitsPerPixel(data.anchor);
        const labelPosition = data.anchor.clone()
            .addScaledVector(right, LABEL_OFFSET_PX.x * unit)
            .addScaledVector(up, LABEL_OFFSET_PX.y * unit);
        data.sprite.position.copy(labelPosition);
        data.sprite.scale.set(data.widthPx * unit, data.heightPx * unit, 1);
        data.leader.geometry.setFromPoints([data.anchor, labelPosition]);
        data.leader.geometry.computeBoundingSphere();
    });
};
export const selectClashItem = (item) => {
    clearClashSelectionVisuals();
    if (!item?.mesh || !item.mesh.isMesh) return;
    selectedClashId.value = item.id;
    // Khối clash nằm trong mesh gộp: tô màu bằng một mesh riêng vẽ đè lên (dùng chung geometry của khối)
    const highlight = new THREE.Mesh(item.mesh.geometry, clashYellowMaterial);
    highlight.matrixAutoUpdate = false;
    highlight.matrix.copy(item.mesh.matrixWorld);
    highlight.matrixWorld.copy(item.mesh.matrixWorld);
    highlight.renderOrder = 102;
    highlight.userData.sharedGeometry = true;
    highlight.raycast = () => {};
    clashSelectionGroup.add(highlight);
    rt.selectedClashMesh = highlight;

    // Viền nét đứt cùng phong cách viền đối tượng đang được select trong mô hình.
    const outlineGeometry = new THREE.EdgesGeometry(item.mesh.geometry, 15);
    outlineGeometry.applyMatrix4(item.mesh.matrixWorld);
    const outline = new THREE.LineSegments(outlineGeometry, selectionOutlineMaterial);
    outline.computeLineDistances();
    outline.renderOrder = 2002;
    outline.frustumCulled = false;
    clashSelectionGroup.add(outline);
    addClashLocationLabel(item, Math.max(0, clashItems.value.findIndex(entry => entry.id === item.id)));

    // Nhấp nháy trắng/vàng trong 0,5 giây (khối đỏ xung quanh), sau đó giữ màu vàng.
    let showFlash = true;
    rt.selectedClashMesh.material = clashFlashMaterial;
    rt.clashFlashInterval = setInterval(() => {
        if (!rt.selectedClashMesh || rt.selectedClashMesh !== highlight) return;
        showFlash = !showFlash;
        rt.selectedClashMesh.material = showFlash ? clashFlashMaterial : clashYellowMaterial;
        requestRender();
    }, 65);
    rt.clashFlashTimeout = setTimeout(() => {
        if (rt.clashFlashInterval) clearInterval(rt.clashFlashInterval);
        rt.clashFlashInterval = null;
        rt.clashFlashTimeout = null;
        if (rt.selectedClashMesh === highlight) highlight.material = clashYellowMaterial;
        requestRender();
        }, 500);
    requestRender();
    refreshClashPairObjects();
};
export const applyClashDisplayMode = () => {
    const active = clashModeActive.value;
    // Batch vẫn hiện trong view va chạm nhưng mang vật liệu xám mờ (getDisplayMaterial trong rendering.js)
    if (batchGroup) batchGroup.visible = true;
    if (overlayGroup) overlayGroup.visible = !active;
    if (edgesGroup) edgesGroup.visible = showEdges.value && !active;
    clashContextGroup.visible = active;
    clashGroup.visible = active;
    clashSelectionGroup.visible = active;
    clashAnnotationGroup.visible = active;
    clashPairGroup.visible = active;
    requestRender();
};

// Tắt / bật lại view va chạm, giữ nguyên kết quả (khối clash, danh sách)
const setClashView = (active) => {
    // Vào view va chạm: bỏ vùng chọn cấu kiện (trong view này chỉ chọn khối va chạm)
    if (active) clearSelection();
    clashModeActive.value = active;
    refreshBatchMaterials();
    applyModelOpacityToScene();
    applyClashDisplayMode();
};
// --- CLICK TRONG VIEW VA CHẠM: chỉ bắt khối va chạm, không bao giờ chọn cấu kiện (đang mờ/ẩn) ---
const CLASH_PICK_TOLERANCE_PX = 6;
// raycaster đã setFromCamera; trả về va chạm trúng (hoặc gần trong vài pixel) hay null
export const pickClashItem = (raycaster) => {
    const items = clashItems.value.filter(item => item.mesh);
    if (items.length === 0) return null;
    const hits = raycaster.intersectObjects(items.map(item => item.mesh), false);
    if (hits.length > 0) return items.find(item => item.mesh === hits[0].object) || null;
    // Khối giao giữa 2 thanh thép rất mảnh: cho phép trượt vài pixel quanh hộp bao của khối
    let best = null;
    let bestDistance = Infinity;
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    items.forEach(item => {
        box.min.fromArray(item.bounds.min);
        box.max.fromArray(item.bounds.max);
        box.expandByScalar(CLASH_PICK_TOLERANCE_PX * worldUnitsPerPixel(box.getCenter(point)));
        if (!raycaster.ray.intersectBox(box, point)) return;
        const distance = point.distanceTo(raycaster.ray.origin);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = item;
        }
    });
    return best;
};

// Chọn va chạm từ view: tô vàng, nhãn, A/B và cuộn danh sách tới đúng dòng (không đổi camera)
export const selectClashFromView = (item) => {
    if (!item) {
        clearClashSelectionVisuals();
        requestRender();
        return;
    }
    selectClashItem(item);
    nextTick(() => {
        const row = document.querySelector(`[data-clash-id="${CSS.escape(item.id)}"]`);
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
};

export const toggleClashView = () => {
    if (!clashResultsReady.value) return;
    setClashView(!clashModeActive.value);
};

// Nút Hủy kết quả: hỏi trước (hộp thoại yes/no trong index.html)
export const requestClearClashResults = () => {
    if (clashResultsReady.value) clashCancelPrompt.value = true;
};
export const answerClashCancelPrompt = (confirmed) => {
    clashCancelPrompt.value = false;
    if (confirmed) clearClashResults();
};
export const clearClashGeometry = () => {
    clearClashSelectionVisuals();
    clashItems.value.forEach(item => item.mesh?.geometry?.dispose());
    while (clashGroup.children.length) {
        const child = clashGroup.children[0];
        child.traverse(node => {
            if (node.geometry) node.geometry.dispose();
        });
        clashGroup.remove(child);
    }
    while (clashContextGroup.children.length) {
        const child = clashContextGroup.children[0];
        child.geometry?.dispose();
        clashContextGroup.remove(child);
    }
};

// Dựng lớp vẽ gộp sau khi kiểm tra xong: khối clash (1 mesh), viền khối (1 lệnh vẽ), đường bao mô hình (1 lệnh vẽ)
const buildMergedClashDisplay = (items, candidates) => {
    if (items.length > 0) {
        const solidGeometry = new THREE.BufferGeometry();
        solidGeometry.setAttribute('position', new THREE.BufferAttribute(mergeWorldPositions(items.map(item => ({
            positions: getTrianglePositions(item.mesh.geometry),
            matrix: item.mesh.matrixWorld
        }))), 3));
        solidGeometry.computeVertexNormals();
        solidGeometry.computeBoundingSphere();
        const solids = new THREE.Mesh(solidGeometry, clashVolumeMaterial);
        solids.renderOrder = 100;
        solids.raycast = () => {};
        clashGroup.add(solids);
        clashGroup.add(createMergedLines(mergeWorldPositions(items.map(item => {
            const edges = new THREE.EdgesGeometry(item.mesh.geometry, 18);
            const positions = edges.attributes.position.array;
            edges.dispose();
            return { positions, matrix: item.mesh.matrixWorld };
        })), clashOutlineMaterial, 101));
    }
    // Cấu kiện có tham gia va chạm: khối đậm hơn nền (gộp 1 mesh)
    const involved = new Set();
    items.forEach(item => [item.sourceA, item.sourceB].forEach(mesh => getObjectMeshes(mesh).forEach(member => involved.add(member))));
    if (involved.size > 0) {
        const members = Array.from(involved);
        const involvedGeometry = new THREE.BufferGeometry();
        involvedGeometry.setAttribute('position', new THREE.BufferAttribute(mergeWorldPositions(members.map(mesh => ({
            positions: getTrianglePositions(mesh.geometry),
            matrix: mesh.matrixWorld
        }))), 3));
        involvedGeometry.computeVertexNormals();
        involvedGeometry.computeBoundingSphere();
        const involvedMesh = new THREE.Mesh(involvedGeometry, clashInvolvedMaterial);
        involvedMesh.raycast = () => {};
        // Vẽ cùng lượt "một lớp" với mô hình nền (scene.js: renderClashView)
        involvedMesh.layers.set(CLASH_GHOST_LAYER);
        clashContextGroup.add(involvedMesh);
    }
    // Đường bao rất nhạt chỉ cho bê tông / cấu kiện khác thép (thép dày đặc, vẽ viền chỉ làm rối)
    const contextParts = [];
    candidates.forEach(mesh => {
        if (mesh.userData.isRebar || involved.has(mesh)) return;
        try {
            contextParts.push({ positions: getContextEdges(mesh.geometry), matrix: mesh.matrixWorld });
        } catch (edgeError) {
            console.warn('Không tạo được đường bao cấu kiện:', edgeError);
        }
    });
    if (contextParts.length > 0) clashContextGroup.add(createMergedLines(mergeWorldPositions(contextParts), clashContextMaterial, 1));
};

export const toggleClashHideOtherRebar = () => {
    clashHideOtherRebar.value = !clashHideOtherRebar.value;
    refreshBatchMaterials();
    requestRender();
};
export const clearClashResults = () => {
    clearClashGeometry();
    clashModeActive.value = false;
    clashResultsReady.value = false;
    clashCancelPrompt.value = false;
    clashCount.value = 0;
    clashVolume.value = 0;
    clashItems.value = [];
    clashError.value = '';
    refreshBatchMaterials();
    applyModelOpacityToScene();
    applyClashDisplayMode();
    requestRender();
};
export const zoomToClash = (item) => {
    if (!item?.bounds?.min || !item?.bounds?.max || !rt.camera || !rt.controls || !rt.renderer) return;
    // Đang tắt view va chạm: bấm một cặp thì bật lại view
    if (!clashModeActive.value && clashResultsReady.value) setClashView(true);
    selectClashItem(item);
    const box = new THREE.Box3(
        new THREE.Vector3(...item.bounds.min),
        new THREE.Vector3(...item.bounds.max)
    );
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.025);
    const direction = rt.camera.position.clone().sub(rt.controls.target).normalize();
    if (direction.lengthSq() < 0.001) direction.set(1, 0.7, 1).normalize();
    const aspect = Math.max(rt.renderer.domElement.clientWidth / Math.max(rt.renderer.domElement.clientHeight, 1), 0.1);
    if (isOrthographic.value) {
        const halfHeight = Math.max(size.y, size.x / aspect, size.z, 0.05) * 0.75;
        rt.orthoCamera.left = -halfHeight * aspect;
        rt.orthoCamera.right = halfHeight * aspect;
        rt.orthoCamera.top = halfHeight;
        rt.orthoCamera.bottom = -halfHeight;
        rt.orthoCamera.near = 0.001;
        rt.orthoCamera.far = Math.max(radius * 30, 100);
        rt.orthoCamera.zoom = 1;
        rt.orthoCamera.updateProjectionMatrix();
        rt.camera.position.copy(center).addScaledVector(direction, Math.max(radius * 3, 1));
    } else {
        const fov = THREE.MathUtils.degToRad(rt.camera.fov);
        const distance = Math.max(radius / Math.sin(fov / 2) * 1.35, 0.75);
        rt.camera.position.copy(center).addScaledVector(direction, distance);
        rt.camera.near = Math.max(radius / 1000, 0.001);
        rt.camera.far = Math.max(distance + radius * 20, 100);
        rt.camera.updateProjectionMatrix();
    }
    rt.controls.target.copy(center);
    rt.controls.update();
    requestRender();
};
export const runClashCheck = async () => {
    if (clashBusy.value) return;
    const candidates = rt.modelGroup.children.filter(mesh =>
        mesh.isMesh && mesh.visible && mesh.geometry?.attributes?.position &&
        !pendingDeletedExpressIDs.has(getMeshKey(mesh))
    );
    if (candidates.length < 2) {
        showToast(t('Chưa đủ cấu kiện'), t('Cần ít nhất hai cấu kiện đang hiển thị để kiểm tra clash.'));
        return;
    }
    const toleranceMm = Number(clashToleranceMm.value);
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0 || toleranceMm > 1000) {
        clashError.value = t('Dung sai phải nằm trong khoảng từ 0 đến 1000 mm.');
        return;
    }
    const toleranceMeters = toleranceMm / 1000;
    const halfTolerance = toleranceMeters / 2;
    clashBusy.value = true;
    clashError.value = '';
    try {
        clearClashGeometry();
        clashItems.value = [];
        clashCount.value = 0;
        clashVolume.value = 0;
        clashModeActive.value = false;
        clashResultsReady.value = false;
        applyClashDisplayMode();
        rt.modelGroup.updateWorldMatrix(true, true);
        const typeA = clashTypeA.value;
        const typeB = clashTypeB.value;
        const pairMatchesTypes = (meshA, meshB) => {
            const aType = meshA.userData.type || 'IFCELEMENT';
            const bType = meshB.userData.type || 'IFCELEMENT';
            if (typeA === '*' && typeB === '*') return true;
            if (typeA === '*') return aType === typeB || bType === typeB;
            if (typeB === '*') return aType === typeA || bType === typeA;
            return (aType === typeA && bType === typeB) || (aType === typeB && bType === typeA);
        };
        const entries = candidates.map(mesh => {
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
            if (halfTolerance > 0) box.expandByScalar(halfTolerance);
            return { mesh, box };
        });
        const evaluator = new Evaluator();
        evaluator.useGroups = false;
        evaluator.attributes = ['position', 'normal'];
        const brushCache = new Map();
        const makeBrush = (mesh) => {
            let brush = brushCache.get(mesh);
            if (brush) return brush;
            const geometry = mesh.geometry.clone();
            if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
            if (halfTolerance > 0) {
                // Nới từng bề mặt ra 1/2 dung sai để bắt cả khe hở nhỏ trong giới hạn cho phép.
                const positions = geometry.getAttribute('position');
                const normals = geometry.getAttribute('normal');
                const normal = new THREE.Vector3();
                for (let vertex = 0; vertex < positions.count; vertex++) {
                    normal.fromBufferAttribute(normals, vertex);
                    if (normal.lengthSq() > 1e-12) normal.normalize();
                    positions.setXYZ(
                        vertex,
                        positions.getX(vertex) + normal.x * halfTolerance,
                        positions.getY(vertex) + normal.y * halfTolerance,
                        positions.getZ(vertex) + normal.z * halfTolerance
                    );
                }
                positions.needsUpdate = true;
                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
            }
            if (!geometry.boundsTree && geometry.computeBoundsTree) geometry.computeBoundsTree();
            brush = new Brush(geometry, clashVolumeMaterial);
            brush.matrixAutoUpdate = false;
            brush.matrix.copy(mesh.matrixWorld);
            brush.updateMatrixWorld(true);
            brushCache.set(mesh, brush);
            return brush;
        };
        const found = [];
        let checked = 0;
        let totalPairs = 0;
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const a = entries[i], b = entries[j];
                if (getMeshKey(a.mesh) !== getMeshKey(b.mesh) && pairMatchesTypes(a.mesh, b.mesh) && a.box.intersectsBox(b.box)) totalPairs++;
            }
        }
        for (let i = 0; i < entries.length; i++) {
            if (rt.clashCancelRequested) break;
            const a = entries[i];
            for (let j = i + 1; j < entries.length; j++) {
                const b = entries[j];
                if (rt.clashCancelRequested) break;
                if (getMeshKey(a.mesh) === getMeshKey(b.mesh) || !pairMatchesTypes(a.mesh, b.mesh) || !a.box.intersectsBox(b.box)) continue;
                checked++;
                clashProgress.value = checked / Math.max(totalPairs, 1);
                if (checked % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));

                try {
                    const result = evaluator.evaluate(makeBrush(a.mesh), makeBrush(b.mesh), INTERSECTION);
                    const geometry = result.geometry;
                    if (!geometry?.attributes?.position || geometry.attributes.position.count < 4) {
                        geometry?.dispose();
                        continue;
                    }
                    result.updateMatrixWorld(true);
                    const position = geometry.attributes.position;
                    const index = geometry.index;
                    let signedVolume = 0;
                    const triangleCount = index ? index.count / 3 : position.count / 3;
                    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
                    for (let triangle = 0; triangle < triangleCount; triangle++) {
                        const ia = index ? index.getX(triangle * 3) : triangle * 3;
                        const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
                        const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
                        va.fromBufferAttribute(position, ia);
                        vb.fromBufferAttribute(position, ib);
                        vc.fromBufferAttribute(position, ic);
                        signedVolume += va.dot(vb.clone().cross(vc)) / 6;
                    }
                    const transformScale = Math.abs(result.matrixWorld.determinant());
                    const intersectionVolume = Math.abs(signedVolume) * transformScale;
                    if (!Number.isFinite(intersectionVolume) || intersectionVolume < 1e-10) {
                        geometry.dispose();
                        continue;
                    }
                    // Giữ khối giao làm dữ liệu (bounds, tô màu khi chọn); vẽ bằng mesh gộp sau vòng lặp
                    const clashMesh = new THREE.Mesh(geometry, clashVolumeMaterial);
                    clashMesh.matrixAutoUpdate = false;
                    clashMesh.matrix.copy(result.matrixWorld);
                    clashMesh.matrixWorld.copy(result.matrixWorld);
                    geometry.computeBoundingBox();
                    const intersectionBounds = geometry.boundingBox.clone().applyMatrix4(clashMesh.matrixWorld);
                    found.push({
                        id: `${getMeshKey(a.mesh)}|${getMeshKey(b.mesh)}|${i}|${j}`,
                        nameA: a.mesh.userData.name || `#${a.mesh.userData.expressID}`,
                        nameB: b.mesh.userData.name || `#${b.mesh.userData.expressID}`,
                        typeA: a.mesh.userData.type || 'IFCELEMENT',
                        typeB: b.mesh.userData.type || 'IFCELEMENT',
                        volume: intersectionVolume,
                        mesh: markRaw(clashMesh),
                        sourceA: markRaw(a.mesh),
                        sourceB: markRaw(b.mesh),
                        bounds: {
                            min: intersectionBounds.min.toArray(),
                            max: intersectionBounds.max.toArray()
                        }
                    });
                } catch (pairError) {
                    console.warn('Không thể tính giao thể tích cho một cặp cấu kiện:', pairError);
                }
            }
        }
        brushCache.forEach(brush => brush.geometry.dispose());
        if (rt.clashCancelRequested) {
            // Khối giao đã tính chưa nằm trong clashItems nên tự giải phóng
            found.forEach(item => item.mesh.geometry.dispose());
            clearClashGeometry();
            clashModeActive.value = false;
            refreshBatchMaterials();
            applyModelOpacityToScene();
            applyClashDisplayMode();
            requestRender();
            showToast(t('Đã hủy kiểm tra'), t('Tiến trình kiểm tra clash đã được hủy.'));
            return;
        }

        buildMergedClashDisplay(found, candidates);

        // Xếp cặp có thể tích giao lớn nhất lên đầu danh sách.
        found.sort((a, b) => b.volume - a.volume);
        clashItems.value = found;
        clashCount.value = found.length;
        // Tổng thể tích giao theo từng cặp cấu kiện (có thể đếm trùng nếu nhiều cấu kiện cùng giao một vùng).
        clashVolume.value = found.reduce((sum, item) => sum + item.volume, 0);
        clearSelection();
        clashModeActive.value = true;
        clashResultsReady.value = true;
        refreshBatchMaterials();
        applyModelOpacityToScene();
        applyClashDisplayMode();
        requestRender();
        showToast(t('Hoàn tất kiểm tra Clash'), t('Phát hiện {0} cặp có vùng giao nhau.', [found.length]), 'success');
    } catch (error) {
        console.error('Clash check failed:', error);
        clashError.value = error?.message || t('Không thể hoàn tất kiểm tra clash.');
        clearClashGeometry();
        clashModeActive.value = false;
        refreshBatchMaterials();
        applyModelOpacityToScene();
        applyClashDisplayMode();
        showToast(t('Lỗi kiểm tra Clash'), clashError.value);
    } finally {
        clashBusy.value = false;
        clashProgress.value = 0;
        rt.clashCancelRequested = false;
    }
};
export const onClashButtonClick = () => {
    if (clashBusy.value) {
        rt.clashCancelRequested = true;
        return;
    }
    runClashCheck();
};
