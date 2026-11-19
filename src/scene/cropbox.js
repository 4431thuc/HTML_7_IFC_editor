import * as THREE from 'three';
import { updateEdgesVisibility } from '../ifc/groups.js';
import { updateMouseCoords } from '../selection/input.js';
import { clippingPlanes, cropBounds, cropGroup, edgeCropUniforms, handleMeshes, isCropBoxActive, mouse, raycaster, rt, selectedMeshes, showOutsideCropEdges } from '../state/state.js';

// --- 2.2 KHỞI TẠO CROPBOX 6 MẶT MŨI TÊN ĐỘC LẬP (CUSTOM DRAG – TẤT CẢ 6 MŨI TÊN ACTIVE CÙNG LÚC) ---
export const init6FaceCropBox = () => {
    // Khung viền dạng hộp bao CropBox
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxMat = new THREE.MeshBasicMaterial({
        color: 0x0284c7,
        wireframe: true,
        transparent: true,
        opacity: 0.6
    });
    rt.cropBoxWireframe = new THREE.Mesh(boxGeo, boxMat);
    cropGroup.add(rt.cropBoxWireframe);

    // Dữ liệu định hướng của 6 mặt: [+X, -X, +Y, -Y, +Z, -Z]
    const faces = [
        { name: 'face_posX', normal: new THREE.Vector3( 1,  0,  0), color: 0xef4444, axis: 'X', isMin: false },
        { name: 'face_negX', normal: new THREE.Vector3(-1,  0,  0), color: 0xef4444, axis: 'X', isMin: true  },
        { name: 'face_posY', normal: new THREE.Vector3( 0,  1,  0), color: 0x10b981, axis: 'Y', isMin: false },
        { name: 'face_negY', normal: new THREE.Vector3( 0, -1,  0), color: 0x10b981, axis: 'Y', isMin: true  },
        { name: 'face_posZ', normal: new THREE.Vector3( 0,  0,  1), color: 0x3b82f6, axis: 'Z', isMin: false },
        { name: 'face_negZ', normal: new THREE.Vector3( 0,  0, -1), color: 0x3b82f6, axis: 'Z', isMin: true  }
    ];

    faces.forEach((f, idx) => {
        const handleObj = new THREE.Group();
        handleObj.name = f.name;

        // Mũi tên chỉ ra hướng ngoài của từng mặt
        const arrowHelper = new THREE.ArrowHelper(
            f.normal,
            new THREE.Vector3(0, 0, 0),
            0.9,
            f.color,
            0.4,
            0.22
        );
        arrowHelper.frustumCulled = false;
        arrowHelper.line.frustumCulled = false;
        arrowHelper.cone.frustumCulled = false;
        arrowHelper.line.material.depthTest = false;
        arrowHelper.cone.material.depthTest = false;
        arrowHelper.line.material.depthWrite = false;
        arrowHelper.cone.material.depthWrite = false;
        arrowHelper.line.renderOrder = 10000;
        arrowHelper.cone.renderOrder = 10000;
        // Viền đầu mũi tên luôn nằm trên mô hình, kể cả khi mô hình đang ở chế độ X-Ray.
        const arrowOutline = new THREE.LineSegments(
            new THREE.EdgesGeometry(arrowHelper.cone.geometry, 20),
            new THREE.LineBasicMaterial({
                color: f.color,
                depthTest: false,
                depthWrite: false,
                transparent: false
            })
        );
        arrowOutline.renderOrder = 10001;
        arrowOutline.position.copy(arrowHelper.cone.position);
        arrowOutline.quaternion.copy(arrowHelper.cone.quaternion);
        arrowOutline.scale.copy(arrowHelper.cone.scale);
        arrowHelper.add(arrowOutline);
        handleObj.add(arrowHelper);

        // Vùng tương tác nhỏ hơn thân mũi tên để tránh chiếm vùng xoay view.
        const hitGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.225, 8, 1, false);
        const hitMat = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false
        });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f.normal);
        hitMesh.position.copy(f.normal).multiplyScalar(0.1125);
        hitMesh.renderOrder = 1001;
        handleObj.add(hitMesh);

        handleObj.userData = {
            faceIdx: idx,
            axis: f.axis,
            isMin: f.isMin,
            normal: f.normal.clone(),
            arrowColor: f.color,
            arrowHelper,
            arrowOutline
        };

        cropGroup.add(handleObj);
        handleMeshes.push(handleObj);
    });

    cropGroup.visible = false;
};

