import * as WebIFC from 'web-ifc';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyClashDisplayMode, updateClashAnnotationCamera } from '../clash/clash.js';
import { requestRender } from '../core/helpers.js';
import { initDimensionMarkers, updateDimensionScales } from '../dimension/dimension.js';
import { init6FaceCropBox, updateCropHandleScales } from './cropbox.js';
import { rebuildBatches, syncBatchVisibility } from './rendering.js';
import { createSampleRebarModel } from './sample-model.js';
import { onCanvasWheel, onPointerDown, onPointerLeave, onPointerMove, onPointerUp } from '../selection/input.js';
import { CLASH_GHOST_LAYER, clashGhostDepthMaterial, clippingPlanes, IDLE_RENDER_INTERVAL_MS, axisGizmoAxes, backgroundThemeStorageKey, axisGizmoBackward, axisGizmoRight, axisGizmoUp, batchGroup, canvasContainer, clashAnnotationGroup, clashContextGroup, clashGroup, clashPairGroup, clashSelectionGroup, cropGroup, dimGroup, edgesGroup, isCropBoxActive, isLightBackground, isOrthographic, lightExposure, lightPreset, overlayGroup, rt, selectedMeshes, viewCubeEl, wasmReady } from '../state/state.js';
import { VIEW_CUBE_BOX_PX, VIEW_CUBE_SIZE_PX } from '../state/constants.js';
import { applyModelOpacityToScene, showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';

// --- 1. KHỞI TẠO WEB-IFC 0.0.66 ---
export const initWebIFC = async () => {
    try {
        rt.ifcAPI = new WebIFC.IfcAPI();
        rt.ifcAPI.SetWasmPath('https://cdn.jsdelivr.net/npm/web-ifc@0.0.66/');
        await rt.ifcAPI.Init();
        wasmReady.value = true;
    } catch (err) {
        console.error('Lỗi khởi tạo Web-IFC 0.0.66:', err);
        showToast(t('Lỗi nạp thư viện'), t('Không thể nạp thư viện WASM từ CDN.'));
    }
};

// Đổi kích thước khối cubic sang đơn vị viewBox (0..100) của SVG trục tọa độ
const VIEW_CUBE_HALF_UNITS = (VIEW_CUBE_SIZE_PX / 2) / (VIEW_CUBE_BOX_PX / 100);
const VIEW_CUBE_AXIS_LENGTH = VIEW_CUBE_HALF_UNITS * 2 + 9;

export const updateAxisGizmo = () => {
    if (!rt.camera) return;
    rt.camera.updateMatrixWorld(true);
    axisGizmoRight.setFromMatrixColumn(rt.camera.matrixWorld, 0).normalize();
    axisGizmoUp.setFromMatrixColumn(rt.camera.matrixWorld, 1).normalize();
    axisGizmoBackward.setFromMatrixColumn(rt.camera.matrixWorld, 2).normalize();

    // Xoay khối cubic theo đúng hướng camera (CSS 3D, trục cục bộ: X, -Y, Z của Three.js)
    const cube = viewCubeEl.value;
    if (cube) {
        const r = axisGizmoRight;
        const u = axisGizmoUp;
        const b = axisGizmoBackward;
        cube.style.transform = `matrix3d(${r.x},${-u.x},${b.x},0,${-r.y},${u.y},${-b.y},0,${r.z},${-u.z},${b.z},0,0,0,0,1)`;
    }

    // Gốc các trục đặt tại góc khối cubic mà cả 3 trục X, Y, Z (hệ xây dựng) chạy dọc theo cạnh rồi nhô ra ngoài.
    // Trục Y xây dựng = -Z của three nên góc đó là (-x, -y, +z) trong hệ three, không phải góc nhỏ nhất.
    const half = VIEW_CUBE_HALF_UNITS;
    const corner = new THREE.Vector3(-1, -1, 1);
    const originX = 50 + half * corner.dot(axisGizmoRight);
    const originY = 50 - half * corner.dot(axisGizmoUp);

    axisGizmoAxes.forEach(({ direction, line: lineRef, label: labelRef, point: pointRef }) => {
        const line = lineRef.value;
        const label = labelRef.value;
        const point = pointRef.value;
        if (!line || !label || !point) return;
        const screenX = direction.dot(axisGizmoRight);
        const screenY = -direction.dot(axisGizmoUp);
        const projectedLength = Math.hypot(screenX, screenY);
        const facingCamera = direction.dot(axisGizmoBackward) >= 0;
        const opacity = facingCamera ? '1' : '0.5';

        line.setAttribute('opacity', opacity);
        label.setAttribute('opacity', opacity);
        point.setAttribute('opacity', opacity);
        line.setAttribute('x1', String(originX));
        line.setAttribute('y1', String(originY));
        point.setAttribute('cx', String(originX));
        point.setAttribute('cy', String(originY));
        if (projectedLength < 0.08) {
            line.setAttribute('visibility', 'hidden');
            point.setAttribute('visibility', 'visible');
            label.setAttribute('x', String(originX + (facingCamera ? 9 : -9)));
            label.setAttribute('y', String(originY - 8));
            return;
        }

        const tipX = originX + screenX * VIEW_CUBE_AXIS_LENGTH;
        const tipY = originY + screenY * VIEW_CUBE_AXIS_LENGTH;
        line.setAttribute('visibility', 'visible');
        line.setAttribute('x2', String(tipX));
        line.setAttribute('y2', String(tipY));
        point.setAttribute('visibility', 'hidden');
        label.setAttribute('x', String(tipX + (screenX / projectedLength) * 7));
        label.setAttribute('y', String(tipY + (screenY / projectedLength) * 7));
    });
};

// OrbitControls luôn xoay quanh controls.target và tự gọi update() ngay trong sự kiện chuột. Khi click trúng mesh
// (rt.orbitPivot), mỗi lần camera đổi hướng ta bù thêm một phép tịnh tiến để việc xoay tương đương xoay quanh điểm đó:
// điểm đó đứng yên trên màn hình, view không bị giật.
const pivotPreviousQuaternion = new THREE.Quaternion();
const pivotRotation = new THREE.Quaternion();
const pivotOffset = new THREE.Vector3();
export const resetOrbitPivotTracking = () => pivotPreviousQuaternion.copy(rt.camera.quaternion);
const compensateOrbitAroundPivot = () => {
    const pivot = rt.orbitPivot;
    if (pivot) {
        // R: phép quay camera vừa được áp dụng quanh target
        pivotRotation.copy(rt.camera.quaternion).multiply(pivotPreviousQuaternion.clone().invert());
        pivotOffset.copy(pivot).sub(rt.controls.target);
        pivotOffset.sub(pivotOffset.clone().applyQuaternion(pivotRotation));
        if (pivotOffset.lengthSq() >= 1e-14) {
            rt.camera.position.add(pivotOffset);
            rt.controls.target.add(pivotOffset);
        }
    }
    pivotPreviousQuaternion.copy(rt.camera.quaternion);
};

// --- 2. KHỞI TẠO THREE.JS (NỀN SÁNG, PERSPECTIVE/ORTHOGRAPHIC & CROPBOX ĐỘC LẬP 6 MẶT) ---
export const initThreeJS = () => {
    const container = canvasContainer.value;
    if (!container) return;

    rt.scene = new THREE.Scene();
    // NỀN SÁNG CHUẨN KỸ THUẬT KIẾN TRÚC BIM (Slate 100: 0xf1f5f9)
    rt.scene.background = new THREE.Color(0xf1f5f9);

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === rt.lastCanvasWidth && height === rt.lastCanvasHeight) return;
    rt.lastCanvasWidth = width;
    rt.lastCanvasHeight = height;
    const aspect = width / height;

    // 1. Phối cảnh Perspective Camera
    rt.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.01, 5000);
    rt.perspCamera.position.set(12, 12, 12);

    // 2. Hình chiếu trực giao Orthographic Camera
    const orthoSize = 10;
    rt.orthoCamera = new THREE.OrthographicCamera(
        -orthoSize * aspect, orthoSize * aspect,
        orthoSize, -orthoSize,
        0.01, 5000
    );
    rt.orthoCamera.position.set(12, 12, 12);

    rt.camera = rt.perspCamera;
    rt.activeCamera = rt.perspCamera;

    // Renderer với tối ưu hóa hiệu năng cao
    rt.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    rt.renderer.setSize(width, height);
    // Giới hạn pixelRatio = 1.5 để tránh quá tải GPU khi mô hình nặng trên 5000 mesh
    rt.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    rt.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    rt.renderer.toneMappingExposure = lightExposure.value;
    rt.renderer.localClippingEnabled = true;
    // TẮT ĐỔ BÓNG THỜI GIAN THỰC ĐỂ RENDER SIÊU MƯỢT (CHỐNG LAGG CHO FILE LỚN 30MB)
    rt.renderer.shadowMap.enabled = false;
    container.appendChild(rt.renderer.domElement);

    // OrbitControls: TẮT TRÔI CAMERA KHI THẢ CHUỘT & PAN BẰNG CHUỘT GIỮA
    rt.controls = new OrbitControls(rt.camera, rt.renderer.domElement);
    rt.controls.enableDamping = false;
    rt.controls.screenSpacePanning = true;
    rt.controls.minDistance = 0.05;
    rt.controls.maxDistance = 5000;
    rt.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN
    };

    // Ánh sáng kiến trúc sáng rõ, tự nhiên
    rt.ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    rt.scene.add(rt.ambientLight);

    rt.hemiLight = new THREE.HemisphereLight(0xffffff, 0x94a3b8, 0.85);
    rt.hemiLight.position.set(0, 50, 0);
    rt.scene.add(rt.hemiLight);

    rt.dirLight1 = new THREE.DirectionalLight(0xffffff, 1.25);
    rt.dirLight1.position.set(30, 60, 40);
    rt.scene.add(rt.dirLight1);

    rt.dirLight2 = new THREE.DirectionalLight(0xe2e8f0, 0.7);
    rt.dirLight2.position.set(-30, 20, -40);
    rt.scene.add(rt.dirLight2);

    rt.gridHelper = new THREE.GridHelper(30, 30, 0x94a3b8, 0xcfd8dc);
    rt.scene.add(rt.gridHelper);
    rt.gridHelper.layers.enable(CLASH_GHOST_LAYER); // lưới vẽ cùng lớp mờ, không đè lên mô hình khi xem va chạm
    // Đèn phải cùng layer với camera thì lượt vẽ lớp mờ của view va chạm (renderClashView) mới có ánh sáng
    [rt.ambientLight, rt.hemiLight, rt.dirLight1, rt.dirLight2].forEach(light => light.layers.enable(CLASH_GHOST_LAYER));
    // Áp màu nền đã lưu trong trình duyệt (mặc định nền sáng)
    setBackgroundTheme(isLightBackground.value);

    rt.scene.add(rt.transportGroup);
    rt.transportGroup.add(rt.modelGroup);
    rt.modelGroup.add(edgesGroup);
    rt.modelGroup.add(batchGroup);
    rt.modelGroup.add(overlayGroup);
    cropGroup.renderOrder = 10000;
    rt.scene.add(cropGroup);
    rt.scene.add(clashGroup);
    rt.scene.add(clashContextGroup);
    rt.scene.add(clashSelectionGroup);
    rt.scene.add(clashAnnotationGroup);
    rt.scene.add(clashPairGroup);
    rt.scene.add(dimGroup);
    initDimensionMarkers();

    // Khởi tạo CropBox 6 mặt độc lập kèm 6 mũi tên
    init6FaceCropBox();

    createSampleRebarModel();
    rebuildBatches();
    applyClashDisplayMode();
    applyModelOpacityToScene();

    const domElem = rt.renderer.domElement;
    domElem.addEventListener('pointerdown', onPointerDown, true);
    domElem.addEventListener('pointerup', onPointerUp);
    domElem.addEventListener('pointercancel', onPointerUp);
    domElem.addEventListener('pointermove', onPointerMove);
    domElem.addEventListener('pointerleave', onPointerLeave);
    domElem.addEventListener('wheel', onCanvasWheel, { passive: true });    rt.controls.addEventListener('change', requestRender);
    rt.controls.addEventListener('change', compensateOrbitAroundPivot);
    window.addEventListener('resize', onWindowResize);

    // Render theo nhu cầu: chỉ vẽ khi camera/tương tác có thay đổi, còn lại refresh nền mỗi 200ms
    const animate = () => {
        rt.animationFrameId = requestAnimationFrame(animate);
        rt.controls.update();
        const now = performance.now();
        if (!rt.needsRender && now - rt.lastRenderTime < IDLE_RENDER_INTERVAL_MS) return;
        rt.needsRender = false;
        rt.lastRenderTime = now;
        if (isCropBoxActive.value) updateCropHandleScales();
        if (clashAnnotationGroup.visible) updateClashAnnotationCamera();
        if (dimGroup.visible) updateDimensionScales();
        updateAxisGizmo();
        syncBatchVisibility();
        if (clashContextGroup.visible) renderClashView();
        else rt.renderer.render(rt.scene, rt.camera);
    };
    animate();
};

