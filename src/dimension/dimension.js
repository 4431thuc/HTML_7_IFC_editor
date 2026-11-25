import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { requestRender } from '../core/helpers.js';
import { worldToProjectCoords } from '../core/coords.js';
import { ensureBoundsTree, ensureIntersectionEdges, intersectionLinesByMesh } from '../scene/intersections.js';
import { restoreMeshMaterial } from '../scene/rendering.js';
import { getVisibleModelIntersections } from '../selection/input.js';
import { isMeshSelected, resolveHitElement } from '../selection/selection.js';
import { snapEdgeAngleDeg, snapEdgeAngleStorageKey, dimGroup, dimItems, dimModeActive, isOrthographic, leftActiveTab, mouse, raycaster, rt, selectedDimId } from '../state/state.js';

const DIM_COLOR = 0xef4444;
const DIM_SELECTED_COLOR = 0xf59e0b;
const DIM_RENDER_ORDER = 3000;
// Kích thước hiển thị tính bằng pixel màn hình: tự co giãn theo zoom
const POINT_RADIUS_PX = 6;
const HOVER_RADIUS_PX = 4;
// Bắt điểm vào cạnh model: phạm vi tính bằng pixel màn hình nên tự linh động theo zoom
const SNAP_RADIUS_PX = 7;
// Điểm vuông góc (từ điểm đo 1 xuống cạnh model) được ưu tiên hơn điểm gần nhất khi nằm trong phạm vi này
const PERPENDICULAR_RADIUS_PX = 7;
// Bắt điểm vuông góc tới bề mặt cấu kiện khác: phạm vi bắt và bán kính vùng tròn highlight (px màn hình)
const SURFACE_PERPENDICULAR_RADIUS_PX = 7;
const SURFACE_DISC_RADIUS_PX = 14;
// Viền được bắt dày gấp đôi viền thường (1px)
const SNAP_LINE_WIDTH_PX = 2;
const LABEL_OPACITY = 0.8;
const SNAP_MAX_VERTEX_COUNT = 60000;
const HOVER_COLOR = 0xffffff;
const HOVER_SNAP_COLOR = 0x00008b;
const SNAP_LINE_COLOR = 0xffd21f;
const LABEL_HEIGHT_PX = 22;

const sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
// Mỗi nhóm đo: { group, sphereA, sphereB, line, label, mid }; id khớp với dimItems
const dimObjects = new Map();

const createDimMaterial = (color) => new THREE.MeshBasicMaterial({
    color, depthTest: false, depthWrite: false, transparent: true, toneMapped: false
});

const createMarker = (color, radiusPx) => {
    const marker = new THREE.Mesh(sphereGeometry, createDimMaterial(color));
    marker.renderOrder = DIM_RENDER_ORDER;
    marker.frustumCulled = false;
    marker.visible = false;
    marker.userData.radiusPx = radiusPx;
    return marker;
};

// Dấu hình vuông / tam giác (sprite hướng về camera, tô màu bằng material.color) dùng cho các kiểu bắt điểm đặc biệt:
// vuông = bắt vuông góc với cạnh, tam giác = bắt vuông góc tới bề mặt
const shapeTextureCache = {};
const getShapeTexture = (shape) => {
    if (!shapeTextureCache[shape]) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        if (shape === 'triangle') {
            ctx.beginPath();
            ctx.moveTo(16, 2);
            ctx.lineTo(31, 30);
            ctx.lineTo(1, 30);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(0, 0, 32, 32);
        }
        shapeTextureCache[shape] = new THREE.CanvasTexture(canvas);
        shapeTextureCache[shape].colorSpace = THREE.SRGBColorSpace;
    }
    return shapeTextureCache[shape];
};

const createShapeMarker = (shape, color, sizePx) => {
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getShapeTexture(shape), color, depthTest: false, depthWrite: false, transparent: true, toneMapped: false
    }));
    marker.renderOrder = DIM_RENDER_ORDER;
    marker.frustumCulled = false;
    marker.visible = false;
    // radiusPx quy ước = nửa cạnh, để cùng kích cỡ với quả cầu cùng bán kính
    marker.userData.radiusPx = sizePx / 2;
    return marker;
};