export const clearCropHandleHover = () => {
    if (!rt.hoveredCropHandle) return;
    const arrow = rt.hoveredCropHandle.userData.arrowHelper;
    arrow.line.material.color.setHex(rt.hoveredCropHandle.userData.arrowColor);
    arrow.cone.material.color.setHex(rt.hoveredCropHandle.userData.arrowColor);
    rt.hoveredCropHandle.userData.arrowOutline.material.color.setHex(rt.hoveredCropHandle.userData.arrowColor);
    arrow.scale.setScalar(1);
    rt.hoveredCropHandle = null;
};

export const updateCropHandleHover = (event) => {
    if (!isCropBoxActive.value) {
        clearCropHandleHover();
        return null;
    }
    updateCropHandleScales();
    cropGroup.updateMatrixWorld(true);
    updateMouseCoords(event);
    raycaster.setFromCamera(mouse, rt.camera);
    const intersects = raycaster.intersectObjects(handleMeshes, true);
    let handle = null;
    if (intersects.length > 0) {
        handle = intersects[0].object;
        while (handle.parent && !handleMeshes.includes(handle)) handle = handle.parent;
        if (!handleMeshes.includes(handle)) handle = null;
    }
    if (handle === rt.hoveredCropHandle) return handle;
    clearCropHandleHover();
    if (handle) {
        rt.hoveredCropHandle = handle;
        const arrow = handle.userData.arrowHelper;
        arrow.line.material.color.setHex(0xf8fafc);
        arrow.cone.material.color.setHex(0xf8fafc);
        handle.userData.arrowOutline.material.color.setHex(0xf8fafc);
        arrow.scale.setScalar(1.2);
    }
    return handle;
};

// ĐỒNG BỘ KHUNG VIỀN CROPBOX VÀ VỊ TRÍ 6 TAY CẦM MŨI TÊN NẰM CHÍNH GIỮA 6 MẶT BỀ MẶT
export const syncCropBoxGeometryAndPlanes = () => {
    const { minX, maxX, minY, maxY, minZ, maxZ } = cropBounds;

    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // 1. Cập nhật khung wireframe CropBox
    if (rt.cropBoxWireframe) {
        rt.cropBoxWireframe.position.set(centerX, centerY, centerZ);
        rt.cropBoxWireframe.scale.set(sizeX, sizeY, sizeZ);
    }

    // 2. Định vị 6 mũi tên luôn nằm chính xác ở tâm từng bề mặt của Box
    handleMeshes[0].position.set(maxX, centerY, centerZ); // Mặt phải (+X)
    handleMeshes[1].position.set(minX, centerY, centerZ); // Mặt trái (-X)
    handleMeshes[2].position.set(centerX, maxY, centerZ); // Mặt trên (+Y)
    handleMeshes[3].position.set(centerX, minY, centerZ); // Mặt dưới (-Y)
    handleMeshes[4].position.set(centerX, centerY, maxZ); // Mặt trước (+Z)
    handleMeshes[5].position.set(centerX, centerY, minZ); // Mặt sau (-Z)

    // 3. Cập nhật hằng số phương trình của 6 mặt phẳng cắt (Ax + By + Cz + D = 0)
    clippingPlanes[0].constant = maxX;   // normal (-1, 0, 0): -x + maxX >= 0 => x <= maxX
    clippingPlanes[1].constant = -minX;  // normal ( 1, 0, 0):  x - minX >= 0 => x >= minX
    clippingPlanes[2].constant = maxY;   // normal ( 0,-1, 0): -y + maxY >= 0 => y <= maxY
    clippingPlanes[3].constant = -minY;  // normal ( 0, 1, 0):  y - minY >= 0 => y >= minY
    clippingPlanes[4].constant = maxZ;   // normal ( 0, 0,-1): -z + maxZ >= 0 => z <= maxZ
    clippingPlanes[5].constant = -minZ;  // normal ( 0, 0, 1):  z - minZ >= 0 => z >= minZ
    edgeCropUniforms.cropMin.value.set(minX, minY, minZ);
    edgeCropUniforms.cropMax.value.set(maxX, maxY, maxZ);
    updateCropHandleScales();
};

