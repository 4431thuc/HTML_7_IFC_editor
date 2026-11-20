// Tọa độ hiển thị trong panel thuộc tính / thông tin dự án: hệ xây dựng X, Y, Z-up, mét, tọa độ dự án
// (xem src/core/coords.js). coordVersion tăng khi model đổi vị trí để giao diện tự tính lại.
import * as THREE from 'three';
import { threeToIfc, getWorldToProjectShift } from '../core/coords.js';
import { getObjectMeshes } from '../core/helpers.js';
import { coordVersion, rt, selectedMeshes } from '../state/state.js';

// Bộ nhớ đệm theo (khóa, phiên bản tọa độ, số cấu kiện) để template tính lại nhiều lần không phải duyệt cả model
const cache = new Map();
const memo = (key, compute) => {
    const signature = `${coordVersion.value}:${rt.modelGroup?.children.length ?? 0}`;
    const hit = cache.get(key);
    if (hit && hit.signature === signature) return hit.value;
    const value = compute();
    cache.set(key, { signature, value });
    return value;
};

const format = (vector) => [vector.x, vector.y, vector.z].map(value => value.toFixed(3));

// Box world (scene) -> { min, max, center } theo tọa độ dự án
const boxToProjectCoords = (box) => {
    if (box.isEmpty()) return null;
    const shift = getWorldToProjectShift();
    const projected = new THREE.Box3();
    [box.min.x, box.max.x].forEach(x => [box.min.y, box.max.y].forEach(y => [box.min.z, box.max.z].forEach(z => {
        projected.expandByPoint(threeToIfc(new THREE.Vector3(x, y, z).sub(shift)));
    })));
    return { min: format(projected.min), max: format(projected.max), center: format(projected.getCenter(new THREE.Vector3())) };
};

const unionBox = (meshes) => {
    const box = new THREE.Box3();
    meshes.forEach(mesh => box.union(new THREE.Box3().setFromObject(mesh)));
    return box;
};

// Tọa độ của cấu kiện đang chọn (cấu kiện chọn sau cùng)
// Tham số version chỉ để template phụ thuộc coordVersion
export const getSelectedCoords = (version) => {
    const mesh = selectedMeshes.value[selectedMeshes.value.length - 1];
    return mesh ? memo(`sel:${mesh.uuid}`, () => boxToProjectCoords(unionBox(getObjectMeshes(mesh)))) : null;
};

// Tọa độ bao của toàn bộ cấu kiện thuộc một file IFC
export const getSourceCoords = (sourceId, version) => {
    if (!sourceId || !rt.modelGroup) return null;
    return memo(`src:${sourceId}`, () => boxToProjectCoords(unionBox(rt.modelGroup.children.filter(mesh => mesh.isMesh && mesh.userData.sourceId === sourceId))));
};