export const initDimensionMarkers = () => {
    dimGroup.visible = dimModeActive.value;
    rt.dimHoverMarker = createMarker(HOVER_COLOR, HOVER_RADIUS_PX);
    rt.dimHoverMarker.material.opacity = 0.85;
    rt.dimPendingMarker = createMarker(DIM_COLOR, POINT_RADIUS_PX);
    // Dấu ở góc phải trên con trỏ cho điểm 2 bắt vuông góc (vuông: với cạnh, tam giác: với bề mặt); cùng kích cỡ quả cầu hover
    rt.dimShapeMarkers = {
        square: createShapeMarker('square', HOVER_SNAP_COLOR, HOVER_RADIUS_PX * 2),
        triangle: createShapeMarker('triangle', HOVER_SNAP_COLOR, HOVER_RADIUS_PX * 2)
    };

    // Đường nối + nhãn xem trước từ điểm 1 tới điểm đang hover
    const previewLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: DIM_COLOR, depthTest: false, depthWrite: false, transparent: true, opacity: 0.7, toneMapped: false })
    );
    previewLine.renderOrder = DIM_RENDER_ORDER - 1;
    previewLine.frustumCulled = false;
    const previewLabel = createLabelSprite('0.0 cm');
    previewLine.visible = previewLabel.visible = false;
    rt.dimPreview = { line: previewLine, label: previewLabel, mid: new THREE.Vector3() };

    // Dấu gợi ý (chưa bắt) vị trí điểm vuông góc trên cạnh đang hover
    rt.dimEdgeHint = createShapeMarker('square', HOVER_SNAP_COLOR, HOVER_RADIUS_PX * 2);
    rt.dimEdgeHint.material.opacity = 0.6;

    // Các cạnh model đang được bắt điểm (1 cạnh, hoặc nhiều cạnh giao nhau tại góc): tô vàng, dày gấp đôi viền thường,
    // luôn vẽ trên cùng. Dùng LineSegments2 vì line WebGL thường không đổi được độ dày.
    const snapLine = new LineSegments2(
        new LineSegmentsGeometry().setPositions([0, 0, 0, 0, 0, 0]),
        new LineMaterial({
            color: SNAP_LINE_COLOR, linewidth: SNAP_LINE_WIDTH_PX, depthTest: false, depthWrite: false, toneMapped: false
        })
    );
    snapLine.renderOrder = DIM_RENDER_ORDER + 5;
    snapLine.frustumCulled = false;
    snapLine.visible = false;
    rt.dimSnapLine = snapLine;

    // Vùng tròn vàng nằm trên bề mặt mesh tại điểm bắt vuông góc tới bề mặt
    const disc = new THREE.Mesh(
        new THREE.CircleGeometry(1, 40),
        new THREE.MeshBasicMaterial({
            color: SNAP_LINE_COLOR, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false
        })
    );
    disc.renderOrder = DIM_RENDER_ORDER + 1;
    disc.frustumCulled = false;
    disc.visible = false;
    rt.dimSurfaceDisc = disc;

    dimGroup.add(previewLine, previewLabel, snapLine, disc, rt.dimEdgeHint, rt.dimHoverMarker, rt.dimPendingMarker, rt.dimShapeMarkers.square, rt.dimShapeMarkers.triangle);
};

// Kích thước world của 1 pixel màn hình tại vị trí position
const worldUnitsPerPixel = (position) => {
    const height = Math.max(rt.renderer.domElement.clientHeight, 1);
    if (isOrthographic.value) return (rt.camera.top - rt.camera.bottom) / rt.camera.zoom / height;
    const distance = rt.camera.position.distanceTo(position);
    return 2 * distance * Math.tan(THREE.MathUtils.degToRad(rt.camera.fov) / 2) / height;
};

export const formatDimDistance = (meters) => meters >= 1
    ? `${meters.toFixed(2)} m`
    : `${(meters * 100).toFixed(1)} cm`;

