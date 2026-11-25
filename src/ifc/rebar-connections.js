import * as THREE from 'three';

// --- LIÊN KẾT THÉP: coupler / muffe, đầu ren, TTP, MBT... ---
// IFC xuất từ Allplan không có quan hệ nào nối liên kết với thanh thép (không IfcRelConnects, không
// IfcMechanicalFastener, placement đặt theo tầng), nên nhận diện thuần hình học:
//   liên kết = cấu kiện nhỏ không phải thanh thép, mọi mesh là lăng trụ tròn (đáy N cạnh);
//   thép chủ = thanh có trục đi qua lòng liên kết và song song với trục liên kết.
// Trục liên kết lấy theo pháp tuyến mặt đáy (nhóm tam giác đồng phẳng nhiều nhất), KHÔNG lấy theo cạnh dài
// nhất của hộp bao: đĩa ren chỉ dày 1-2 mm nhưng đường kính 16-30 mm, coupler thì ngược lại.
// Module chỉ dùng three.js (không import state/giao diện) để chạy thử được ngoài trình duyệt.

const BAR_TYPES = new Set(['IFCREINFORCINGBAR', 'IFCREINFORCINGMESH', 'IFCTENDON']);
const MAX_PRISM_TRIANGLES = 4000;
const MAX_PRISM_VERTICES = 600;
// Giới hạn kích thước một liên kết (m): Ø ngoài coupler thép lớn nhất khoảng 100 mm, dài tối đa vài chục cm
const MAX_CONNECTOR_RADIUS = 0.08;
const MAX_CONNECTOR_LENGTH = 0.5;
// Đỉnh của mặt bên lăng trụ tròn cách trục bằng nhau (sai lệch tương đối cho phép)
const RADIAL_TOLERANCE = 0.06;
// Hai thanh cùng một phía của liên kết: giữ thanh đồng trục nhất, thêm thanh lệch trục kém hơn tối đa 1,5 mm
const HOST_OFFSET_SLACK = 0.0015;
// Bản xuất trùng: tâm / kích thước lệch dưới 0,5 mm, trục song song
const DUPLICATE_TOLERANCE = 0.0005;
const DUPLICATE_CELL = 0.002;

const meshKeyOf = (mesh) => mesh.userData.meshKey || `${mesh.userData.sourceId || 'demo'}:${mesh.userData.expressID}`;

export const isBarMesh = (mesh) => {
    const ud = mesh?.userData || {};
    return ud.type === 'IFCREINFORCINGBAR' || ud.schemaType === 'IFCREINFORCINGBAR';
};

export const isConnectorMesh = (mesh) => {
    const ud = mesh?.userData || {};
    return !!ud.roundPrism && !BAR_TYPES.has(ud.type) && !BAR_TYPES.has(ud.schemaType);
};

