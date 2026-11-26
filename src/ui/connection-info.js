import * as THREE from 'three';
import { computed, watch } from 'vue';
import { getMeshKey, getObjectMeshes, requestRender } from '../core/helpers.js';
import { getConnectorCode } from '../clash/clash.js';
import { buildConnectionIndex, explainConnectorShape, getConnectorPrism, isBarMesh, isConnectorMesh } from '../ifc/rebar-connections.js';
import { applyHoverMaterial, removeElementOverlay } from '../scene/rendering.js';
import { fitCameraToSelectedObjects } from '../scene/scene.js';
import { handleMeshSelection, isMeshPendingRemoval, isMeshSelected } from '../selection/selection.js';
import { connectionTarget, coordVersion, exportListVersion, hoveredType, rt, selectedObject } from '../state/state.js';
import { t } from '../i18n/index.js';

// --- PANEL THUỘC TÍNH: LIÊN KẾT THÉP ↔ THÉP CHỦ ---
// Chọn thép: liệt kê coupler / đầu ren nhận thanh làm thép chủ. Chọn liên kết: liệt kê thép chủ (lệch trục) và
// các liên kết cùng mối nối. Cấu kiện nhỏ không phải thép mà không được nhận là liên kết: ghi lý do bị loại, để
// người dùng dò file chưa khớp logic nhận diện (src/ifc/rebar-connections.js).
// Tính cục bộ quanh cấu kiện đang chọn (chỉ các liên kết / thanh có hộp bao giao vùng xét), theo vị trí hiện tại.

// Cấu kiện không phải thép lớn hơn mức này (đường chéo hộp bao, m) thì không ghi lý do (tường, sàn...)
const EXPLAIN_MAX_DIAGONAL = 1;

const REASON_TEXT = {
    'no-geometry': 'không có hình học',
    'triangles': 'số tam giác {0} ngoài khoảng 8–{1}',
    'vertices': 'số đỉnh {0} > {1}',
    'too-big': 'hộp bao {0} mm > {1} mm',
    'no-base': 'không có mặt đáy trội: nhóm tam giác cùng pháp tuyến lớn nhất {0}, nhóm kế tiếp {1} (cần ≥ 6 và ≥ 1,5 lần nhóm kế tiếp)',
    'unique-vertices': 'số đỉnh khác nhau {0} (cần 6–600)',
    'degenerate': 'suy biến (Ø {0} mm, dài {1} mm)',
    'not-round': 'đỉnh không cách đều trục: bán kính {0}–{1} mm (lệch cho phép {2}%)',
    'radius-limit': 'Ø ngoài {0} mm > {1} mm',
    'length-limit': 'dài {0} mm > {1} mm'
};
const reasonText = (reason) => t(REASON_TEXT[reason.code] || reason.code, reason.params);

const worldBoxOf = (mesh, cache) => {
    let box = cache.get(mesh);
    if (!box) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        cache.set(mesh, box);
    }
    return box;
};

// Hộp bao lòng lăng trụ nới theo bán kính (world), đúng vùng buildConnectionIndex dò thanh
const prismBoxOf = (mesh) => {
    const prism = getConnectorPrism(mesh);
    const end = prism.start.clone().addScaledVector(prism.axis, prism.length);
    return new THREE.Box3().setFromPoints([prism.start, end]).expandByScalar(prism.radius);
};

const formatPrismDims = (meshes) => meshes.map(mesh => {
    const prism = mesh.userData.roundPrism;
    const scale = mesh.matrixWorld.getMaxScaleOnAxis();
    return `Ø${Math.round(prism.radius * 2 * scale * 1000)}×${Math.round(prism.length * scale * 1000)}`;
}).join(' + ') + ' mm';

// "2/5": thanh thứ mấy trong cấu kiện IFC (một IfcReinforcingBar có thể chứa nhiều thanh)
const partOf = (mesh) => {
    const siblings = getObjectMeshes(mesh);
    return siblings.length > 1 ? `${siblings.indexOf(mesh) + 1}/${siblings.length}` : '';
};

const barLabel = (bar) => `Pos ${bar.userData.tag || '?'} · Ø${bar.userData.diameter || '?'}`;

const hostItem = (bar, offset) => ({
    id: bar.uuid,
    mesh: bar,
    highlight: [bar],
    label: barLabel(bar),
    name: bar.userData.name || '',
    expressID: bar.userData.expressID,
    part: partOf(bar),
    offsetMm: offset === null || offset === undefined ? null : (offset * 1000).toFixed(1),
    hidden: !bar.visible,
    removed: isMeshPendingRemoval(bar),
    hoverText: `${barLabel(bar)} #${bar.userData.expressID}`
});

// involved: các thanh của cấu kiện đang chọn mà liên kết nhận làm thép chủ (ghi số thứ tự thanh)
const connectorItem = (meshes, hosts, involved = []) => {
    const rep = meshes[0];
    const ud = rep.userData;
    const code = getConnectorCode(ud);
    return {
        id: getMeshKey(rep),
        mesh: rep,
        highlight: meshes,
        label: code,
        name: ud.name && ud.name !== code ? ud.name : '',
        expressID: ud.expressID,
        dims: formatPrismDims(meshes),
        hostCount: hosts.size,
        via: involved.map(partOf).filter(Boolean).join(', '),
        hidden: !meshes.some(mesh => mesh.visible),
        removed: isMeshPendingRemoval(rep),
        hoverText: `${code} #${ud.expressID}`
    };
};