// View va chạm:
//  1. Lớp mờ (mô hình nền + cấu kiện có va chạm, layer CLASH_GHOST_LAYER): ghi độ sâu trước, rồi tô màu với
//     depthTest mặc định (LessEqual) -> mỗi điểm ảnh chỉ tô đúng bề mặt gần nhất một lần, không cộng dồn.
//  2. Xóa độ sâu, vẽ phần còn lại (khối va chạm, đối tượng A/B, chấm, nhãn...) đè lên trên lớp mờ,
//     nên khối va chạm nằm trong lồng thép vẫn luôn nhìn thấy.
const renderClashView = () => {
    const renderer = rt.renderer;
    const camera = rt.camera;
    const cameraMask = camera.layers.mask;
    const autoClear = renderer.autoClear;
    batchGroup.children.forEach(batch => batch.layers.set(CLASH_GHOST_LAYER));
    camera.layers.set(CLASH_GHOST_LAYER);
    clashGhostDepthMaterial.clippingPlanes = isCropBoxActive.value ? clippingPlanes : null;
    rt.scene.overrideMaterial = clashGhostDepthMaterial;
    renderer.render(rt.scene, camera);
    rt.scene.overrideMaterial = null;
    renderer.autoClear = false;
    renderer.render(rt.scene, camera);
    renderer.clearDepth();
    camera.layers.mask = cameraMask;
    // Lưới đã vẽ ở lượt lớp mờ (bị mô hình che đúng chỗ), không vẽ lại đè lên trên
    const gridVisible = rt.gridHelper?.visible;
    if (rt.gridHelper) rt.gridHelper.visible = false;
    renderer.render(rt.scene, camera);
    if (rt.gridHelper) rt.gridHelper.visible = gridVisible;
    renderer.autoClear = autoClear;
    batchGroup.children.forEach(batch => batch.layers.set(0));
};