// Lăng trụ tròn trong hệ local của geometry: { axis, center, length, radius } (mảng số) hoặc null
export const analyzeRoundPrism = (geometry) => {
    const position = geometry?.attributes?.position;
    if (!position) return null;
    const index = geometry.index;
    const indexCount = index ? index.count : position.count;
    const triangleCount = Math.floor(indexCount / 3);
    if (triangleCount < 8 || triangleCount > MAX_PRISM_TRIANGLES || position.count > MAX_PRISM_VERTICES * 8) return null;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    if (size.length() > MAX_CONNECTOR_LENGTH + 4 * MAX_CONNECTOR_RADIUS) return null;

    // Gom pháp tuyến tam giác theo hướng (đổi dấu về một phía): mặt đáy N cạnh có 2(N-2) tam giác cùng hướng
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
    const bins = new Map();
    for (let triangle = 0; triangle < triangleCount; triangle++) {
        const i0 = index ? index.getX(triangle * 3) : triangle * 3;
        const i1 = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
        const i2 = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
        a.fromBufferAttribute(position, i0);
        b.fromBufferAttribute(position, i1);
        c.fromBufferAttribute(position, i2);
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        const doubleArea = normal.length();
        if (doubleArea < 1e-14) continue;
        normal.divideScalar(doubleArea);
        const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
        const major = ax >= ay && ax >= az ? normal.x : (ay >= az ? normal.y : normal.z);
        if (major < 0) normal.negate();
        const key = `${Math.round(normal.x * 40)},${Math.round(normal.y * 40)},${Math.round(normal.z * 40)}`;
        let bin = bins.get(key);
        if (!bin) {
            bin = { count: 0, sum: new THREE.Vector3() };
            bins.set(key, bin);
        }
        bin.count++;
        bin.sum.addScaledVector(normal, doubleArea);
    }
    let best = null;
    let secondCount = 0;
    bins.forEach(bin => {
        if (!best || bin.count > best.count) {
            if (best) secondCount = Math.max(secondCount, best.count);
            best = bin;
        } else secondCount = Math.max(secondCount, bin.count);
    });
    // Mặt đáy phải trội hẳn so với mọi hướng mặt bên (hộp chữ nhật / lục giác dẹt bị loại ở đây hoặc ở bước dưới)
    if (!best || best.count < 6 || best.count < secondCount * 1.5) return null;
    const axis = best.sum.normalize();

    // Đỉnh duy nhất: mọi đỉnh của lăng trụ tròn cách trục bằng nhau
    const unique = new Map();
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i);
        const key = `${Math.round(point.x * 1e6)},${Math.round(point.y * 1e6)},${Math.round(point.z * 1e6)}`;
        if (!unique.has(key)) {
            unique.set(key, point.clone());
            if (unique.size > MAX_PRISM_VERTICES) return null;
        }
    }
    const vertices = Array.from(unique.values());
    if (vertices.length < 6) return null;
    const perpCenter = new THREE.Vector3();
    const perp = new THREE.Vector3();
    let sMin = Infinity, sMax = -Infinity;
    vertices.forEach(vertex => {
        const s = vertex.dot(axis);
        sMin = Math.min(sMin, s);
        sMax = Math.max(sMax, s);
        perpCenter.add(perp.copy(vertex).addScaledVector(axis, -s));
    });
    perpCenter.divideScalar(vertices.length);
    let rMin = Infinity, rMax = 0;
    vertices.forEach(vertex => {
        const s = vertex.dot(axis);
        const r = perp.copy(vertex).addScaledVector(axis, -s).sub(perpCenter).length();
        rMin = Math.min(rMin, r);
        rMax = Math.max(rMax, r);
    });
    const length = sMax - sMin;
    if (!(rMax > 1e-4) || !(length > 1e-5) || rMax - rMin > rMax * RADIAL_TOLERANCE + 1e-6) return null;
    const center = perpCenter.clone().addScaledVector(axis, (sMin + sMax) / 2);
    return { axis: axis.toArray(), center: center.toArray(), length, radius: rMax };
};

// Lăng trụ của mesh trong hệ tọa độ của ma trận frame (mặc định matrixWorld)
export const getConnectorPrism = (mesh, frame = mesh.matrixWorld) => {
    const prism = mesh.userData.roundPrism;
    if (!prism) return null;
    const scale = frame.getMaxScaleOnAxis();
    const center = new THREE.Vector3().fromArray(prism.center).applyMatrix4(frame);
    const axis = new THREE.Vector3().fromArray(prism.axis).transformDirection(frame);
    const length = prism.length * scale;
    const radius = prism.radius * scale;
    return { center, axis, length, radius, start: center.clone().addScaledVector(axis, -length / 2) };
};