export const cropHandleWorldUnitsPerPixel = (handle) => {
    const height = rt.renderer.domElement.clientHeight;
    if (!height) return 0;
    if (rt.camera.isOrthographicCamera) {
        return (rt.camera.top - rt.camera.bottom) / (rt.camera.zoom * height);
    }
    const viewPosition = handle.position.clone().applyMatrix4(rt.camera.matrixWorldInverse);
    const depth = Math.max(-viewPosition.z, rt.camera.near);
    return 2 * depth * Math.tan(THREE.MathUtils.degToRad(rt.camera.fov) / 2) / (rt.camera.zoom * height);
};

export const updateCropHandleScales = () => {
    if (!rt.camera || !rt.renderer) return;
    rt.camera.updateMatrixWorld();
    handleMeshes.forEach(handle => {
        handle.scale.setScalar(cropHandleWorldUnitsPerPixel(handle) * 40 / 0.9);
    });
};

// BẬT / TẮT CROPBOX
export const toggleCropBox = () => {
    isCropBoxActive.value = !isCropBoxActive.value;
    edgeCropUniforms.cropActive.value = isCropBoxActive.value;

    if (isCropBoxActive.value) {
        cropGroup.visible = true;

        if (selectedMeshes.value.length > 0) {
            cropToSelectedObjects();
        } else {
            resetCropBoxToModel();
        }

        applyClippingPlanesToMaterials(true);
        syncCropBoxGeometryAndPlanes();
    } else {
        cropGroup.visible = false;
        rt.cropDragHandle = null;
        clearCropHandleHover();
        rt.controls.enabled = true;
        rt.renderer.domElement.style.cursor = 'default';
        applyClippingPlanesToMaterials(false);
        updateEdgesVisibility();
    }
};

export const toggleOutsideCropEdges = () => {
    showOutsideCropEdges.value = !showOutsideCropEdges.value;
    edgeCropUniforms.showOutsideEdges.value = showOutsideCropEdges.value;
};

// CROP QUANH VÙNG NHÓM ĐỐI TƯỢNG ĐANG CHỌN
export const cropToSelectedObjects = () => {
    if (selectedMeshes.value.length === 0) {
        resetCropBoxToModel();
        return;
    }

    const selBox = new THREE.Box3();
    selectedMeshes.value.forEach(mesh => selBox.expandByObject(mesh));
    if (selBox.isEmpty()) return;

    const pad = 0.2;
    cropBounds.minX = selBox.min.x - pad;
    cropBounds.maxX = selBox.max.x + pad;
    cropBounds.minY = selBox.min.y - pad;
    cropBounds.maxY = selBox.max.y + pad;
    cropBounds.minZ = selBox.min.z - pad;
    cropBounds.maxZ = selBox.max.z + pad;

    syncCropBoxGeometryAndPlanes();
    // showToast('CropBox', `Đã cắt ôm sát nhóm ${selectedMeshes.value.length} đối tượng đang chọn.`, 'success');
};

// RESET CROPBOX ÔM TRỌN TOÀN BỘ MÔ HÌNH
export const resetCropBoxToModel = () => {
    const box = new THREE.Box3().setFromObject(rt.modelGroup);
    if (box.isEmpty()) return;

    const pad = 0.3;
    cropBounds.minX = box.min.x - pad;
    cropBounds.maxX = box.max.x + pad;
    cropBounds.minY = box.min.y - pad;
    cropBounds.maxY = box.max.y + pad;
    cropBounds.minZ = box.min.z - pad;
    cropBounds.maxZ = box.max.z + pad;

    syncCropBoxGeometryAndPlanes();
};

export const applyClippingPlanesToMaterials = (enable) => {
    rt.modelGroup.children.forEach(mesh => {
        if (mesh.isMesh && mesh.material) {
            mesh.material.clippingPlanes = enable ? clippingPlanes : null;
            mesh.material.needsUpdate = true;
        }
    });
};