// THIẾT LẬP MÀU NỀN VIEW 3D: SÁNG (LIGHT) HOẶC TỐI (DARK)
export const setBackgroundTheme = (light) => {
    isLightBackground.value = light;
    try {
        localStorage.setItem(backgroundThemeStorageKey, String(light));
    } catch (error) {
        console.error('Không thể lưu cài đặt màu nền:', error);
    }
    if (!rt.scene) return;

    if (light) {
        rt.scene.background = new THREE.Color(0xf1f5f9); // Nền sáng slate 100
        if (rt.gridHelper) {
            rt.scene.remove(rt.gridHelper);
            rt.gridHelper = new THREE.GridHelper(30, 30, 0x94a3b8, 0xcfd8dc);
            rt.scene.add(rt.gridHelper);
            rt.gridHelper.layers.enable(CLASH_GHOST_LAYER); // lưới vẽ cùng lớp mờ, không đè lên mô hình khi xem va chạm
        }
    } else {
        rt.scene.background = new THREE.Color(0x0f172a); // Nền tối slate 900
        if (rt.gridHelper) {
            rt.scene.remove(rt.gridHelper);
            rt.gridHelper = new THREE.GridHelper(30, 30, 0x334155, 0x1e293b);
            rt.scene.add(rt.gridHelper);
            rt.gridHelper.layers.enable(CLASH_GHOST_LAYER); // lưới vẽ cùng lớp mờ, không đè lên mô hình khi xem va chạm
        }
    }
};

