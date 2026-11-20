import { nextTick } from 'vue';
import * as WebIFC from 'web-ifc';
import * as THREE from 'three';
import { clearClashResults } from '../clash/clash.js';
import { ifcToThree, threeToIfc } from '../core/coords.js';
import { syncDimensionsToModelFrame } from '../dimension/dimension.js';
import { resetCropBoxToModel } from '../scene/cropbox.js';
import { ensureIntersectionEdges, invalidateIntersectionEdges } from '../scene/intersections.js';
import { requestRender } from '../core/helpers.js';
import { centerModelByBoundingBox } from './loader.js';
import { rebuildBatches } from '../scene/rendering.js';
import { fitCameraToModel } from '../scene/scene.js';
import { updateSelectionOutlines } from '../selection/selection.js';
import { clashModeActive, deletedItems, dimModeActive, showEdges, editHistoryCount, edgesGroup, hasUnsavedChanges, isCropBoxActive, rt, showTransportProfileModal, sourceFiles, transportHistory, transportInputFields, transportInputs, transportProfileName, transportProfileNameInput, transportProfileStorageKey, transportProfiles, transportRotationAxis } from '../state/state.js';
import { showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';

export const createTransportProfileId = () => `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const getTransportInputValues = () => {
    const values = {};
    transportInputFields.forEach(field => {
        const input = transportInputs[field];
        if (input === '' || input === null || !Number.isFinite(Number(input))) {
            throw new Error(t('Giá trị "{0}" phải là một số hợp lệ.', [field]));
        }
        values[field] = Number(input);
    });
    return values;
};

export const normalizeTransportProfile = (profile) => {
    if (!profile || typeof profile.name !== 'string' || !profile.name.trim()) {
        throw new Error(t('Mỗi profile cần có tên.'));
    }
    const values = {};
    transportInputFields.forEach(field => {
        if (profile[field] === '' || profile[field] === null || !Number.isFinite(Number(profile[field]))) {
            throw new Error(t('Profile "{0}" có giá trị "{1}" không hợp lệ.', [profile.name, field]));
        }
        values[field] = Number(profile[field]);
    });
    return {
        id: typeof profile.id === 'string' && profile.id ? profile.id : createTransportProfileId(),
        name: profile.name.trim(),
        ...values,
        createdAt: typeof profile.createdAt === 'string' ? profile.createdAt : new Date().toISOString()
    };
};

// Profile mẫu có sẵn từ lần đầu mở web (nạp một lần, xóa đi sẽ không tự xuất hiện lại); đơn vị cm.
// Đổi giá trị mẫu thì tăng hậu tố phiên bản của SEEDED_PROFILES_KEY để ghi đè bản đã nạp trước đó.
const SEEDED_PROFILES_KEY = `${transportProfileStorageKey}:seeded-v2`;
const SEED_TRANSPORT_PROFILES = [{
    id: 'builtin-allplan-s21',
    name: 'Allplan 👉🏻 S21',
    centerX: 3009.245,
    centerY: 883.618,
    centerZ: 0,
    angleDegrees: -292.913,
    vectorX: 2269742.68,
    vectorY: 2202456.38,
    vectorZ: 0
}];

export const loadTransportProfiles = () => {
    try {
        const stored = localStorage.getItem(transportProfileStorageKey);
        const parsed = stored ? JSON.parse(stored) : [];
        if (!Array.isArray(parsed)) throw new Error(t('Danh sách profile đã lưu không đúng định dạng.'));
        transportProfiles.value = parsed.map(normalizeTransportProfile);
        if (!localStorage.getItem(SEEDED_PROFILES_KEY)) {
            const seedIds = new Set(SEED_TRANSPORT_PROFILES.map(profile => profile.id));
            transportProfiles.value = [
                ...transportProfiles.value.filter(profile => !seedIds.has(profile.id)),
                ...SEED_TRANSPORT_PROFILES.map(normalizeTransportProfile)
            ];
            persistTransportProfiles();
            localStorage.setItem(SEEDED_PROFILES_KEY, '1');
        }
    } catch (error) {
        console.error('Không thể đọc profile transport từ localStorage:', error);
        showToast(t('Lỗi đọc profile'), error.message || t('Không thể đọc các profile đã lưu.'));
    }
};

export const persistTransportProfiles = () => {
    try {
        localStorage.setItem(transportProfileStorageKey, JSON.stringify(transportProfiles.value));
        return true;
    } catch (error) {
        console.error('Không thể lưu profile transport:', error);
        showToast(t('Lỗi lưu profile'), error.message || t('Không thể lưu profile vào localStorage.'));
        return false;
    }
};

export const openTransportProfileDialog = async () => {
    try {
        getTransportInputValues();
        transportProfileName.value = '';
        showTransportProfileModal.value = true;
        await nextTick();
        transportProfileNameInput.value?.focus();
    } catch (error) {
        showToast(t('Thông số không hợp lệ'), error.message);
    }
};

export const saveTransportProfile = () => {
    const name = transportProfileName.value.trim();
    if (!name) {
        showToast(t('Thiếu tên profile'), t('Nhập tên cho bộ tọa độ trước khi lưu.'));
        return;
    }
    try {
        const profile = normalizeTransportProfile({
            id: createTransportProfileId(),
            name,
            ...getTransportInputValues()
        });
        const previous = transportProfiles.value;
        transportProfiles.value = [profile, ...previous];
        if (!persistTransportProfiles()) {
            transportProfiles.value = previous;
            return;
        }
        showTransportProfileModal.value = false;
        showToast(t('Đã lưu profile'), t('Đã lưu bộ tọa độ "{0}" vào localStorage.', [name]), 'success');
    } catch (error) {
        showToast(t('Không thể lưu profile'), error.message);
    }
};

export const useTransportProfile = (profile) => {
    const normalized = normalizeTransportProfile(profile);
    transportInputFields.forEach(field => { transportInputs[field] = normalized[field]; });
    showToast(t('Đã nạp profile'), t('Đã điền thông số từ "{0}".', [profile.name]), 'success');
};

export const deleteTransportProfile = (profile) => {
    const previous = transportProfiles.value;
    transportProfiles.value = previous.filter(item => item.id !== profile.id);
    if (!persistTransportProfiles()) transportProfiles.value = previous;
};

export const exportTransportProfiles = () => {
    if (transportProfiles.value.length === 0) return;
    try {
        const payload = JSON.stringify({ version: 1, profiles: transportProfiles.value }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ifc-transport-profiles.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(t('Đã xuất JSON'), t('Đã xuất {0} profile.', [transportProfiles.value.length]), 'success');
    } catch (error) {
        console.error('Không thể xuất JSON profile:', error);
        showToast(t('Lỗi xuất JSON'), error.message || t('Không thể xuất file profile.'));
    }
};

export const importTransportProfiles = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        const parsed = JSON.parse(await file.text());
        const incoming = Array.isArray(parsed) ? parsed : parsed?.profiles;
        if (!Array.isArray(incoming)) throw new Error(t('JSON phải chứa một mảng profiles.'));
        const normalized = incoming.map(normalizeTransportProfile);
        const existingIds = new Set(transportProfiles.value.map(profile => profile.id));
        normalized.forEach(profile => {
            if (existingIds.has(profile.id)) profile.id = createTransportProfileId();
            existingIds.add(profile.id);
        });
        const previous = transportProfiles.value;
        transportProfiles.value = [...normalized, ...previous];
        if (!persistTransportProfiles()) {
            transportProfiles.value = previous;
            return;
        }
        showToast(t('Đã nhập JSON'), t('Đã nhập {0} profile.', [normalized.length]), 'success');
    } catch (error) {
        console.error('Không thể nhập JSON profile:', error);
        showToast(t('Lỗi nhập JSON'), error.message || t('File JSON profile không hợp lệ.'));
    }
};

export const unwrapIfcValue = (value) => value && typeof value === 'object' && 'value' in value ? value.value : value;
export const getIfcLengthUnitInMeters = (modelID) => {
    const projects = rt.ifcAPI.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT, true);
    if (projects.size() === 0) return 1;
    const project = rt.ifcAPI.GetLine(modelID, projects.get(0), false);
    const assignmentID = unwrapIfcValue(project?.UnitsInContext);
    if (!assignmentID) return 1;
    const assignment = rt.ifcAPI.GetLine(modelID, assignmentID, false);
    const lengthUnitRef = (assignment?.Units || []).find(reference => {
        const unit = rt.ifcAPI.GetLine(modelID, unwrapIfcValue(reference), false);
        return unwrapIfcValue(unit?.UnitType) === 'LENGTHUNIT';
    });
    if (!lengthUnitRef) return 1;

    const prefixes = {
        EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6,
        KILO: 1e3, HECTO: 1e2, DECA: 1e1, DECI: 1e-1,
        CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9,
        PICO: 1e-12
    };
    const resolveUnitScale = (unitID, visited = new Set()) => {
        if (!unitID || visited.has(unitID)) return null;
        visited.add(unitID);
        const unit = rt.ifcAPI.GetLine(modelID, unitID, false);
        if (!unit) return null;
        const typeName = (rt.ifcAPI.GetNameFromTypeCode(rt.ifcAPI.GetLineType(modelID, unitID)) || '').toUpperCase();
        if (typeName === 'IFCSIUNIT') {
            if (unwrapIfcValue(unit.Name) !== 'METRE') return null;
            const prefix = unwrapIfcValue(unit.Prefix);
            return prefix ? prefixes[prefix] || null : 1;
        }
        if (!typeName.includes('CONVERSIONBASEDUNIT')) return null;
        const conversion = rt.ifcAPI.GetLine(modelID, unwrapIfcValue(unit.ConversionFactor), false);
        const factor = Number(unwrapIfcValue(conversion?.ValueComponent));
        const baseUnitID = unwrapIfcValue(conversion?.UnitComponent);
        const baseScale = resolveUnitScale(baseUnitID, visited);
        return Number.isFinite(factor) && baseScale ? factor * baseScale : null;
    };

    const scale = resolveUnitScale(unwrapIfcValue(lengthUnitRef));
    if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(t('Không xác định được đơn vị chiều dài IFC; không thể chuyển đổi tọa độ an toàn.'));
    }
    return scale;
};

export const getIfcRootPlacementIds = (modelID) => {
    const placementIds = rt.ifcAPI.GetLineIDsWithType(modelID, WebIFC.IFCLOCALPLACEMENT, true);
    const roots = [];
    for (let index = 0; index < placementIds.size(); index++) {
        const expressID = placementIds.get(index);
        const placement = rt.ifcAPI.GetLine(modelID, expressID, false);
        if (placement && !unwrapIfcValue(placement.PlacementRelTo)) roots.push(expressID);
    }
    return roots;
};

// Ma trận transport theo từng file IFC (hệ tuyệt đối của dự án, trục three). Không có = chưa dịch chuyển.
// Dịch chuyển chỉ áp cho các file đang mở tại thời điểm bấm; file mở thêm sau đó giữ nguyên vị trí.
const sourceTransports = new Map();
export const getSourceTransportMatrix = (sourceId) => sourceTransports.get(sourceId) ?? null;
export const forgetSourceTransport = (sourceId) => { sourceTransports.delete(sourceId); };

export const applyIfcTransportToModel = (modelID, unitMeters, transportMatrix) => {
    if (!transportMatrix) return;
    const roots = getIfcRootPlacementIds(modelID);
    if (roots.length === 0) throw new Error(t('Không tìm thấy IfcLocalPlacement gốc để áp dụng tọa độ transport.'));

    const elements = transportMatrix.elements;
    // transportMatrix ở hệ three (Y-up): đổi về hệ IFC (Z-up) trước khi ghi vào placement
    const origin = threeToIfc(new THREE.Vector3(elements[12], elements[13], elements[14])).divideScalar(unitMeters);
    const { x, y, z } = origin;
    // Axis = trục Z của IFC (= trục Y của three) sau dịch chuyển, RefDirection = trục X: lấy cột tương ứng của ma trận
    const axisDirection = threeToIfc(new THREE.Vector3(elements[4], elements[5], elements[6])).normalize();
    const referenceDirection = threeToIfc(new THREE.Vector3(elements[0], elements[1], elements[2])).normalize();
    const writeEntity = (typeCode, attributes) => {
        const entity = rt.ifcAPI.CreateIfcEntity(modelID, typeCode);
        Object.assign(entity, attributes);
        rt.ifcAPI.WriteLine(modelID, entity);
        if (!Number.isInteger(entity.expressID) || entity.expressID < 0) {
            throw new Error(t('Không thể tạo thực thể IFC {0}.', [rt.ifcAPI.GetNameFromTypeCode(typeCode)]));
        }
        return entity.expressID;
    };
    const real = value => ({ type: WebIFC.REAL, value });
    const reference = value => ({ type: WebIFC.REF, value });
    const pointID = writeEntity(WebIFC.IFCCARTESIANPOINT, {
        Coordinates: [real(x), real(y), real(z)]
    });
    const axisID = writeEntity(WebIFC.IFCDIRECTION, {
        DirectionRatios: [
            real(axisDirection.x),
            real(axisDirection.y),
            real(axisDirection.z)
        ]
    });
    const directionID = writeEntity(WebIFC.IFCDIRECTION, {
        DirectionRatios: [referenceDirection.x, referenceDirection.y, referenceDirection.z].map(real)
    });
    const axisPlacementID = writeEntity(WebIFC.IFCAXIS2PLACEMENT3D, {
        Location: reference(pointID),
        Axis: reference(axisID),
        RefDirection: reference(directionID)
    });
    const rootPlacementID = writeEntity(WebIFC.IFCLOCALPLACEMENT, {
        PlacementRelTo: null,
        RelativePlacement: reference(axisPlacementID)
    });

    roots.forEach(expressID => {
        const placement = rt.ifcAPI.GetLine(modelID, expressID, false);
        placement.PlacementRelTo = reference(rootPlacementID);
        rt.ifcAPI.WriteLine(modelID, placement);
    });
};

// Cập nhật các thứ phụ thuộc vị trí model sau khi căn giữa lại (dịch chuyển nằm sẵn trong ma trận từng cấu kiện)
export const updateTransportScene = () => {
    syncDimensionsToModelFrame();
    updateSelectionOutlines();
};

export const resetTransportState = () => {
    sourceTransports.clear();
    transportHistory.value = [];
};

// Phép dịch chuyển từng lượt: id lượt -> { matrix (hệ tuyệt đối), sourceIds }, để hoàn tác
const historyOperations = new Map();

// Áp phép dịch chuyển (hệ tuyệt đối dự án, trục three) lên các file được chọn: cộng dồn vào ma trận của file
// (dùng khi xuất IFC) và dời trực tiếp ma trận từng cấu kiện của file đó trong scene.
const moveSources = (sourceIds, operationMatrix) => {
    const ids = new Set(sourceIds);
    // Scene dời gốc theo modelRebaseOrigin: ma trận trong scene = T(-R) · M · T(R)
    const origin = rt.modelRebaseOrigin ?? new THREE.Vector3();
    const sceneMatrix = new THREE.Matrix4()
        .makeTranslation(-origin.x, -origin.y, -origin.z)
        .multiply(operationMatrix)
        .multiply(new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z));

    ids.forEach(sourceId => {
        const next = operationMatrix.clone().multiply(sourceTransports.get(sourceId) ?? new THREE.Matrix4());
        const isIdentity = next.elements.every((value, i) => Math.abs(value - (i % 5 === 0 ? 1 : 0)) < 1e-9);
        if (isIdentity) sourceTransports.delete(sourceId);
        else sourceTransports.set(sourceId, next);
    });

    rt.modelGroup.children.forEach(mesh => {
        if (!mesh.isMesh || !ids.has(mesh.userData.sourceId)) return;
        mesh.updateMatrix();
        mesh.applyMatrix4(sceneMatrix);
    });
    // Viền cấu kiện sao chép ma trận lúc tạo nên phải cập nhật theo
    edgesGroup.children.forEach(line => {
        const parent = line.userData.parentMesh;
        if (!parent || line.userData.pairMesh || !ids.has(parent.userData.sourceId)) return;
        parent.updateMatrix();
        line.matrix.copy(parent.matrix);
        line.matrixWorldNeedsUpdate = true;
    });
    invalidateIntersectionEdges();
    centerModelByBoundingBox();
    rebuildBatches();
    // Đường giao chỉ tính lại khi đang cần (hiện viền hoặc đang đo đạc)
    if (showEdges.value || dimModeActive.value) ensureIntersectionEdges();
    if (clashModeActive.value) clearClashResults();
    fitCameraToModel();
    if (isCropBoxActive.value) resetCropBoxToModel();
    requestRender();
};

export const applyTransport = () => {
    if (clashModeActive.value) clearClashResults();
    if (sourceFiles.value.length === 0) {
        showToast(t('Chưa có file IFC'), t('Mở ít nhất một file IFC trước khi dịch chuyển.'));
        return;
    }
    try {
        const values = getTransportInputValues();
        if (values.angleDegrees % 360 === 0 && values.vectorX === 0 && values.vectorY === 0 && values.vectorZ === 0) {
            showToast(t('Không có thay đổi'), t('Nhập góc xoay hoặc vector dịch chuyển khác 0 trước khi dịch chuyển.'));
            return;
        }
        sourceFiles.value.forEach(source => {
            if (getIfcRootPlacementIds(source.modelID).length === 0) {
                throw new Error(t('Không tìm thấy placement gốc trong "{0}".', [source.name]));
            }
        });

        // Nhập theo hệ IFC (X, Y, Z-up, cm) -> đổi sang trục three (m)
        const center = ifcToThree(values.centerX / 100, values.centerY / 100, values.centerZ / 100);
        const movement = ifcToThree(values.vectorX / 100, values.vectorY / 100, values.vectorZ / 100);
        const rotation = new THREE.Matrix4().makeRotationAxis(
            transportRotationAxis,
            -THREE.MathUtils.degToRad(values.angleDegrees)
        );
        const operationMatrix = new THREE.Matrix4()
            .makeTranslation(movement.x, movement.y, movement.z)
            .multiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z))
            .multiply(rotation)
            .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
        const entry = {
            id: createTransportProfileId(),
            centerX: values.centerX,
            centerY: values.centerY,
            centerZ: values.centerZ,
            angleDegrees: values.angleDegrees,
            vectorX: values.vectorX,
            vectorY: values.vectorY,
            vectorZ: values.vectorZ,
            timestamp: new Date().toLocaleString(),
            files: sourceFiles.value.map(source => source.name).join(', ')
        };
        // Chỉ các file đang mở lúc này bị dịch chuyển; file mở thêm sau đó không bị ảnh hưởng
        const sourceIds = sourceFiles.value.map(source => source.id);
        historyOperations.set(entry.id, { matrix: operationMatrix, sourceIds });
        moveSources(sourceIds, operationMatrix);
        transportHistory.value = [entry, ...transportHistory.value];
        // Dịch chuyển làm thay đổi file xuất: bật nút lưu IFC và tính vào số thay đổi
        editHistoryCount.value++;
        hasUnsavedChanges.value = true;
        showToast(t('Dịch chuyển thành công'), t('Đã áp dụng xoay và dịch chuyển cho các file IFC đang mở ({0} file). File mở thêm sau này không bị ảnh hưởng.', [sourceIds.length]), 'success');
    } catch (error) {
        console.error('Lỗi transport IFC:', error);
        showToast(t('Lỗi dịch chuyển'), error.message || t('Không thể áp dụng tọa độ dịch chuyển.'));
    }
};

export const undoTransport = (entry) => {
    const latest = transportHistory.value[0];
    const operation = historyOperations.get(entry.id);
    if (!latest || latest.id !== entry.id || !operation) {
        showToast(t('Không thể hoàn tác'), t('Chỉ có thể hoàn tác lượt dịch chuyển mới nhất.'));
        return;
    }
    historyOperations.delete(entry.id);
    transportHistory.value = transportHistory.value.filter(item => item.id !== entry.id);
    const openIds = new Set(sourceFiles.value.map(source => source.id));
    moveSources(operation.sourceIds.filter(id => openIds.has(id)), operation.matrix.clone().invert());
    editHistoryCount.value = Math.max(0, editHistoryCount.value - 1);
    if (editHistoryCount.value === 0 && deletedItems.value.length === 0) hasUnsavedChanges.value = false;
    showToast(t('Đã hoàn tác dịch chuyển'), t('Đã khôi phục tọa độ trước lượt dịch chuyển gần nhất.'), 'success');
};
