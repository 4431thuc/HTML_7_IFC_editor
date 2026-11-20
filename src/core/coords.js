// HỆ TỌA ĐỘ (quan trọng, áp dụng cho mọi dữ kiện tọa độ hiển thị/nhập):
//  - Hệ xây dựng/IFC của dự án: X sang phải, Y đi vào trong (khi nhìn Front), Z hướng lên trời (hệ phải).
//  - Scene Three.js (web-ifc xuất hình học theo kiểu Y-up): three = (X, Z, -Y)  <=>  IFC = (x, -z, y).
//    Đã kiểm chứng bằng web-ifc: cấu kiện đặt tại IFC (10, 20, 30) cho flatTransformation = (10, 30, -20).
//  - Đơn vị là mét (web-ifc đã quy đổi theo đơn vị chiều dài của file).
//  - Tọa độ trong scene (world) = tọa độ tuyệt đối three - modelRebaseOrigin + modelOffset, rồi nhân ma trận transport.
//    Vì vậy tọa độ dự án = world - modelOffset + modelRebaseOrigin (đã bao gồm transport), chuyển trục về IFC.
import * as THREE from 'three';
import { rt } from '../state/state.js';

// Vector trong hệ IFC (X, Y, Z-up) -> vector trong scene Three.js (không dịch gốc, dùng cho cả hướng)
export const ifcToThree = (x, y, z) => new THREE.Vector3(x, z, -y);
// Vector trong scene Three.js -> hệ IFC (X, Y, Z-up)
export const threeToIfc = (vector) => new THREE.Vector3(vector.x, -vector.z, vector.y);

// Gốc dịch từ world về tọa độ tuyệt đối three của dự án: abs = world - (modelOffset - modelRebaseOrigin)
export const getWorldToProjectShift = () => {
    const shift = rt.modelOffset.clone();
    if (rt.modelRebaseOrigin) shift.sub(rt.modelRebaseOrigin);
    return shift;
};

// Điểm world (scene) -> tọa độ dự án (m) theo hệ xây dựng X, Y, Z-up
export const worldToProjectCoords = (point) => threeToIfc(point.clone().sub(getWorldToProjectShift()));