// CHUYỂN ĐỔI CHẾ ĐỘ CAMERA PERSPECTIVE <-> ORTHOGRAPHIC
export const toggleCameraProjection = () => {
    isOrthographic.value = !isOrthographic.value;
    const container = canvasContainer.value;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;

    if (isOrthographic.value) {
        // Chuyển sang Orthographic
        const currentDist = rt.camera.position.distanceTo(rt.controls.target);
        const orthoHeight = currentDist * Math.tan((rt.perspCamera.fov * Math.PI) / 360) / rt.perspCamera.zoom;
        
        rt.orthoCamera.left = -orthoHeight * aspect;
        rt.orthoCamera.right = orthoHeight * aspect;
        rt.orthoCamera.top = orthoHeight;
        rt.orthoCamera.bottom = -orthoHeight;
        rt.orthoCamera.zoom = 1;
        rt.orthoCamera.position.copy(rt.perspCamera.position);
        rt.orthoCamera.quaternion.copy(rt.perspCamera.quaternion);
        rt.orthoCamera.updateProjectionMatrix();

        rt.camera = rt.orthoCamera;
        rt.activeCamera = rt.orthoCamera;
    } else {
        // Chuyển sang Perspective
        const direction = rt.orthoCamera.position.clone().sub(rt.controls.target).normalize();
        const visibleHalfHeight = (rt.orthoCamera.top - rt.orthoCamera.bottom) / (2 * rt.orthoCamera.zoom);
        const distance = visibleHalfHeight * rt.perspCamera.zoom / Math.tan((rt.perspCamera.fov * Math.PI) / 360);
        rt.perspCamera.position.copy(rt.controls.target).addScaledVector(direction, distance);
        rt.perspCamera.quaternion.copy(rt.orthoCamera.quaternion);
        rt.perspCamera.updateProjectionMatrix();

        rt.camera = rt.perspCamera;
        rt.activeCamera = rt.perspCamera;
    }

    rt.controls.object = rt.camera;
    rt.controls.update();
    // showToast('Chế độ Camera', isOrthographic.value ? 'Đã đổi sang Orthographic (Hình chiếu trục đo)' : 'Đã đổi sang Perspective (Phối cảnh)', 'success');
};