// Gắn userData.roundPrism cho mesh có dạng liên kết. Một cấu kiện chỉ là liên kết khi MỌI mesh của nó là lăng
// trụ tròn (TTP gồm 3 phần, đầu ren Allplan gồm 3 đĩa). Trả về số cấu kiện liên kết.
export const tagConnectorShapes = (meshes) => {
    const byKey = new Map();
    meshes.forEach(mesh => {
        const ud = mesh.userData;
        delete ud.roundPrism;
        if (BAR_TYPES.has(ud.type) || BAR_TYPES.has(ud.schemaType)) return;
        const key = meshKeyOf(mesh);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(mesh);
    });
    let count = 0;
    byKey.forEach(parts => {
        const shapes = [];
        for (const mesh of parts) {
            const prism = analyzeRoundPrism(mesh.geometry);
            if (!prism) return;
            const scale = mesh.matrix.getMaxScaleOnAxis();
            if (prism.radius * scale > MAX_CONNECTOR_RADIUS || prism.length * scale > MAX_CONNECTOR_LENGTH) return;
            shapes.push(prism);
        }
        parts.forEach((mesh, index) => { mesh.userData.roundPrism = shapes[index]; });
        count++;
    });
    return count;
};

// --- BẢN XUẤT TRÙNG ---
// Allplan xuất mỗi coupler / đầu ren hai lần (khác GlobalId, trùng khít vị trí và kích thước).
// Chỉ so trong cùng một danh sách mesh (gọi theo từng file). Giữ cấu kiện có expressID nhỏ nhất.
// Trả về [{ keepKey, keepMeshes, twins: [{ key, expressID, schemaType, meshes }] }]
export const findDuplicateConnectors = (meshes) => {
    const elements = new Map();
    meshes.forEach(mesh => {
        if (!isConnectorMesh(mesh)) return;
        const key = meshKeyOf(mesh);
        if (!elements.has(key)) {
            elements.set(key, {
                key,
                expressID: mesh.userData.expressID,
                type: mesh.userData.type,
                schemaType: mesh.userData.schemaType || mesh.userData.type,
                meshes: [],
                parts: []
            });
        }
        const element = elements.get(key);
        element.meshes.push(mesh);
        // Ma trận local trong modelGroup: so được ngay khi vừa nạp (chưa cần matrixWorld)
        mesh.updateMatrix();
        element.parts.push(getConnectorPrism(mesh, mesh.matrix));
    });
    const cellOf = (vector) => [
        Math.floor(vector.x / DUPLICATE_CELL),
        Math.floor(vector.y / DUPLICATE_CELL),
        Math.floor(vector.z / DUPLICATE_CELL)
    ];
    const partsMatch = (partsA, partsB) => partsA.length === partsB.length && partsA.every(part =>
        partsB.some(other => part.center.distanceTo(other.center) < DUPLICATE_TOLERANCE
            && Math.abs(part.axis.dot(other.axis)) > 0.9999
            && Math.abs(part.length - other.length) < DUPLICATE_TOLERANCE
            && Math.abs(part.radius - other.radius) < DUPLICATE_TOLERANCE));
    const grid = new Map();
    const groups = new Map();
    Array.from(elements.values())
        .sort((x, y) => x.expressID - y.expressID)
        .forEach(element => {
            const centroid = new THREE.Vector3();
            element.parts.forEach(part => centroid.add(part.center));
            centroid.divideScalar(element.parts.length);
            const [cx, cy, cz] = cellOf(centroid);
            let kept = null;
            for (let dx = -1; dx <= 1 && !kept; dx++) {
                for (let dy = -1; dy <= 1 && !kept; dy++) {
                    for (let dz = -1; dz <= 1 && !kept; dz++) {
                        const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
                        kept = bucket?.find(other => other.type === element.type && partsMatch(element.parts, other.parts)) || null;
                    }
                }
            }
            if (kept) {
                if (!groups.has(kept.key)) groups.set(kept.key, { keepKey: kept.key, keepMeshes: kept.meshes, twins: [] });
                groups.get(kept.key).twins.push({ key: element.key, expressID: element.expressID, schemaType: element.schemaType, meshes: element.meshes });
                return;
            }
            const cellKey = `${cx},${cy},${cz}`;
            if (!grid.has(cellKey)) grid.set(cellKey, []);
            grid.get(cellKey).push(element);
        });
    return Array.from(groups.values());
};

