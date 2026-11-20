import * as THREE from 'three';
import { requestRender } from '../core/helpers.js';
import { edgeMaterial, edgesGroup, isRebarOnly, rt, showEdges } from '../state/state.js';

// Đường giao giữa các cấu kiện (line / polyline / spline) hiển thị như viền mép của model.
// Tính nền theo từng lát thời gian ngắn để không treo giao diện; kết quả nằm trong edgesGroup
// (userData.parentMesh / userData.pairMesh là 2 cấu kiện giao nhau).
const MAX_VERTEX_COUNT = 20000;
const MAX_PAIRS_PER_JOB = 60000;
const SLICE_MS = 8;
const MIN_SEGMENT_LENGTH = 1e-5;

let processedPairs = new WeakMap();
// mesh -> các LineSegments đường giao có liên quan tới mesh đó (dùng cho bắt điểm khi đo)
export let intersectionLinesByMesh = new WeakMap();

const isPairProcessed = (a, b) => processedPairs.get(a)?.has(b) || processedPairs.get(b)?.has(a);
const markPairProcessed = (a, b) => {
    if (!processedPairs.has(a)) processedPairs.set(a, new WeakSet());
    processedPairs.get(a).add(b);
};

// Cấu kiện nạp từ IFC đã có BVH; mô hình mẫu thì chưa nên tạo khi cần
export const ensureBoundsTree = (mesh) => {
    const geometry = mesh.geometry;
    if (!geometry?.attributes?.position) return null;
    if (!geometry.boundsTree && geometry.computeBoundsTree) geometry.computeBoundsTree();
    return geometry.boundsTree ?? null;
};

const registerLine = (mesh, line) => {
    const lines = intersectionLinesByMesh.get(mesh);
    if (lines) lines.push(line);
    else intersectionLinesByMesh.set(mesh, [line]);
};

// Các đoạn giao của 2 cấu kiện, tọa độ trong không gian modelGroup
const computePairSegments = (meshA, meshB) => {
    meshA.updateMatrix();
    meshB.updateMatrix();
    const toLocalA = new THREE.Matrix4().copy(meshA.matrix).invert().multiply(meshB.matrix);
    const segment = new THREE.Line3();
    const point = new THREE.Vector3();
    const values = [];
    meshA.geometry.boundsTree.bvhcast(meshB.geometry.boundsTree, toLocalA, {
        intersectsTriangles: (triangleA, triangleB) => {
            // Tam giác đồng phẳng (tiếp xúc mặt) trả về đoạn rỗng nên tự bị loại
            if (triangleA.intersectsTriangle(triangleB, segment, true) && segment.distance() > MIN_SEGMENT_LENGTH) {
                point.copy(segment.start).applyMatrix4(meshA.matrix);
                values.push(point.x, point.y, point.z);
                point.copy(segment.end).applyMatrix4(meshA.matrix);
                values.push(point.x, point.y, point.z);
            }
            return false;
        }
    });
    return values;
};

const addPairLine = (meshA, meshB) => {
    const values = computePairSegments(meshA, meshB);
    if (!values.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(values), 3));
    const line = new THREE.LineSegments(geometry, edgeMaterial);
    line.matrixAutoUpdate = false;
    line.userData = { parentMesh: meshA, pairMesh: meshB };
    line.visible = showEdges.value && !isRebarOnly.value;
    edgesGroup.add(line);
    registerLine(meshA, line);
    registerLine(meshB, line);
    requestRender();
};

const runJob = (candidates, token) => {
    const entries = candidates.map(mesh => {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        mesh.updateMatrix();
        return { mesh, box: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix) };
    }).sort((a, b) => a.box.min.x - b.box.min.x);

    let i = 0;
    let j = 1;
    let pairCount = 0;
    const step = () => {
        if (token !== rt.intersectionToken) return;
        const deadline = performance.now() + SLICE_MS;
        while (i < entries.length) {
            if (j >= entries.length || entries[j].box.min.x > entries[i].box.max.x) {
                i++;
                j = i + 1;
                continue;
            }
            const a = entries[i];
            const b = entries[j++];
            if (!a.box.intersectsBox(b.box) || !a.mesh.parent || !b.mesh.parent || isPairProcessed(a.mesh, b.mesh)) continue;
            markPairProcessed(a.mesh, b.mesh);
            try {
                addPairLine(a.mesh, b.mesh);
            } catch (error) {
                console.error('Không thể tính đường giao cấu kiện:', error);
            }
            if (++pairCount >= MAX_PAIRS_PER_JOB) return;
            if (performance.now() > deadline) {
                setTimeout(step, 0);
                return;
            }
        }
    };
    step();
};

// Gọi mỗi khi cần hiển thị viền hoặc bắt điểm; chỉ tính lại khi tập cấu kiện đang hiển thị thay đổi
export const ensureIntersectionEdges = () => {
    const candidates = rt.modelGroup.children.filter(mesh =>
        mesh.isMesh && mesh.visible && mesh.geometry?.attributes?.position
        && mesh.geometry.attributes.position.count <= MAX_VERTEX_COUNT && ensureBoundsTree(mesh)
    );
    const signature = `${candidates.length}:${candidates.reduce((sum, mesh) => sum + mesh.id, 0)}`;
    if (signature === rt.intersectionSignature) return;
    rt.intersectionSignature = signature;
    runJob(candidates, ++rt.intersectionToken);
};

// Xóa toàn bộ đường giao đã tính và bộ nhớ đệm cặp cấu kiện (gọi khi vị trí cấu kiện đổi, ví dụ sau transport);
// lần ensureIntersectionEdges kế tiếp sẽ tính lại từ đầu
export const invalidateIntersectionEdges = () => {
    edgesGroup.children.slice().forEach(line => {
        if (!line.userData.pairMesh) return;
        line.geometry?.dispose();
        edgesGroup.remove(line);
    });
    processedPairs = new WeakMap();
    intersectionLinesByMesh = new WeakMap();
    rt.intersectionSignature = null;
    rt.intersectionToken++;
};