export const setViewDirection = (direction) => {
    const directions = {
        top: [0, 1, 0],
        bottom: [0, -1, 0],
        front: [0, 0, 1],
        back: [0, 0, -1],
        left: [-1, 0, 0],
        right: [1, 0, 0]
    };
    // Nhận tên hướng ('top'...) hoặc vector [x, y, z] (cạnh/góc của khối cubic)
    const viewVector = new THREE.Vector3(...(Array.isArray(direction) ? direction : directions[direction])).normalize();
    const distance = Math.max(rt.camera.position.distanceTo(rt.controls.target), 0.1);
    rt.camera.position.copy(rt.controls.target).addScaledVector(viewVector, distance);
    rt.controls.update();
};

// THIẾT LẬP GÓC ĐỔ SÁNG
export const setLightAngle = (preset) => {
    lightPreset.value = preset;
    if (!rt.dirLight1) return;

    if (preset === 'morning') {
        rt.dirLight1.position.set(50, 40, 20);
        rt.dirLight2.position.set(-40, 20, -30);
    } else if (preset === 'noon') {
        rt.dirLight1.position.set(10, 80, 15);
        rt.dirLight2.position.set(-20, 10, -20);
    } else if (preset === 'isometric') {
        rt.dirLight1.position.set(35, 50, 35);
        rt.dirLight2.position.set(-35, 20, -35);
    }
};

export const updateLighting = () => {
    if (rt.renderer) rt.renderer.toneMappingExposure = lightExposure.value;
};


export const fitCameraToTarget = () => {
    if (selectedMeshes.value.length > 0) {
        fitCameraToSelectedObjects();
    } else {
        fitCameraToModel();
    }
};

export const fitCameraToSelectedObjects = () => {
    fitCameraToMeshes(selectedMeshes.value);
};

// Zoom toàn bộ cấu kiện đang hiển thị (không tính cấu kiện bị ẩn/đã xóa), giữ nguyên hướng nhìn hiện tại
export const fitCameraToVisibleModel = () => {
    fitCameraToMeshes(rt.modelGroup.children.filter(mesh => mesh.isMesh && mesh.visible));
};

