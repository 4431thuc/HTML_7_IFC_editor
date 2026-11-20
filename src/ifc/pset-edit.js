// Sửa giá trị một thuộc tính Pset (IfcPropertySingleValue) cho các cấu kiện đang chọn (chuột phải > Sửa giá trị).
//
// Thực thể IfcPropertySet / IfcPropertySingleValue thường được NHIỀU cấu kiện dùng chung (qua IfcRelDefinesByProperties),
// nên chỉ sửa tại chỗ khi mọi cấu kiện dùng thực thể đó đều đang được chọn. Nếu không:
//  - tạo bản sao thuộc tính mang giá trị mới,
//  - pset dùng chung với cấu kiện không chọn thì tạo bản sao pset + quan hệ mới cho riêng các cấu kiện đang chọn
//    và gỡ chúng khỏi quan hệ cũ, để cấu kiện khác giữ nguyên giá trị cũ.
// Sau khi sửa: cập nhật psetCache, Pos/đường kính suy ra từ Pset (nhóm, màu thép), panel thuộc tính, bộ đếm lưu IFC.
import { nextTick } from 'vue';
import * as WebIFC from 'web-ifc';
import { getMeshKey, getPsetCacheKey } from '../core/helpers.js';
import { rebuildBatches } from '../scene/rendering.js';
import { getRebarColorByDiameter } from '../scene/sample-model.js';
import { parseDiameterMm } from '../state/constants.js';
import { editHistoryCount, hasUnsavedChanges, psetCache, psetEditDialog, rt, selectedMeshes } from '../state/state.js';
import { showToast } from '../ui/panels.js';
import { showPropertiesForMesh } from '../ui/properties.js';
import { t } from '../i18n/index.js';
import { buildAllGroupingCollections } from './groups.js';
import { getModelMaterial } from './loader.js';
import { sanitizeIfcText } from './project-info.js';

// Cùng quy tắc nhận Pos / đường kính từ tên thuộc tính như lúc nạp file (loader.js)
const TAG_PROPERTY = (name) => name.includes('mark') || name.includes('tag') || name.includes('pos');
const DIAMETER_PROPERTY = /(diameter|bar.?dia|nominaldia|(?:^|_)d(?:$|_))/i;

const GUID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
const createGlobalId = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(22));
    return Array.from(bytes, (byte, index) => GUID_ALPHABET[index === 0 ? byte % 4 : byte % 64]).join('');
};
const reference = (value) => ({ type: WebIFC.REF, value });
const label = (value) => ({ type: WebIFC.STRING, value });

// Đối tượng cần sửa của lần mở hộp thoại hiện tại
let pendingTargets = [];

// Các cấu kiện đang chọn (không trùng, không tính mô hình mẫu) có thuộc tính psetName.propName sửa được
const collectTargets = (psetName, propName) => {
    const targets = new Map();
    selectedMeshes.value.forEach(mesh => {
        const ud = mesh.userData;
        if (ud.isDemo || ud.sourceModelID === null || ud.sourceModelID === undefined) return;
        const key = getMeshKey(mesh);
        if (targets.has(key)) return;
        const entry = (psetCache.get(key) || []).find(item => item.name === psetName && item.properties.some(prop => prop.name === propName && prop.editable));
        if (!entry) return;
        targets.set(key, { key, sourceId: ud.sourceId, modelID: ud.sourceModelID, expressID: ud.expressID, entry, prop: entry.properties.find(prop => prop.name === propName && prop.editable) });
    });
    return Array.from(targets.values());
};

const getValueKind = (nominalValue) => {
    if (typeof nominalValue?.value === 'boolean') return 'boolean';
    if (nominalValue?.type === WebIFC.INTEGER) return 'integer';
    if (typeof nominalValue?.value === 'number') return 'number';
    return 'text';
};

export const openPsetEditDialog = async (psetName, propName, displayValue) => {
    const targets = collectTargets(psetName, propName);
    if (targets.length === 0) {
        showToast(t('Không thể sửa'), t('Chọn cấu kiện có thuộc tính này trước khi sửa.'));
        return;
    }
    const first = targets[0];
    let kind = 'text';
    try {
        kind = getValueKind(rt.ifcAPI.GetLine(first.modelID, first.prop.propId, false)?.NominalValue);
    } catch (error) {
        console.warn('Không đọc được kiểu giá trị thuộc tính:', error);
    }
    pendingTargets = targets;
    Object.assign(psetEditDialog, {
        visible: true,
        psetName,
        propName,
        original: String(displayValue),
        value: kind === 'boolean' ? (String(displayValue) === 'true' ? 'true' : 'false') : String(displayValue),
        kind,
        targetCount: targets.length
    });
    await nextTick();
    const input = document.getElementById('psetEditInput');
    input?.focus();
    input?.select();
};