const drawLabelTexture = (text) => {
    const scale = 2;
    const fontPx = 13 * scale;
    const paddingX = 8 * scale;
    const height = LABEL_HEIGHT_PX * scale;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${fontPx}px Arial, sans-serif`;
    canvas.width = Math.ceil(ctx.measureText(text).width + paddingX * 2);
    canvas.height = height;
    ctx.font = `bold ${fontPx}px Arial, sans-serif`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.roundRect(ctx.lineWidth / 2, ctx.lineWidth / 2, canvas.width - ctx.lineWidth, height - ctx.lineWidth, 6 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, height / 2 + 1);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, aspect: canvas.width / canvas.height };
};

const setLabelText = (sprite, text) => {
    const { texture, aspect } = drawLabelTexture(text);
    sprite.material.map?.dispose();
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
    sprite.userData.aspect = aspect;
    sprite.userData.text = text;
};

const createLabelSprite = (text) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, opacity: LABEL_OPACITY, depthTest: false, depthWrite: false, toneMapped: false
    }));
    sprite.renderOrder = DIM_RENDER_ORDER + 2;
    sprite.frustumCulled = false;
    setLabelText(sprite, text);
    return sprite;
};

const buildDimensionObjects = (item) => {
    const pointA = new THREE.Vector3(...item.p1);
    const pointB = new THREE.Vector3(...item.p2);
    const mid = pointA.clone().add(pointB).multiplyScalar(0.5);

    // Điểm 2 bắt vuông góc: cả 2 điểm đo hiển thị hình vuông thay cho quả cầu
    // Điểm 2 bắt vuông góc: cả 2 điểm đo hiển thị hình vuông (với cạnh) hoặc tam giác (với bề mặt) thay cho quả cầu
    const createPointMarker = item.pointShape
        ? () => createShapeMarker(item.pointShape, DIM_COLOR, POINT_RADIUS_PX * 2)
        : () => createMarker(DIM_COLOR, POINT_RADIUS_PX);
    const sphereA = createPointMarker();
    const sphereB = createPointMarker();
    sphereA.visible = sphereB.visible = true;
    sphereA.position.copy(pointA);
    sphereB.position.copy(pointB);

    const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([pointA, pointB]),
        new THREE.LineBasicMaterial({ color: DIM_COLOR, depthTest: false, depthWrite: false, transparent: true, toneMapped: false })
    );
    line.renderOrder = DIM_RENDER_ORDER - 1;
    line.frustumCulled = false;

    const label = createLabelSprite(formatDimDistance(item.distance));
    label.position.copy(mid);

    const group = new THREE.Group();
    group.add(line, sphereA, sphereB, label);
    dimGroup.add(group);
    dimObjects.set(item.id, { group, sphereA, sphereB, line, label, mid });
};

const applyDimensionColors = () => {
    dimObjects.forEach((objects, id) => {
        const color = id === selectedDimId.value ? DIM_SELECTED_COLOR : DIM_COLOR;
        objects.sphereA.material.color.setHex(color);
        objects.sphereB.material.color.setHex(color);
        objects.line.material.color.setHex(color);
    });
};

// Giữ quả cầu và nhãn có kích thước cố định trên màn hình khi zoom
export const updateDimensionScales = () => {
    if (!rt.camera || !rt.renderer) return;
    const scaleMarker = (marker) => {
        if (!marker || !marker.visible) return;
        // Sprite có cạnh = 2 * radiusPx; quả cầu bán kính 1 đơn vị nên scale = radiusPx
        const factor = marker.isSprite ? 2 : 1;
        marker.scale.setScalar(factor * marker.userData.radiusPx * worldUnitsPerPixel(marker.position));
    };
    scaleMarker(rt.dimHoverMarker);
    scaleMarker(rt.dimPendingMarker);
    scaleMarker(rt.dimShapeMarkers.square);
    scaleMarker(rt.dimShapeMarkers.triangle);
    scaleMarker(rt.dimEdgeHint);
    if (rt.dimSurfaceDisc.visible) {
        rt.dimSurfaceDisc.scale.setScalar(SURFACE_DISC_RADIUS_PX * worldUnitsPerPixel(rt.dimSurfaceDisc.position));
    }
    // LineMaterial cần kích thước viewport (pixel thiết bị) để giữ độ dày cố định trên màn hình
    const drawingSize = rt.renderer.getDrawingBufferSize(new THREE.Vector2());
    rt.dimSnapLine.material.resolution.copy(drawingSize);
    const preview = rt.dimPreview;
    if (preview?.label.visible) {
        const height = LABEL_HEIGHT_PX * worldUnitsPerPixel(preview.mid);
        preview.label.scale.set(height * preview.label.userData.aspect, height, 1);
    }
    dimObjects.forEach(({ sphereA, sphereB, label, mid }) => {
        scaleMarker(sphereA);
        scaleMarker(sphereB);
        const height = LABEL_HEIGHT_PX * worldUnitsPerPixel(mid);
        label.scale.set(height * label.userData.aspect, height, 1);
    });
};

// Cạnh cứng (EdgesGeometry) của cấu kiện, tính một lần rồi cache theo mesh; null nếu quá nặng
// Ngưỡng góc lấy từ thanh kéo "Bắt cạnh khi đo" (snapEdgeAngleDeg); đổi góc thì xóa cache
let edgePositionCache = new WeakMap();
export const applySnapEdgeAngle = () => {
    try {
        localStorage.setItem(snapEdgeAngleStorageKey, String(snapEdgeAngleDeg.value));
    } catch (error) {
        console.error('Không thể lưu cài đặt góc bắt cạnh:', error);
    }
    edgePositionCache = new WeakMap();
};
const getElementEdgePositions = (element) => {
    if (edgePositionCache.has(element)) return edgePositionCache.get(element);
    let positions = null;
    const position = element?.geometry?.attributes?.position;
    if (position && position.count <= SNAP_MAX_VERTEX_COUNT) {
        const edges = new THREE.EdgesGeometry(element.geometry, snapEdgeAngleDeg.value);
        positions = edges.attributes.position.array;
        edges.dispose();
    }
    edgePositionCache.set(element, positions);
    return positions;
};

// Nguồn cạnh để bắt điểm của một cấu kiện: viền cứng của chính nó + các đường giao với cấu kiện khác.
// Mỗi nguồn: { positions (cặp đỉnh liên tiếp là một đoạn), object (cho matrixWorld) }
const collectEdgeSources = (elements) => {
    const sources = [];
    const seenLines = new Set();
    elements.forEach(element => {
        const positions = getElementEdgePositions(element);
        if (positions) sources.push({ positions, object: element });
        intersectionLinesByMesh.get(element)?.forEach(line => {
            if (seenLines.has(line) || !line.parent) return;
            const { parentMesh, pairMesh } = line.userData;
            if (!parentMesh?.visible || !pairMesh?.visible) return;
            seenLines.add(line);
            sources.push({ positions: line.geometry.attributes.position.array, object: line });
        });
    });
    return sources;
};

// Điểm gần nhất giữa 2 đoạn thẳng (Ericson, Real-Time Collision Detection)
const closestPointsBetweenSegments = (p1, q1, p2, q2, outA, outB) => {
    const EPS = 1e-12;
    const d1 = q1.clone().sub(p1);
    const d2 = q2.clone().sub(p2);
    const r = p1.clone().sub(p2);
    const a = d1.dot(d1);
    const e = d2.dot(d2);
    const f = d2.dot(r);
    let s = 0;
    let t = 0;
    if (a <= EPS && e <= EPS) {
        s = t = 0;
    } else if (a <= EPS) {
        t = THREE.MathUtils.clamp(f / e, 0, 1);
    } else {
        const c = d1.dot(r);
        if (e <= EPS) {
            s = THREE.MathUtils.clamp(-c / a, 0, 1);
        } else {
            const b = d1.dot(d2);
            const denominator = a * e - b * b;
            s = denominator > EPS ? THREE.MathUtils.clamp((b * f - c * e) / denominator, 0, 1) : 0;
            t = (b * s + f) / e;
            if (t < 0) {
                t = 0;
                s = THREE.MathUtils.clamp(-c / a, 0, 1);
            } else if (t > 1) {
                t = 1;
                s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
            }
        }
    }
    outA.copy(p1).addScaledVector(d1, s);
    outB.copy(p2).addScaledVector(d2, t);
};

// Nhiều cạnh cùng nằm gần con trỏ: nếu có 2 cạnh trở lên giao nhau tại một góc nằm trong phạm vi bắt điểm
// thì trả về góc đó cùng toàn bộ các cạnh đi qua nó. candidates: [{ distance, segment: [A, B] }]
const findCornerSnap = (candidates, mouseX, mouseY, width, height, viewProjection) => {
    const list = candidates.slice().sort((a, b) => a.distance - b.distance).slice(0, 24);
    const pointA = new THREE.Vector3();
    const pointB = new THREE.Vector3();
    const corner = new THREE.Vector3();
    const clip = new THREE.Vector4();
    const closest = new THREE.Vector3();
    const line = new THREE.Line3();
    let best = null;
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            closestPointsBetweenSegments(list[i].segment[0], list[i].segment[1], list[j].segment[0], list[j].segment[1], pointA, pointB);
            corner.copy(pointA).add(pointB).multiplyScalar(0.5);
            const tolerance = Math.max(1e-4, worldUnitsPerPixel(corner) * 0.5);
            if (pointA.distanceTo(pointB) > tolerance) continue;
            clip.set(corner.x, corner.y, corner.z, 1).applyMatrix4(viewProjection);
            if (clip.w <= 1e-6) continue;
            const screenX = (clip.x / clip.w + 1) / 2 * width;
            const screenY = (1 - clip.y / clip.w) / 2 * height;
            const distance = Math.hypot(mouseX - screenX, mouseY - screenY);
            if (distance > SNAP_RADIUS_PX || (best && distance >= best.distance)) continue;
            best = { distance, point: corner.clone(), tolerance };
        }
    }
    if (!best) return null;
    const segments = list.filter(({ segment }) => {
        line.set(segment[0], segment[1]).closestPointToPoint(best.point, true, closest);
        return closest.distanceTo(best.point) <= best.tolerance;
    }).map(({ segment }) => segment);
    return { point: best.point, segments };
};

// Tìm điểm bắt trên cạnh gần con trỏ nhất (trong SNAP_RADIUS_PX pixel màn hình) của các cấu kiện ứng viên.
// Thứ tự ưu tiên: (1) điểm vuông góc từ điểm đo 1 xuống cạnh (trong PERPENDICULAR_RADIUS_PX),
// (2) góc giao của 2 cạnh trở lên, (3) điểm gần nhất trên cạnh gần con trỏ nhất.
// rayDepth: độ sâu điểm chạm bề mặt dọc tia, dùng để loại các cạnh ở mặt khuất phía sau.
// Trả về { perpendicular, corner, nearest, nearestFoot }; nearestFoot = điểm vuông góc trên cạnh nearest (gợi ý, chưa bắt) hoặc null.
const snapToEdges = (elements, rayDepth) => {
    const width = Math.max(rt.renderer.domElement.clientWidth, 1);
    const height = Math.max(rt.renderer.domElement.clientHeight, 1);
    const mouseX = (mouse.x + 1) / 2 * width;
    const mouseY = (1 - mouse.y) / 2 * height;
    rt.camera.updateMatrixWorld();
    const viewProjection = new THREE.Matrix4().multiplyMatrices(rt.camera.projectionMatrix, rt.camera.matrixWorldInverse);
    const mvp = new THREE.Matrix4();
    const inverseWorld = new THREE.Matrix4();
    const clipA = new THREE.Vector4();
    const clipB = new THREE.Vector4();
    const clipFoot = new THREE.Vector4();
    const localPending = new THREE.Vector3();
    const localA = new THREE.Vector3();
    const localB = new THREE.Vector3();
    const foot = new THREE.Vector3();
    const worldA = new THREE.Vector3();
    const worldB = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    const pending = rt.dimPendingPoint;
    const candidates = [];
    let best = null;
    let bestPerpendicular = null;
    // Chân đường vuông góc (world) trên cạnh gần con trỏ nhất, chỉ để hiển thị gợi ý
    let nearestFoot = null;

    const isBehindSurface = (point) => {
        if (rayDepth === undefined) return false;
        const depth = toPoint.copy(point).sub(raycaster.ray.origin).dot(raycaster.ray.direction);
        const tolerance = worldUnitsPerPixel(point) * SNAP_RADIUS_PX * 8 + rayDepth * 0.005;
        return Math.abs(depth - rayDepth) > tolerance;
    };
    const worldSegment = (matrixWorld, positions, i) => [
        worldA.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(matrixWorld).clone(),
        worldB.set(positions[i + 3], positions[i + 4], positions[i + 5]).applyMatrix4(matrixWorld).clone()
    ];

    collectEdgeSources(elements).forEach(({ positions, object }) => {
        object.updateWorldMatrix(true, false);
        const matrixWorld = object.matrixWorld;
        mvp.multiplyMatrices(viewProjection, matrixWorld);
        if (pending) localPending.copy(pending).applyMatrix4(inverseWorld.copy(matrixWorld).invert());
        for (let i = 0; i + 5 < positions.length; i += 6) {
            clipA.set(positions[i], positions[i + 1], positions[i + 2], 1).applyMatrix4(mvp);
            clipB.set(positions[i + 3], positions[i + 4], positions[i + 5], 1).applyMatrix4(mvp);
            if (clipA.w <= 1e-6 || clipB.w <= 1e-6) continue;
            // hasFoot: chân đường vuông góc từ điểm đo 1 xuống đoạn này nằm trong đoạn (foot ở không gian local của đối tượng)
            let hasFoot = false;

            // Điểm vuông góc từ điểm đo 1 xuống đoạn này (phải nằm trong đoạn và trong phạm vi quanh con trỏ)
            if (pending) {
                localA.set(positions[i], positions[i + 1], positions[i + 2]);
                localB.set(positions[i + 3], positions[i + 4], positions[i + 5]);
                const edge = localB.clone().sub(localA);
                const lengthSq = edge.lengthSq();
                const along = lengthSq > 0 ? localPending.clone().sub(localA).dot(edge) / lengthSq : -1;
                if (along >= 0 && along <= 1) {
                    foot.copy(localA).addScaledVector(edge, along);
                    if (foot.distanceToSquared(localPending) > 1e-12) {
                        hasFoot = true;
                        clipFoot.set(foot.x, foot.y, foot.z, 1).applyMatrix4(mvp);
                        if (clipFoot.w > 1e-6) {
                            const footX = (clipFoot.x / clipFoot.w + 1) / 2 * width;
                            const footY = (1 - clipFoot.y / clipFoot.w) / 2 * height;
                            const footDistance = Math.hypot(mouseX - footX, mouseY - footY);
                            if (footDistance <= PERPENDICULAR_RADIUS_PX && (!bestPerpendicular || footDistance < bestPerpendicular.distance)) {
                                const point = foot.clone().applyMatrix4(matrixWorld);
                                if (!isBehindSurface(point)) {
                                    bestPerpendicular = { distance: footDistance, point, perpendicular: true, segments: [worldSegment(matrixWorld, positions, i)] };
                                }
                            }
                        }
                    }
                }
            }

            const ax = (clipA.x / clipA.w + 1) / 2 * width;
            const ay = (1 - clipA.y / clipA.w) / 2 * height;
            const bx = (clipB.x / clipB.w + 1) / 2 * width;
            const by = (1 - clipB.y / clipB.w) / 2 * height;
            const dx = bx - ax;
            const dy = by - ay;
            const lengthSq = dx * dx + dy * dy;
            const t = lengthSq > 0 ? THREE.MathUtils.clamp(((mouseX - ax) * dx + (mouseY - ay) * dy) / lengthSq, 0, 1) : 0;
            const distance = Math.hypot(mouseX - (ax + t * dx), mouseY - (ay + t * dy));
            if (distance > SNAP_RADIUS_PX) continue;
            // t trên màn hình -> t trong không gian world (hiệu chỉnh phối cảnh theo w)
            const worldT = (t / clipB.w) / ((1 - t) / clipA.w + t / clipB.w);
            const segment = worldSegment(matrixWorld, positions, i);
            const point = segment[0].clone().lerp(segment[1], worldT);
            if (isBehindSurface(point)) continue;
            candidates.push({ distance, segment });
            if (!best || distance < best.distance) {
                best = { distance, point, perpendicular: false, segments: [segment] };
                nearestFoot = hasFoot ? foot.clone().applyMatrix4(matrixWorld) : null;
            }
        }
    });

    const corner = best ? findCornerSnap(candidates, mouseX, mouseY, width, height, viewProjection) : null;
    return { perpendicular: bestPerpendicular, corner, nearest: best, nearestFoot };
};

// Bắt điểm vuông góc tới bề mặt: điểm 2 là chân đường vuông góc hạ từ điểm đo 1 xuống mặt phẳng của mặt đang hover
// (có thể là mặt khác của chính cấu kiện chứa điểm 1, ví dụ mặt đối diện của cột), nằm trong SURFACE_PERPENDICULAR_RADIUS_PX quanh con trỏ.
// Trả về { point, normal, snapped } hoặc null; snapped = false nghĩa là chỉ để hiển thị gợi ý (con trỏ chưa vào vùng bắt).
const snapToSurfacePerpendicular = (element) => {
    const pending = rt.dimPendingPoint;
    const bvh = element ? ensureBoundsTree(element) : null;
    if (!pending || !bvh) return null;
    element.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().copy(element.matrixWorld).invert();

    // Mặt đang hover: giao điểm tia camera với chính cấu kiện này
    const hoverHit = bvh.raycastFirst(raycaster.ray.clone().applyMatrix4(inverse), THREE.DoubleSide);
    if (!hoverHit?.face) return null;
    const normal = hoverHit.face.normal.clone().transformDirection(element.matrixWorld);
    const planePoint = hoverHit.point.clone().applyMatrix4(element.matrixWorld);
    const signedDistance = pending.clone().sub(planePoint).dot(normal);
    if (Math.abs(signedDistance) < 1e-4) return null;
    const foot = pending.clone().addScaledVector(normal, -signedDistance);

    const ndc = foot.clone().project(rt.camera);
    if (ndc.z < -1 || ndc.z > 1) return null;
    const width = Math.max(rt.renderer.domElement.clientWidth, 1);
    const height = Math.max(rt.renderer.domElement.clientHeight, 1);
    const screenDistance = Math.hypot(
        (ndc.x - mouse.x) / 2 * width,
        (ndc.y - mouse.y) / 2 * height
    );
    // Ngoài phạm vi bắt vẫn trả về điểm để hiển thị gợi ý (snapped = false), chỉ bắt thật khi trong phạm vi
    const snapped = screenDistance <= SURFACE_PERPENDICULAR_RADIUS_PX;

    // Chân đường vuông góc phải nằm trên bề mặt thật của cấu kiện (không rơi ra ngoài mép mặt)
    const originLocal = pending.clone().applyMatrix4(inverse);
    const direction = foot.clone().applyMatrix4(inverse).sub(originLocal);
    const length = direction.length();
    if (length < 1e-6) return null;
    // Điểm 1 có thể nằm ngay trên bề mặt của chính cấu kiện này (mặt đối diện): đẩy gốc tia vào trong một chút để không tự trúng mặt chứa điểm 1
    const startOffset = Math.min(1e-4, length / 4);
    direction.divideScalar(length);
    const rayHit = bvh.raycastFirst(new THREE.Ray(originLocal.addScaledVector(direction, startOffset), direction), THREE.DoubleSide);
    if (!rayHit || Math.abs(rayHit.distance - (length - startOffset)) > Math.max(1e-3, worldUnitsPerPixel(foot))) return null;
    return { point: foot, normal, snapped };
};

// Cấu kiện nằm sát con trỏ (ngoài cấu kiện đang bị chạm): thử 4 tia lệch SNAP_RADIUS_PX để lấy cả cạnh của
// cấu kiện bên cạnh, ví dụ góc giao giữa cột và dầm
const probeNearbyElements = () => {
    const width = Math.max(rt.renderer.domElement.clientWidth, 1);
    const height = Math.max(rt.renderer.domElement.clientHeight, 1);
    const elements = new Set();
    const probe = new THREE.Vector2();
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        probe.set(mouse.x + dx * SNAP_RADIUS_PX * 2 / width, mouse.y + dy * SNAP_RADIUS_PX * 2 / height);
        raycaster.setFromCamera(probe, rt.camera);
        const hits = getVisibleModelIntersections();
        const element = hits.length ? resolveHitElement(hits[0]) : null;
        if (element) elements.add(element);
    });
    raycaster.setFromCamera(mouse, rt.camera);
    return elements;
};

// Điểm đo: chỉ khi con trỏ đang chạm cấu kiện nhìn thấy (không ẩn, không bị CropBox cắt).
// Thứ tự ưu tiên: vuông góc với cạnh > góc giao các cạnh > vuông góc tới bề mặt > điểm gần nhất trên cạnh > điểm trên bề mặt.
// Trả về { point, snapType: 'edge' | 'surface-perpendicular' | 'surface', pointShape, segments?, normal?, element, hit }
// hoặc null. pointShape: 'square' (vuông góc với cạnh), 'triangle' (vuông góc tới bề mặt), null (không đặc biệt).
// Bắt đỉnh sẽ thêm ở đây.
export const pickDimensionPoint = (intersects) => {
    const hit = intersects[0] ?? null;
    if (!hit) return null;
    const hitElement = resolveHitElement(hit);
    const elements = probeNearbyElements();
    if (hitElement) elements.add(hitElement);
    const edge = elements.size ? snapToEdges(elements, hit.distance) : null;
    const surface = snapToSurfacePerpendicular(hitElement);
    // hint: vị trí điểm vuông góc chỉ để hiển thị trước (chưa bắt) khi con trỏ chưa vào vùng bắt
    const hint = {
        surface: surface && !surface.snapped ? { point: surface.point, normal: surface.normal } : null,
        edge: edge && !edge.perpendicular ? edge.nearestFoot : null
    };
    const base = { hit, element: hitElement, hint };
    if (edge?.perpendicular) return { ...base, point: edge.perpendicular.point, snapType: 'edge', pointShape: 'square', segments: edge.perpendicular.segments };
    if (edge?.corner) return { ...base, point: edge.corner.point, snapType: 'edge', pointShape: null, segments: edge.corner.segments };
    if (surface?.snapped) return { ...base, point: surface.point, snapType: 'surface-perpendicular', pointShape: 'triangle', normal: surface.normal, hint: { ...hint, surface: null } };
    if (edge?.nearest) return { ...base, point: edge.nearest.point, snapType: 'edge', pointShape: null, segments: edge.nearest.segments };
    return { ...base, point: hit.point.clone(), snapType: 'surface', pointShape: null };
};

const hidePreview = () => {
    if (!rt.dimPreview) return;
    rt.dimPreview.line.visible = false;
    rt.dimPreview.label.visible = false;
};

// Đường nối và nhãn khoảng cách chạy theo điểm đang hover (chỉ khi đã chọn điểm 1)
const updatePreview = (pointB) => {
    const preview = rt.dimPreview;
    const pointA = rt.dimPendingPoint;
    if (!preview || !pointA || !pointB) {
        hidePreview();
        return;
    }
    preview.line.geometry.setFromPoints([pointA, pointB]);
    preview.line.geometry.computeBoundingSphere();
    preview.mid.copy(pointA).add(pointB).multiplyScalar(0.5);
    preview.label.position.copy(preview.mid);
    const text = formatDimDistance(pointA.distanceTo(pointB));
    if (preview.label.userData.text !== text) setLabelText(preview.label, text);
    preview.line.visible = preview.label.visible = true;
};

export const updateDimensionHover = (intersects) => {
    const marker = rt.dimHoverMarker;
    if (!marker) return;
    const pick = pickDimensionPoint(intersects);
    marker.visible = !!pick;
    const snapped = !!pick && pick.snapType !== 'surface';
    if (pick) {
        marker.position.copy(pick.point);
        marker.material.color.setHex(snapped ? HOVER_SNAP_COLOR : HOVER_COLOR);
        marker.material.opacity = snapped ? 1 : 0.85;
    }
    // Cạnh đang được bắt: tô vàng
    const snapLine = rt.dimSnapLine;
    snapLine.visible = !!pick?.segments;
    if (pick?.segments) {
        snapLine.geometry.setPositions(pick.segments.flatMap(segment => segment.flatMap(point => [point.x, point.y, point.z])));
    }
    // Vùng tròn vàng nằm trên mặt mesh tại điểm vuông góc tới bề mặt: đậm khi đang bắt, nhạt khi chỉ là gợi ý (chưa vào vùng bắt)
    const disc = rt.dimSurfaceDisc;
    const discSource = pick?.snapType === 'surface-perpendicular' ? pick : pick?.hint?.surface;
    disc.visible = !!discSource;
    if (discSource) {
        rt.camera.updateMatrixWorld();
        // Nhấc nhẹ về phía camera để không bị z-fighting với mặt mesh
        const toCamera = rt.camera.position.clone().sub(discSource.point);
        const lift = worldUnitsPerPixel(discSource.point) * 0.25 * (discSource.normal.dot(toCamera) >= 0 ? 1 : -1);
        disc.position.copy(discSource.point).addScaledVector(discSource.normal, lift);
        disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), discSource.normal);
        disc.material.opacity = discSource === pick ? 0.6 : 0.35;
    }
    // Gợi ý điểm vuông góc trên cạnh đang hover (chưa bắt)
    const edgeHint = rt.dimEdgeHint;
    edgeHint.visible = !!pick?.hint?.edge;
    if (edgeHint.visible) edgeHint.position.copy(pick.hint.edge);
    // Điểm 2 bắt vuông góc: dấu hình vuông / tam giác ở góc phải trên con trỏ
    Object.entries(rt.dimShapeMarkers).forEach(([shape, shapeMarker]) => {
        shapeMarker.visible = pick?.pointShape === shape;
        if (!shapeMarker.visible) return;
        rt.camera.updateMatrixWorld();
        const right = new THREE.Vector3().setFromMatrixColumn(rt.camera.matrixWorld, 0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(rt.camera.matrixWorld, 1).normalize();
        const offset = HOVER_RADIUS_PX * 2 * worldUnitsPerPixel(pick.point);
        shapeMarker.position.copy(pick.point).addScaledVector(right, offset).addScaledVector(up, offset);
    });
    updatePreview(pick?.point);
    updateDimensionScales();
    requestRender();
    return pick;
};

export const clearDimensionHover = () => {
    if (rt.dimHoverMarker?.visible || rt.dimSnapLine?.visible || rt.dimPreview?.line.visible) {
        rt.dimHoverMarker.visible = false;
        rt.dimSnapLine.visible = false;
        rt.dimSurfaceDisc.visible = false;
        rt.dimEdgeHint.visible = false;
        Object.values(rt.dimShapeMarkers).forEach(shapeMarker => { shapeMarker.visible = false; });
        hidePreview();
        requestRender();
    }
};

export const cancelPendingDimension = () => {
    rt.dimPendingPoint = null;
    rt.dimPendingElement = null;
    if (rt.dimPendingMarker) rt.dimPendingMarker.visible = false;
    hidePreview();
    requestRender();
};

export const addDimension = (pointA, pointB, pointShape = null) => {
    const item = {
        id: ++rt.dimSequence,
        p1: pointA.toArray(),
        p2: pointB.toArray(),
        distance: pointA.distanceTo(pointB),
        pointShape
    };
    dimItems.value.push(item);
    buildDimensionObjects(item);
    updateDimensionScales();
    requestRender();
    return item;
};

// Click khi đang ở chế độ đo: lần 1 chọn điểm đầu, lần 2 chọn điểm cuối và tạo nhóm đo
export const handleDimensionClick = (intersects) => {
    const pick = pickDimensionPoint(intersects);
    if (!pick) return;
    if (!rt.dimPendingPoint) {
        rt.dimPendingPoint = pick.point;
        rt.dimPendingElement = pick.element;
        rt.dimPendingMarker.position.copy(pick.point);
        rt.dimPendingMarker.visible = true;
        updateDimensionScales();
        requestRender();
        return;
    }
    const pointA = rt.dimPendingPoint;
    cancelPendingDimension();
    if (pointA.distanceTo(pick.point) < 1e-6) return;
    const item = addDimension(pointA, pick.point, pick.pointShape);
    selectedDimId.value = item.id;
    applyDimensionColors();
};

export const removeDimension = (id) => {
    const objects = dimObjects.get(id);
    if (objects) {
        dimGroup.remove(objects.group);
        objects.sphereA.material.dispose();
        objects.sphereB.material.dispose();
        objects.line.geometry.dispose();
        objects.line.material.dispose();
        objects.label.material.map.dispose();
        objects.label.material.dispose();
        dimObjects.delete(id);
    }
    dimItems.value = dimItems.value.filter(item => item.id !== id);
    if (selectedDimId.value === id) selectedDimId.value = null;
    requestRender();
};

// Tọa độ dự án (hệ xây dựng X, Y, Z-up, mét) của một điểm đo world, để hiển thị trong danh sách
export const formatDimCoords = (point) => worldToProjectCoords(new THREE.Vector3(...point)).toArray().map(v => v.toFixed(3)).join(', ');

// Điểm đo lưu theo tọa độ world nên phải đi theo model khi model đổi vị trí (căn giữa lại lúc thêm/xóa file, dịch chuyển/xoay).
// Gọi sau mỗi lần ma trận world của modelGroup có thể đã đổi: so với lần trước và áp phần chênh lên mọi điểm đo.
const lastModelFrame = new THREE.Matrix4();
let hasModelFrame = false;
export const syncDimensionsToModelFrame = () => {
    if (!rt.modelGroup) return;
    rt.modelGroup.updateWorldMatrix(true, false);
    const frame = rt.modelGroup.matrixWorld;
    if (!hasModelFrame) {
        lastModelFrame.copy(frame);
        hasModelFrame = true;
        return;
    }
    if (lastModelFrame.equals(frame)) return;
    const delta = frame.clone().multiply(lastModelFrame.clone().invert());
    lastModelFrame.copy(frame);

    dimItems.value.forEach(item => {
        const pointA = new THREE.Vector3(...item.p1).applyMatrix4(delta);
        const pointB = new THREE.Vector3(...item.p2).applyMatrix4(delta);
        item.p1 = pointA.toArray();
        item.p2 = pointB.toArray();
        const objects = dimObjects.get(item.id);
        if (!objects) return;
        objects.sphereA.position.copy(pointA);
        objects.sphereB.position.copy(pointB);
        objects.line.geometry.setFromPoints([pointA, pointB]);
        objects.line.geometry.computeBoundingSphere();
        objects.mid.copy(pointA).add(pointB).multiplyScalar(0.5);
        objects.label.position.copy(objects.mid);
    });
    if (rt.dimPendingPoint) {
        rt.dimPendingPoint.applyMatrix4(delta);
        rt.dimPendingMarker?.position.copy(rt.dimPendingPoint);
    }
    updateDimensionScales();
    requestRender();
};

// Xóa toàn bộ nhóm đo và điểm đo 1 đang chờ (khi thay model: tọa độ đo thuộc model cũ)
export const clearAllDimensions = () => {
    cancelPendingDimension();
    dimItems.value.map(item => item.id).forEach(removeDimension);
};

// Chọn nhóm đo trong danh sách: tô màu nổi bật và zoom vào khoảng đo, giữ hướng nhìn hiện tại
export const zoomToDimension = (item) => {
    if (!item || !rt.camera || !rt.controls || !rt.renderer) return;
    selectedDimId.value = item.id;
    applyDimensionColors();
    const pointA = new THREE.Vector3(...item.p1);
    const pointB = new THREE.Vector3(...item.p2);
    const center = pointA.clone().add(pointB).multiplyScalar(0.5);
    const radius = Math.max(item.distance * 0.5, 0.025);
    const direction = rt.camera.position.clone().sub(rt.controls.target).normalize();
    if (direction.lengthSq() < 0.001) direction.set(1, 0.7, 1).normalize();
    const aspect = Math.max(rt.renderer.domElement.clientWidth / Math.max(rt.renderer.domElement.clientHeight, 1), 0.1);
    if (isOrthographic.value) {
        const halfHeight = Math.max(radius * 1.6, radius * 1.6 / aspect, 0.05);
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
        const distance = Math.max(radius / Math.sin(fov / 2) * 1.6, 0.5);
        rt.camera.position.copy(center).addScaledVector(direction, distance);
        rt.camera.near = Math.max(radius / 1000, 0.001);
        rt.camera.far = Math.max(distance + radius * 20, 100);
        rt.camera.updateProjectionMatrix();
    }
    rt.controls.target.copy(center);
    rt.controls.update();
    requestRender();
};

// Phím D: bật/tắt chế độ đo. Tắt thì ẩn toàn bộ hiển thị đo nhưng giữ nguyên danh sách.
export const toggleDimensionMode = () => {
    dimModeActive.value = !dimModeActive.value;
    dimGroup.visible = dimModeActive.value;
    if (dimModeActive.value) {
        leftActiveTab.value = 'dimension';
        ensureIntersectionEdges();
        if (rt.hoveredMesh && !isMeshSelected(rt.hoveredMesh)) restoreMeshMaterial(rt.hoveredMesh);
        rt.hoveredMesh = null;
        if (rt.renderer) rt.renderer.domElement.style.cursor = 'grab';
    } else {
        cancelPendingDimension();
        clearDimensionHover();
        if (rt.renderer) rt.renderer.domElement.style.cursor = 'default';
    }
    requestRender();
};
