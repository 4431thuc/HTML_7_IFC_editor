import * as THREE from 'three';
import { toRaw } from 'vue';
import { getObjectMeshes, getPsetCacheKey } from '../core/helpers.js';
import { createIfcRecorder, pushHistory } from '../core/history.js';
import { buildAllGroupingCollections } from '../ifc/groups.js';
import { attributeBaseline, connectionTarget, editableAttributes, hasAttributeChanges, psetCache, rt, selectedMeshes, selectedObject } from '../state/state.js';
import { showToast } from './panels.js';
import { t } from '../i18n/index.js';

export const showPropertiesForMesh = (mesh) => {
    const box = new THREE.Box3();
    getObjectMeshes(mesh).forEach(member => box.union(new THREE.Box3().setFromObject(member)));
    const size = box.getSize(new THREE.Vector3());
    const dimensions = {
        // Trục theo hệ xây dựng (Z hướng lên): X = three X, Y = three Z, Z = three Y
        x: size.x.toFixed(3),
        y: size.z.toFixed(3),
        z: size.y.toFixed(3)
    };

    connectionTarget.value = toRaw(mesh);
    const expressID = mesh.userData.expressID;
    const typeName = mesh.userData.type;
    const isRebar = mesh.userData.isRebar;

    editableAttributes.Name = mesh.userData.name || '';
    editableAttributes.ObjectType = mesh.userData.objectType || '';
    editableAttributes.Tag = mesh.userData.tag || '';
    editableAttributes.Description = mesh.userData.description || '';
    attributeBaseline.Name = editableAttributes.Name;
    attributeBaseline.ObjectType = editableAttributes.ObjectType;
    attributeBaseline.Tag = editableAttributes.Tag;
    attributeBaseline.Description = editableAttributes.Description;

    if (mesh.userData.isDemo) {
        selectedObject.value = {
            expressID,
            type: typeName,
            name: mesh.userData.name,
            globalId: mesh.userData.globalId,
            isRebar,
            attributes: mesh.userData.attributes || {},
            rebarDetails: mesh.userData.rebarDetails,
            psets: mesh.userData.psets || [],
            dimensions
        };
        return;
    }

    try {
        const modelID = mesh.userData.sourceModelID;
        const cacheKey = getPsetCacheKey(mesh.userData.sourceId, expressID);
        const lineData = rt.ifcAPI.GetLine(modelID, expressID, true);
        const attributes = {};
        const ignored = new Set(['expressID', 'type', 'OwnerHistory', 'ObjectPlacement', 'Representation']);

        for (const [k, p] of Object.entries(lineData)) {
            if (ignored.has(k) || p === null || p === undefined) continue;
            if (typeof p === 'object' && 'value' in p) attributes[k] = String(p.value);
            else if (typeof p !== 'object') attributes[k] = String(p);
        }

        const psets = psetCache.get(cacheKey) || [];
        let rebarDetails = null;
        if (isRebar) {
            rebarDetails = extractRebarSpecificDetails(lineData, attributes, psets, dimensions);
        }

        selectedObject.value = {
            expressID,
            type: typeName,
            name: mesh.userData.name,
            globalId: lineData.GlobalId?.value || '',
            isRebar,
            attributes,
            rebarDetails,
            psets,
            dimensions
        };
    } catch (err) {
        selectedObject.value = {
            expressID,
            type: typeName,
            name: mesh.userData.name,
            globalId: '',
            isRebar,
            attributes: {},
            rebarDetails: null,
            psets: psetCache.get(getPsetCacheKey(mesh.userData.sourceId, expressID)) || [],
            dimensions
        };
    }
};