// Giá trị nhập -> giá trị ghi IFC; ném lỗi nếu không hợp lệ
const parseInput = (kind, text) => {
    if (kind === 'boolean') return text === 'true';
    if (kind === 'integer' || kind === 'number') {
        const number = Number(String(text).trim().replace(',', '.'));
        if (String(text).trim() === '' || !Number.isFinite(number)) throw new Error(t('Nhập một số hợp lệ.'));
        if (kind === 'integer' && !Number.isInteger(number)) throw new Error(t('Nhập một số nguyên.'));
        return number;
    }
    return sanitizeIfcText(String(text).trim());
};

// Sao chép giá trị kiểu IFC (IfcLabel, IfcLengthMeasure...) giữ nguyên lớp, chỉ đổi value
const withValue = (nominalValue, value) => {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(nominalValue)), nominalValue);
    copy.value = value;
    return copy;
};

// Chỉ mục người dùng của từng thực thể thuộc tính / pset trong một file: id -> Set(khóa cấu kiện)
const buildUsage = (sourceId) => {
    const props = new Map();
    const psets = new Map();
    const prefix = `${sourceId}:`;
    psetCache.forEach((entries, key) => {
        if (!key.startsWith(prefix)) return;
        entries.forEach(entry => {
            if (!psets.has(entry.psetId)) psets.set(entry.psetId, new Set());
            psets.get(entry.psetId).add(key);
            entry.properties.forEach(prop => {
                if (!props.has(prop.propId)) props.set(prop.propId, new Set());
                props.get(prop.propId).add(key);
            });
        });
    });
    return { props, psets };
};

const isSubset = (users, selectedKeys) => !users || Array.from(users).every(key => selectedKeys.has(key));

// Cập nhật giá trị hiển thị trong psetCache cho mọi chỗ dùng thực thể thuộc tính propId (trong một file)
const updateCachedValue = (sourceId, propId, newPropId, displayValue) => {
    const prefix = `${sourceId}:`;
    psetCache.forEach((entries, key) => {
        if (!key.startsWith(prefix)) return;
        entries.forEach(entry => entry.properties.forEach(prop => {
            if (prop.propId !== propId) return;
            prop.propId = newPropId;
            prop.value = displayValue;
        }));
    });
};