// Cấu kiện không phải thép, không phải liên kết: lý do từng phần bị loại (null nếu cấu kiện lớn)
const explainRejected = (elementMeshes, boxes) => {
    const box = new THREE.Box3();
    elementMeshes.forEach(mesh => box.union(worldBoxOf(mesh, boxes)));
    if (box.isEmpty() || box.getSize(new THREE.Vector3()).length() > EXPLAIN_MAX_DIAGONAL) return null;
    const reasons = [];
    elementMeshes.forEach((mesh, index) => {
        const { reason } = explainConnectorShape(mesh);
        if (reason) reasons.push({ part: index + 1, text: reasonText(reason) });
    });
    if (reasons.length === 0) return null;
    return { role: 'rejected', parts: elementMeshes.length, reasons };
};

const groupByElement = (meshes) => {
    const groups = new Map();
    meshes.forEach(mesh => {
        const key = getMeshKey(mesh);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(mesh);
    });
    return groups;
};

export const describeConnections = (target) => {
    const elementMeshes = getObjectMeshes(target).filter(mesh => mesh.parent && mesh.geometry?.attributes?.position);
    if (elementMeshes.length === 0 || !rt.modelGroup) return null;
    rt.modelGroup.updateMatrixWorld();
    const boxes = new Map();
    const isConnector = elementMeshes.every(isConnectorMesh);
    const isBar = elementMeshes.some(isBarMesh);
    if (!isConnector && !isBar) return explainRejected(elementMeshes, boxes);

    const all = rt.modelGroup.children.filter(child => child.isMesh && child.geometry?.attributes?.position);
    const regions = isConnector
        ? elementMeshes.map(mesh => prismBoxOf(mesh).expandByScalar(0.01))
        : elementMeshes.map(mesh => worldBoxOf(mesh, boxes));
    // Chọn thép: so với hộp lòng lăng trụ (nới theo bán kính, giống buildConnectionIndex) chứ không với hộp mesh
    // liên kết, vì thanh dừng cách mặt đầu coupler ≤ 4 mm vẫn là thép chủ mà hộp bao hai bên không giao nhau
    const nearConnectors = all.filter(mesh => isConnectorMesh(mesh)
        && regions.some(region => region.intersectsBox(isConnector ? worldBoxOf(mesh, boxes) : prismBoxOf(mesh))));
    const ud = target.userData;
    // Thép xếp theo tên (Name/ObjectType có BAR, REBAR...) mà kiểu IFC gốc khác: không bao giờ được xét là liên kết
    const schemaType = String(ud.schemaType || '').toUpperCase();
    const note = isBar && schemaType && schemaType !== 'IFCREINFORCINGBAR'
        ? t('Xếp là thép theo tên / kiểu ({0}) nên không được xét là liên kết thép.', [ud.schemaType])
        : '';
    if (isBar && nearConnectors.length === 0) return { role: 'bar', connectors: [], note };

    const probeRegions = nearConnectors.map(prismBoxOf);
    const nearBars = all.filter(mesh => isBarMesh(mesh) && probeRegions.some(region => region.intersectsBox(worldBoxOf(mesh, boxes))));
    const index = buildConnectionIndex([...nearConnectors, ...nearBars]);
    const connectorGroups = groupByElement(nearConnectors);

    if (isBar) {
        const own = new Set(elementMeshes);
        const connectors = [];
        connectorGroups.forEach(meshes => {
            const hosts = index.hostsOf(meshes[0]) || new Set();
            const involved = Array.from(hosts).filter(host => own.has(host));
            if (involved.length) connectors.push(connectorItem(meshes, hosts, involved));
        });
        return { role: 'bar', connectors, note };
    }

    const ownKey = getMeshKey(target);
    const hosts = index.hostsOf(elementMeshes[0]) || new Set();
    const joint = [];
    connectorGroups.forEach((meshes, key) => {
        if (key === ownKey) return;
        const otherHosts = index.hostsOf(meshes[0]) || new Set();
        if (Array.from(otherHosts).some(host => hosts.has(host))) joint.push(connectorItem(meshes, otherHosts));
    });
    return {
        role: 'connector',
        dims: formatPrismDims(elementMeshes),
        hosts: Array.from(hosts, bar => hostItem(bar, index.hostOffsetOf(elementMeshes[0], bar))),
        joint
    };
};

export const selectedConnections = computed(() => {
    coordVersion.value;
    exportListVersion.value;
    const target = connectionTarget.value;
    if (!target || !selectedObject.value || !target.parent || target.userData.isDemo) return null;
    try {
        return describeConnections(target);
    } catch (error) {
        console.warn('Không tìm được liên kết thép của cấu kiện:', error);
        return null;
    }
});

// --- Tương tác với dòng trong danh sách: rê chuột tô sáng đúng thanh / liên kết, click chọn, double-click zoom ---
let hoveredItem = null;

export const onConnectionItemLeave = () => {
    if (!hoveredItem) return;
    hoveredItem.highlight.forEach(mesh => {
        if (!isMeshSelected(mesh)) removeElementOverlay(mesh);
    });
    hoveredItem = null;
    hoveredType.value = '';
    requestRender();
};

export const onConnectionItemEnter = (item) => {
    onConnectionItemLeave();
    hoveredItem = item;
    const members = item.highlight.filter(mesh => mesh.parent && mesh.visible && !isMeshSelected(mesh));
    if (members.length) applyHoverMaterial(item.mesh, members);
    hoveredType.value = item.hoverText;
    requestRender();
};

export const onConnectionItemClick = (item, event) => {
    onConnectionItemLeave();
    handleMeshSelection(item.mesh, !!(event && (event.ctrlKey || event.metaKey)));
};

export const onConnectionItemDblClick = (item) => {
    onConnectionItemLeave();
    handleMeshSelection(item.mesh);
    fitCameraToSelectedObjects();
};

// Danh sách đổi (chọn cấu kiện khác, bỏ chọn) thì dòng đang rê có thể biến mất mà không có mouseleave
watch(selectedObject, onConnectionItemLeave);