// --- THÉP CHỦ ---
// web-ifc dựng thanh thép (IfcSweptDiskSolid) thành ống HỞ hai đầu, nên không dò trong/ngoài bằng tia dọc trục
// (tia chạy song song thành ống, không cắt gì). Thay vào đó cắt ngang: tại một điểm trên trục liên kết bắn 8 tia
// vuông góc trục, 8 điểm chạm phải nằm trên một đường tròn (tiết diện thanh song song với liên kết). Thanh xiên
// cho tiết diện elip (khớp tròn lệch), điểm nằm ngoài thanh thì có tia trượt.
const SECTION_RAYS = 8;
const rayLocal = new THREE.Ray();
const pointLocal = new THREE.Vector3();
const directionLocal = new THREE.Vector3();
const sectionDirection = new THREE.Vector3();

// Khoảng cách (world) từ point theo direction tới bề mặt thanh gần nhất (trong maxDistance), null nếu trượt
const firstHitDistance = (probe, point, direction, maxDistance) => {
    pointLocal.copy(point).applyMatrix4(probe.inverse);
    directionLocal.copy(direction).transformDirection(probe.inverse);
    rayLocal.set(pointLocal, directionLocal);
    const hit = probe.bvh.raycastFirst(rayLocal, THREE.DoubleSide, 0, maxDistance / probe.scale);
    return hit ? hit.distance * probe.scale : null;
};

// Đường tròn khớp bình phương tối thiểu (Kasa) qua các điểm 2D: { cx, cy, r, residual } hoặc null
const fitCircle = (points) => {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
    points.forEach(([x, y]) => {
        const z = x * x + y * y;
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
    });
    const n = points.length;
    // [sxx sxy sx; sxy syy sy; sx sy n] * [D E F] = -[sxz syz sz]
    const det3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    const matrix = [sxx, sxy, sx, sxy, syy, sy, sx, sy, n];
    const rhs = [-sxz, -syz, -sz];
    const det = det3(matrix);
    if (Math.abs(det) < 1e-30) return null;
    const solve = (column) => {
        const m = matrix.slice();
        m[column] = rhs[0]; m[column + 3] = rhs[1]; m[column + 6] = rhs[2];
        return det3(m) / det;
    };
    const cx = -solve(0) / 2;
    const cy = -solve(1) / 2;
    const r2 = cx * cx + cy * cy - solve(2);
    if (!(r2 > 0)) return null;
    const r = Math.sqrt(r2);
    const residual = Math.max(...points.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r)));
    return { cx, cy, r, residual };
};

// Tiết diện thanh tại point (mặt phẳng vuông góc trục liên kết): { offset: tâm thanh cách trục liên kết, radius }
const sampleSection = (probe, point, frame, maxDistance) => {
    const [u, v] = frame;
    const points = [];
    for (let k = 0; k < SECTION_RAYS; k++) {
        const angle = (2 * Math.PI * k) / SECTION_RAYS;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        sectionDirection.copy(u).multiplyScalar(cos).addScaledVector(v, sin);
        const distance = firstHitDistance(probe, point, sectionDirection, maxDistance);
        if (distance === null) return null;
        points.push([cos * distance, sin * distance]);
    }
    const circle = fitCircle(points);
    // Ống thép là đa giác 12 cạnh: điểm chạm lệch tối đa khoảng 3,4% bán kính so với đường tròn
    if (!circle || circle.residual > circle.r * 0.1) return null;
    const offset = Math.hypot(circle.cx, circle.cy);
    // Lệch trục tối đa 0,4 Ø thanh (Allplan có chỗ đặt lệch 3-5 mm)
    if (offset > circle.r * 0.8) return null;
    return { offset, radius: circle.r };
};

const perpendicularPair = (axis) => {
    const helper = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    return [u, v];
};

// Thanh chạm mặt đầu coupler (cắm vào 0 mm, chờ vặn vào) vẫn là thép của mối nối
const FACE_GAP = 0.004;