// Sửa một nhóm cấu kiện cùng file, cùng thực thể pset
const applyToPsetGroup = (modelID, sourceId, group, newValue, displayValue) => {
    const { psetId } = group[0].entry;
    const propId = group[0].prop.propId;
    const selectedKeys = new Set(group.map(target => target.key));
    const usage = buildUsage(sourceId);
    const propertyLine = rt.ifcAPI.GetLine(modelID, propId, false);
    const nominalValue = withValue(propertyLine.NominalValue, newValue);

    // 1. Thuộc tính chỉ thuộc về các cấu kiện đang chọn: sửa tại chỗ
    if (isSubset(usage.props.get(propId), selectedKeys)) {
        propertyLine.NominalValue = nominalValue;
        rt.ifcAPI.WriteLine(modelID, propertyLine);
        updateCachedValue(sourceId, propId, propId, displayValue);
        return;
    }

    // 2. Thuộc tính dùng chung: tạo bản sao mang giá trị mới
    const newProperty = rt.ifcAPI.CreateIfcEntity(modelID, WebIFC.IFCPROPERTYSINGLEVALUE);
    Object.assign(newProperty, {
        Name: propertyLine.Name,
        Description: propertyLine.Description ?? null,
        NominalValue: nominalValue,
        Unit: propertyLine.Unit ?? null
    });
    rt.ifcAPI.WriteLine(modelID, newProperty);
    const newPropId = newProperty.expressID;
    const psetLine = rt.ifcAPI.GetLine(modelID, psetId, false);
    const newPropertyRefs = (psetLine.HasProperties || []).map(ref => (ref.value === propId ? reference(newPropId) : ref));

    // 2a. Pset chỉ thuộc về các cấu kiện đang chọn: trỏ pset sang thuộc tính mới
    if (isSubset(usage.psets.get(psetId), selectedKeys)) {
        psetLine.HasProperties = newPropertyRefs;
        rt.ifcAPI.WriteLine(modelID, psetLine);
        psetCache.forEach((entries, key) => {
            if (!key.startsWith(`${sourceId}:`)) return;
            entries.forEach(entry => {
                if (entry.psetId !== psetId) return;
                entry.properties.forEach(prop => {
                    if (prop.propId !== propId) return;
                    prop.propId = newPropId;
                    prop.value = displayValue;
                });
            });
        });
        return;
    }

    // 2b. Pset dùng chung: tạo pset + quan hệ mới cho riêng các cấu kiện đang chọn, gỡ chúng khỏi quan hệ cũ
    const newPset = rt.ifcAPI.CreateIfcEntity(modelID, WebIFC.IFCPROPERTYSET);
    Object.assign(newPset, {
        GlobalId: label(createGlobalId()),
        OwnerHistory: psetLine.OwnerHistory ?? null,
        Name: psetLine.Name,
        Description: psetLine.Description ?? null,
        HasProperties: newPropertyRefs
    });
    rt.ifcAPI.WriteLine(modelID, newPset);

    const selectedIds = new Set(group.map(target => target.expressID));
    const oldRelIds = new Set(group.map(target => target.entry.relId));
    let ownerHistory = psetLine.OwnerHistory ?? null;
    oldRelIds.forEach(relId => {
        const relLine = rt.ifcAPI.GetLine(modelID, relId, false);
        if (!relLine) return;
        ownerHistory = ownerHistory ?? relLine.OwnerHistory ?? null;
        relLine.RelatedObjects = (relLine.RelatedObjects || []).filter(ref => !selectedIds.has(ref.value));
        if (relLine.RelatedObjects.length === 0) rt.ifcAPI.DeleteLine(modelID, relId);
        else rt.ifcAPI.WriteLine(modelID, relLine);
    });

    const newRel = rt.ifcAPI.CreateIfcEntity(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
    Object.assign(newRel, {
        GlobalId: label(createGlobalId()),
        OwnerHistory: ownerHistory,
        Name: null,
        Description: null,
        RelatedObjects: Array.from(selectedIds, id => reference(id)),
        RelatingPropertyDefinition: reference(newPset.expressID)
    });
    rt.ifcAPI.WriteLine(modelID, newRel);

    // Bộ nhớ đệm: các cấu kiện đang chọn chuyển sang pset mới (một mảng thuộc tính dùng chung cho cả nhóm)
    const newProperties = group[0].entry.properties.map(prop => (prop.propId === propId
        ? { ...prop, propId: newPropId, value: displayValue }
        : { ...prop }));
    group.forEach(target => {
        const entries = psetCache.get(target.key) || [];
        const index = entries.indexOf(target.entry);
        const newEntry = { name: target.entry.name, properties: newProperties, psetId: newPset.expressID, relId: newRel.expressID };
        if (index >= 0) entries[index] = newEntry;
        else entries.push(newEntry);
        psetCache.set(target.key, entries);
    });
};

// Pos / đường kính suy ra từ Pset lúc nạp file: cập nhật theo giá trị mới nếu đang lấy từ chính thuộc tính này
const updateDerivedAttributes = (targets, propName, oldDisplay, newDisplay) => {
    const name = propName.toLowerCase();
    const isTag = TAG_PROPERTY(name);
    const isDiameter = DIAMETER_PROPERTY.test(name);
    if (!isTag && !isDiameter) return { regroup: false, recolor: false };
    let regroup = false;
    let recolor = false;
    const oldDiameter = parseDiameterMm(oldDisplay);
    const newDiameter = Math.round(parseDiameterMm(newDisplay));
    targets.forEach(target => {
        (rt.meshesByKey?.get(target.key) || []).forEach(mesh => {
            const ud = mesh.userData;
            if (isTag && ud.tag === oldDisplay) {
                ud.tag = newDisplay;
                regroup = true;
            }
            if (isDiameter && ud.isRebar && newDiameter > 0 && Math.round(oldDiameter) === ud.diameter && newDiameter !== ud.diameter) {
                ud.diameter = newDiameter;
                ud.colorByDiameter = getRebarColorByDiameter(newDiameter);
                const material = getModelMaterial(ud.type, true, ud.colorByDiameter, ud.ifcOpacity ?? 1);
                ud.originalMaterial = material;
                mesh.material = material;
                regroup = true;
                recolor = true;
            }
        });
    });
    return { regroup, recolor };
};

export const applyPsetEdit = () => {
    const dialog = psetEditDialog;
    let newValue;
    try {
        newValue = parseInput(dialog.kind, dialog.value);
    } catch (error) {
        showToast(t('Giá trị không hợp lệ'), error.message);
        return;
    }
    const displayValue = String(newValue);
    if (displayValue === dialog.original) {
        dialog.visible = false;
        showToast(t('Không thể sửa'), t('Giá trị không đổi.'));
        return;
    }

    try {
        // Nhóm theo file rồi theo thực thể pset
        const groups = new Map();
        pendingTargets.forEach(target => {
            const groupKey = `${target.sourceId}|${target.entry.psetId}`;
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push(target);
        });
        groups.forEach(group => applyToPsetGroup(group[0].modelID, group[0].sourceId, group, newValue, displayValue));

        const { regroup, recolor } = updateDerivedAttributes(pendingTargets, dialog.propName, dialog.original, displayValue);
        if (recolor) rebuildBatches();
        if (regroup) buildAllGroupingCollections();

        editHistoryCount.value += pendingTargets.length;
        hasUnsavedChanges.value = true;
        const last = selectedMeshes.value[selectedMeshes.value.length - 1];
        if (last) showPropertiesForMesh(last);
        showToast(t('Đã sửa giá trị'), t('Đã đổi "{0}" thành "{1}" cho {2} cấu kiện.', [dialog.propName, displayValue, pendingTargets.length]), 'success');
        dialog.visible = false;
        pendingTargets = [];
    } catch (error) {
        console.error('Lỗi sửa giá trị Pset:', error);
        showToast(t('Lỗi sửa giá trị'), error.message || String(error));
    }
};

// Dùng khi cần lấy khóa cache từ sourceId + expressID ở nơi khác
export const getPsetEntries = (sourceId, expressID) => psetCache.get(getPsetCacheKey(sourceId, expressID)) || [];