export const extractRebarSpecificDetails = (lineData, attributes, psets, dimensions) => {
    let barDiameter = attributes.NominalDiameter ? `${attributes.NominalDiameter} mm` : '';
    let steelGrade = attributes.SteelGrade || '';
    let barLength = attributes.BarLength ? `${attributes.BarLength} mm` : '';
    let tagMark = lineData.Tag?.value || attributes.Tag || editableAttributes.Tag || '';

    psets.forEach(pset => {
        pset.properties.forEach(prop => {
            const pName = prop.name.toLowerCase();
            const val = String(prop.value);

            if (!barDiameter && (pName.includes('diameter') || pName.includes('bar_dia') || pName === 'd')) {
                barDiameter = val.includes('mm') ? val : `${val} mm (Ø${val})`;
            }
            if (!steelGrade && (pName.includes('grade') || pName.includes('steel') || pName.includes('material'))) {
                steelGrade = val;
            }
            if (!barLength && (pName.includes('length') || pName.includes('bar_length'))) {
                barLength = val.includes('m') ? val : `${val} mm`;
            }
            if (!tagMark && (pName.includes('mark') || pName.includes('tag') || pName.includes('pos'))) {
                tagMark = val;
            }
        });
    });

    if (!barLength && dimensions) {
        const maxL = Math.max(parseFloat(dimensions.x), parseFloat(dimensions.y), parseFloat(dimensions.z));
        barLength = `~${(maxL * 1000).toFixed(0)} mm (${maxL.toFixed(2)} m)`;
    }

    if (!barDiameter && dimensions) {
        const sortedDims = [parseFloat(dimensions.x), parseFloat(dimensions.y), parseFloat(dimensions.z)].sort((a,b) => a - b);
        const estD = (sortedDims[0] * 1000).toFixed(0);
        if (parseFloat(estD) > 0) barDiameter = `~Ø${estD} mm`;
    }

    return {
        barDiameter: barDiameter || t('Chưa định nghĩa'),
        steelGrade: steelGrade || t('Chưa định nghĩa'),
        barLength: barLength || t('Chưa định nghĩa'),
        tagMark: tagMark || '—'
    };
};

// LƯU THUỘC TÍNH VÀ XUẤT FILE
const ATTRIBUTE_KEYS = ['Name', 'ObjectType', 'Tag', 'Description'];
const USERDATA_KEYS = { Name: 'name', ObjectType: 'objectType', Tag: 'tag', Description: 'description' };
const snapshotMeshAttributes = (meshes) => meshes.map(mesh => ({
    mesh,
    values: Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key, mesh.userData[USERDATA_KEYS[key]]]))
}));
const restoreMeshAttributes = (snapshot) => {
    snapshot.forEach(({ mesh, values }) => ATTRIBUTE_KEYS.forEach(key => { mesh.userData[USERDATA_KEYS[key]] = values[key]; }));
    buildAllGroupingCollections();
    if (selectedMeshes.value.length > 0) showPropertiesForMesh(selectedMeshes.value[selectedMeshes.value.length - 1]);
};

export const saveAttributeChanges = () => {
    if (!selectedObject.value || selectedMeshes.value.length === 0) return;
    if (!hasAttributeChanges.value) return;

    const meshes = selectedMeshes.value.slice();
    const before = snapshotMeshAttributes(meshes);
    const rec = createIfcRecorder();
    const writtenIds = new Set();
    meshes.forEach(mesh => {
        const expressID = mesh.userData.expressID;
        mesh.userData.name = editableAttributes.Name;
        mesh.userData.objectType = editableAttributes.ObjectType;
        mesh.userData.tag = editableAttributes.Tag;
        mesh.userData.description = editableAttributes.Description;

        const lineId = `${mesh.userData.sourceModelID}:${expressID}`;
        if (mesh.userData.sourceModelID !== null && !mesh.userData.isDemo && !writtenIds.has(lineId)) {
            writtenIds.add(lineId);
            try {
                const line = rt.ifcAPI.GetLine(mesh.userData.sourceModelID, expressID, false);
                if (line) {
                    if (editableAttributes.Name) line.Name = { type: 1, value: editableAttributes.Name };
                    if (editableAttributes.ObjectType) line.ObjectType = { type: 1, value: editableAttributes.ObjectType };
                    if (editableAttributes.Tag) line.Tag = { type: 1, value: editableAttributes.Tag };
                    if (editableAttributes.Description) line.Description = { type: 1, value: editableAttributes.Description };
                    rec.write(mesh.userData.sourceModelID, line);
                }
            } catch (err) {}
        }
    });

    attributeBaseline.Name = editableAttributes.Name;
    attributeBaseline.ObjectType = editableAttributes.ObjectType;
    attributeBaseline.Tag = editableAttributes.Tag;
    attributeBaseline.Description = editableAttributes.Description;
    const ifcChange = rec.finish();
    const after = snapshotMeshAttributes(meshes);
    pushHistory({
        label: t('Sửa thuộc tính ({0} cấu kiện)', [meshes.length]),
        undo: () => { ifcChange.undo(); restoreMeshAttributes(before); },
        redo: () => { ifcChange.redo(); restoreMeshAttributes(after); }
    });
    buildAllGroupingCollections();
    showToast(t('Đã lưu thuộc tính'), t('Đã cập nhật cho {0} đối tượng.', [meshes.length]), 'success');
};

export const resetEditableAttributes = () => {
    if (selectedMeshes.value.length > 0) {
        showPropertiesForMesh(selectedMeshes.value[0]);
    }
};