// Thanh có đi đồng trục qua lòng liên kết không: { offset (m), tMin, tMax: đoạn thanh chiếm dọc trục cấu kiện }
// Điều kiện: có mặt trong lòng liên kết (hoặc sát mặt đầu) VÀ kéo dài ra ngoài liên kết theo đúng trục
// (thanh cắt ngang liên kết không thỏa, kể cả khi trục của nó đi qua tâm liên kết).
// t đo theo trục chung của cả cấu kiện (elementFrame) để gộp được nhiều phần (TTP 3 phần, ren 3 đĩa).
const probeBar = (probe, prism, frame, elementFrame) => {
    const thin = prism.length < prism.radius;
    const insideAt = (thin ? [0.5] : [0.1, 0.3, 0.5, 0.7, 0.9]).map(fraction => prism.length * fraction);
    if (!thin) insideAt.push(-FACE_GAP, prism.length + FACE_GAP);
    const near = Math.max(prism.radius, 0.01);
    const far = Math.max(prism.radius * 4, 0.04);
    const outsideAt = [-near, -far, prism.length + near, prism.length + far];
    const maxDistance = prism.radius * 3 + 0.01;
    const point = new THREE.Vector3();
    const relative = new THREE.Vector3();
    const present = [];
    const sectionAt = (s) => {
        point.copy(prism.start).addScaledVector(prism.axis, s);
        const section = sampleSection(probe, point, frame, maxDistance);
        if (section) present.push({ t: relative.copy(point).sub(elementFrame.center).dot(elementFrame.axis), offset: section.offset });
        return section;
    };
    const insideOffsets = insideAt.map(sectionAt).filter(Boolean).map(section => section.offset);
    if (insideOffsets.length === 0) return null;
    if (!outsideAt.map(sectionAt).some(Boolean)) return null;
    const ts = present.map(sample => sample.t);
    return { offset: Math.min(...insideOffsets), tMin: Math.min(...ts), tMax: Math.max(...ts) };
};

const GRID_CELL = 1;
const cellRange = (box) => [
    Math.floor(box.min.x / GRID_CELL), Math.floor(box.max.x / GRID_CELL),
    Math.floor(box.min.y / GRID_CELL), Math.floor(box.max.y / GRID_CELL),
    Math.floor(box.min.z / GRID_CELL), Math.floor(box.max.z / GRID_CELL)
];

const worldBox = (mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
};