const fitCameraToMeshes = (meshes) => {
    if (meshes.length === 0) return;

    const box = new THREE.Box3();
    meshes.forEach(mesh => box.expandByObject(mesh));
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.4);

    if (isOrthographic.value) {
        // Căn chỉnh Orthographic Camera
        const aspect = rt.renderer.domElement.clientWidth / rt.renderer.domElement.clientHeight;
        const orthoHeight = maxDim * 0.9 / Math.min(aspect, 1);
        rt.orthoCamera.left = -orthoHeight * aspect;
        rt.orthoCamera.right = orthoHeight * aspect;
        rt.orthoCamera.top = orthoHeight;
        rt.orthoCamera.bottom = -orthoHeight;
        rt.orthoCamera.zoom = 1;
        rt.orthoCamera.far = Math.max(maxDim * 10, 2000);
        rt.orthoCamera.updateProjectionMatrix();

        const dir = rt.camera.position.clone().sub(rt.controls.target).normalize();
        rt.orthoCamera.position.copy(center.clone().add(dir.multiplyScalar(Math.max(maxDim * 2, 20))));
        rt.controls.target.copy(center);
        rt.controls.update();
    } else {
        const fov = rt.camera.fov * (Math.PI / 180);
        const aspect = rt.renderer.domElement.clientWidth / rt.renderer.domElement.clientHeight;
        let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.6 / Math.min(aspect, 1);

        const dir = rt.camera.position.clone().sub(rt.controls.target).normalize();
        if (dir.lengthSq() < 0.001) dir.set(1, 0.8, 1).normalize();

        const newPos = center.clone().add(dir.multiplyScalar(Math.max(cameraDistance, 1.2)));

        rt.camera.position.copy(newPos);
        rt.camera.near = Math.max(maxDim / 1000, 0.01);
        rt.camera.far = Math.max(maxDim * 40, 2000);
        rt.camera.updateProjectionMatrix();

        rt.controls.target.copy(center);
        rt.controls.update();
    }

    // showToast('Zoom chọn', `Đã căn giữa ${selectedMeshes.value.length} đối tượng đang chọn.`, 'success');
};

export const fitCameraToModel = () => {
    if (rt.modelGroup.children.length === 0) return;
    const box = new THREE.Box3().setFromObject(rt.modelGroup);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (isOrthographic.value) {
        const aspect = rt.renderer.domElement.clientWidth / rt.renderer.domElement.clientHeight;
        const orthoHeight = maxDim * 0.75;
        rt.orthoCamera.left = -orthoHeight * aspect;
        rt.orthoCamera.right = orthoHeight * aspect;
        rt.orthoCamera.top = orthoHeight;
        rt.orthoCamera.bottom = -orthoHeight;
        rt.orthoCamera.updateProjectionMatrix();

        const dir = rt.camera.position.clone().sub(rt.controls.target).normalize();
        rt.orthoCamera.position.copy(center.clone().add(dir.multiplyScalar(50)));
        rt.controls.target.copy(center);
        rt.controls.update();
    } else {
        const fov = rt.camera.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.4;

        const direction = new THREE.Vector3(1, 0.7, 1).normalize();
        const newPos = center.clone().add(direction.multiplyScalar(Math.max(cameraDistance, 2.5)));

        rt.camera.position.copy(newPos);
        rt.camera.near = Math.max(maxDim / 1500, 0.01);
        rt.camera.far = Math.max(maxDim * 30, 2000);
        rt.camera.updateProjectionMatrix();

        rt.controls.target.copy(center);
        rt.controls.update();
    }

    if (rt.gridHelper) rt.gridHelper.position.set(center.x, box.min.y, center.z);
};

export const onWindowResize = () => {
    requestRender();
    const container = canvasContainer.value;
    if (!container || !rt.renderer) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;

    if (rt.perspCamera) {
        rt.perspCamera.aspect = aspect;
        rt.perspCamera.updateProjectionMatrix();
    }

    if (rt.orthoCamera) {
        const orthoHeight = (rt.orthoCamera.top - rt.orthoCamera.bottom) / 2;
        rt.orthoCamera.left = -orthoHeight * aspect;
        rt.orthoCamera.right = orthoHeight * aspect;
        rt.orthoCamera.updateProjectionMatrix();
    }

    rt.renderer.setSize(width, height);
};