// Liên kết và thép chủ trong tập mesh đang xét (gọi lúc kiểm tra clash, theo vị trí hiện tại kể cả sau transport).
// Mỗi phía của liên kết giữ thanh đồng trục nhất (chỗ thép Ø14 và Ø20 nằm chồng nhau vẫn chọn đúng cỡ).
export const buildConnectionIndex = (meshes) => {
    const connectorMeshes = meshes.filter(isConnectorMesh);
    const elements = new Map();
    const empty = {
        connectorCount: 0,
        hostLessCount: 0,
        connectorKeyOf: () => null,
        hostsOf: () => null,
        shouldSkipPair: () => false
    };
    if (connectorMeshes.length === 0) return empty;

    const grid = new Map();
    meshes.forEach(mesh => {
        if (!isBarMesh(mesh) || !mesh.geometry?.attributes?.position) return;
        const box = worldBox(mesh);
        const [x0, x1, y0, y1, z0, z1] = cellRange(box);
        // Thanh dài bất thường (lỗi hình học) không đưa vào lưới để tránh tốn bộ nhớ
        if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096) return;
        const entry = { mesh, box };
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
            const key = `${x},${y},${z}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(entry);
        }
    });
    const probes = new Map();
    const probeFor = (bar) => {
        let probe = probes.get(bar);
        if (probe === undefined) {
            if (!bar.geometry.boundsTree && bar.geometry.computeBoundsTree) bar.geometry.computeBoundsTree();
            probe = bar.geometry.boundsTree
                ? { bvh: bar.geometry.boundsTree, inverse: bar.matrixWorld.clone().invert(), scale: bar.matrixWorld.getMaxScaleOnAxis() }
                : null;
            probes.set(bar, probe);
        }
        return probe;
    };

    // Trục / tâm chung của mỗi cấu kiện liên kết (gộp các phần)
    connectorMeshes.forEach(mesh => {
        const key = meshKeyOf(mesh);
        const prism = getConnectorPrism(mesh);
        if (!prism) return;
        if (!elements.has(key)) elements.set(key, { parts: [], candidates: new Map(), hosts: new Set() });
        elements.get(key).parts.push(prism);
    });
    elements.forEach(element => {
        const center = new THREE.Vector3();
        element.parts.forEach(part => center.add(part.center));
        element.frame = { center: center.divideScalar(element.parts.length), axis: element.parts[0].axis };
    });

    elements.forEach(element => element.parts.forEach(prism => {
        const end = prism.start.clone().addScaledVector(prism.axis, prism.length);
        const box = new THREE.Box3().setFromPoints([prism.start, end]).expandByScalar(prism.radius);
        const [x0, x1, y0, y1, z0, z1] = cellRange(box);
        const seen = new Set();
        const frame = perpendicularPair(prism.axis);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
            (grid.get(`${x},${y},${z}`) || []).forEach(entry => {
                if (seen.has(entry.mesh)) return;
                seen.add(entry.mesh);
                if (!entry.box.intersectsBox(box)) return;
                const probe = probeFor(entry.mesh);
                if (!probe) return;
                const hit = probeBar(probe, prism, frame, element.frame);
                if (!hit) return;
                const previous = element.candidates.get(entry.mesh);
                element.candidates.set(entry.mesh, previous ? {
                    offset: Math.min(previous.offset, hit.offset),
                    tMin: Math.min(previous.tMin, hit.tMin),
                    tMax: Math.max(previous.tMax, hit.tMax)
                } : hit);
            });
        }
    }));

    // Thép chủ: xét từ thanh đồng trục nhất; thanh chiếm cùng đoạn dọc trục với một thanh đã nhận mà lệch trục
    // hơn quá HOST_OFFSET_SLACK thì bỏ (thép Ø14 chồng lên Ø20 trong coupler Ø20). Hai thanh ở hai đầu coupler
    // không chồng đoạn nên đều là thép chủ.
    let hostLessCount = 0;
    elements.forEach(element => {
        const accepted = [];
        Array.from(element.candidates, ([bar, hit]) => ({ bar, ...hit }))
            .sort((x, y) => x.offset - y.offset)
            .forEach(candidate => {
                const blocked = accepted.some(other => other.offset < candidate.offset - HOST_OFFSET_SLACK
                    && Math.min(other.tMax, candidate.tMax) - Math.max(other.tMin, candidate.tMin) > FACE_GAP);
                if (blocked) return;
                accepted.push(candidate);
                element.hosts.add(candidate.bar);
            });
        delete element.candidates;
        delete element.parts;
        if (element.hosts.size === 0) hostLessCount++;
    });

    const connectorKeyOf = (mesh) => {
        if (!isConnectorMesh(mesh)) return null;
        const key = meshKeyOf(mesh);
        return elements.has(key) ? key : null;
    };
    const hostsOf = (mesh) => {
        const key = connectorKeyOf(mesh);
        return key ? elements.get(key).hosts : null;
    };
    // Bỏ qua: liên kết ↔ thép chủ của nó, và hai liên kết cùng một thép chủ (đầu ren nằm trong coupler)
    const shouldSkipPair = (meshA, meshB) => {
        const hostsA = hostsOf(meshA);
        const hostsB = hostsOf(meshB);
        if (hostsA && hostsA.has(meshB)) return true;
        if (hostsB && hostsB.has(meshA)) return true;
        if (hostsA && hostsB) {
            for (const host of hostsA) if (hostsB.has(host)) return true;
        }
        return false;
    };
    return { connectorCount: elements.size, hostLessCount, connectorKeyOf, hostsOf, shouldSkipPair, elements };
};
