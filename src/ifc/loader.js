import * as THREE from 'three';
import { clearClashResults } from '../clash/clash.js';
import { countLogicalObjects, createMeshKey, getMeshKey, getPsetCacheKey } from '../core/helpers.js';
import { buildAllGroupingCollections, indexAllPropertySets, shouldMeshBeVisible, updateAllMeshesVisibility, updateEdgesVisibility } from './groups.js';
import { getIfcLengthUnitInMeters, resetTransportState, updateTransportScene } from './transport.js';
import { resetCropBoxToModel } from '../scene/cropbox.js';
import { rebuildBatches } from '../scene/rendering.js';
import { getRebarColorByDiameter } from '../scene/sample-model.js';
import { fitCameraToModel } from '../scene/scene.js';
import { clearSelection, updateSelectionDimmingEffect } from '../selection/selection.js';
import { ENTITY_DEFAULT_COLORS, REBAR_ENTITY_TYPES, parseDiameterMm } from '../state/constants.js';
import { duplicateFilePrompt, allGroups, batchGroup, clippingPlanes, deletedItems, edgesGroup, editHistoryCount, exportListVersion, faultyCount, fileName, hasLoadedIfc, hasUnsavedChanges, hoveredType, isCropBoxActive, isEditingAttributes, isIfcDragOver, isLoading, isSampleModel, isWireframe, loadingText, manuallyHiddenExpressIDs, materialCache, overlayGroup, pendingDeletedExpressIDs, psetCache, rt, selectedMeshes, selectedObject, showEdges, sourceFiles, stats, toastMessage } from '../state/state.js';
import { applyModelOpacityToMaterial, showToast } from '../ui/panels.js';
import { showPropertiesForMesh } from '../ui/properties.js';
import { removeProjectInfo, showProjectInfoForSource } from './project-info.js';
import { t } from '../i18n/index.js';

// --- 4. TẢI IFC VÀO SCENE DÙNG CHUNG ---
export const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (file) await loadIfcFile(file, true);
    event.target.value = '';
};

export const handleAddIfcFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    for (const file of files) await loadIfcFile(file, false);
};

export const handleIfcDragEnter = (event) => {
    if (event.dataTransfer?.types?.includes('Files')) isIfcDragOver.value = true;
};

export const handleIfcDragOver = (event) => {
    if (event.dataTransfer?.types?.includes('Files')) isIfcDragOver.value = true;
};

export const handleIfcDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) isIfcDragOver.value = false;
};

export const handleIfcDrop = async (event) => {
    isIfcDragOver.value = false;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) return;
    const ifcFiles = files.filter(file => file.name.toLowerCase().endsWith('.ifc'));
    if (ifcFiles.length !== files.length) showToast(t('Bỏ qua tệp không hợp lệ'), t('Chỉ nhận tệp có định dạng .ifc.'));
    for (let index = 0; index < ifcFiles.length; index++) {
        const replaceCurrent = index === 0 && isSampleModel.value;
        await loadIfcFile(ifcFiles[index], replaceCurrent);
    }
};

// Hỏi người dùng có mở tiếp không khi file thêm vào trùng tên với file đang mở / đang trong danh sách gộp
const confirmDuplicateFile = (name) => new Promise(resolve => {
    duplicateFilePrompt.value = { name, resolve };
});
export const answerDuplicateFilePrompt = (openAnyway) => {
    const prompt = duplicateFilePrompt.value;
    duplicateFilePrompt.value = null;
    prompt?.resolve(openAnyway);
};

export const loadIfcFile = async (file, replaceCurrent) => {
    if (!file.name.toLowerCase().endsWith('.ifc')) {
        showToast(t('Định dạng sai'), t('Vui lòng chọn tệp .ifc chuẩn: {0}', [file.name]));
        return false;
    }
    if (!replaceCurrent) {
        const lowerName = file.name.toLowerCase();
        if (sourceFiles.value.some(source => source.name.toLowerCase() === lowerName)) {
            if (!await confirmDuplicateFile(file.name)) return false;
        }
    }

    toastMessage.value = '';
    isLoading.value = true;
    loadingText.value = t('Đang đọc "{0}"...', [file.name]);
    if (replaceCurrent || !fileName.value) fileName.value = file.name;
    await new Promise(resolve => setTimeout(resolve, 60));

    let openedModelID = null;
    let sourceId = `ifc-${++rt.sourceFileSequence}`;
    try {
        if (replaceCurrent) {
            const modelIDs = new Set(sourceFiles.value.map(source => source.modelID));
            if (rt.currentModelID !== null) modelIDs.add(rt.currentModelID);
            modelIDs.forEach(modelID => {
                try { rt.ifcAPI.CloseModel(modelID); }
                catch (error) { console.warn('Không thể đóng model IFC cũ:', error); }
            });
            rt.currentModelID = null;
            sourceFiles.value = [];
            clearCurrentModel();
            psetCache.clear();
            editHistoryCount.value = 0;
            hasUnsavedChanges.value = false;
        }

        const uint8Array = new Uint8Array(await file.arrayBuffer());
        const schemaHeader = new TextDecoder('utf-8').decode(uint8Array.subarray(0, Math.min(uint8Array.length, 8192)));
        const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(schemaHeader);
        const schemaName = schemaMatch ? schemaMatch[1] : t('Không xác định');
        loadingText.value = t('Cấu hình tham số hình học cốt thép...');
        await new Promise(resolve => setTimeout(resolve, 40));

        const modelSettings = {
            COORDINATE_TO_ORIGIN: false,
            USE_FAST_BOOLS: false,
            OPTIMIZE_PROFILES: false,
            CIRCLE_SEGMENTS: 12
        };

        openedModelID = rt.ifcAPI.OpenModel(uint8Array, modelSettings);
        if (openedModelID < 0) throw new Error(t('Không thể mở model IFC "{0}".', [file.name]));
        if (rt.currentModelID === null) rt.currentModelID = openedModelID;
        const unitMeters = getIfcLengthUnitInMeters(openedModelID);

        loadingText.value = t('Lập chỉ mục quan hệ thuộc tính Psets...');
        await new Promise(resolve => setTimeout(resolve, 30));
        indexAllPropertySets(openedModelID, sourceId);

        loadingText.value = t('Đang nạp hình học từ "{0}"...', [file.name]);
        await new Promise(resolve => setTimeout(resolve, 30));

        let meshCount = 0;
        const loadedObjectKeys = new Set();
        let rebarCount = 0;
        let faultyCountAcc = 0;
        const schemaCounts = new Map();

        rt.ifcAPI.StreamAllMeshes(openedModelID, (flatMesh) => {
            const expressID = flatMesh.expressID;
            const placedGeometries = flatMesh.geometries;
            let typeName = 'IFCELEMENT';
            let entityName = '';
            let entityTag = '';
            let entityObjType = '';
            let entityDesc = '';
            let nominalDiameter = 0;

            try {
                const typeCode = rt.ifcAPI.GetLineType(openedModelID, expressID);
                typeName = rt.ifcAPI.GetNameFromTypeCode(typeCode) || 'IFCELEMENT';
                const line = rt.ifcAPI.GetLine(openedModelID, expressID, false);
                if (line) {
                    entityName = line.Name?.value || '';
                    entityTag = line.Tag?.value || '';
                    entityObjType = line.ObjectType?.value || '';
                    entityDesc = line.Description?.value || '';
                    nominalDiameter = parseDiameterMm(line.NominalDiameter?.value);
                }
            } catch (error) {
                console.warn(`Không đọc được thuộc tính cấu kiện #${expressID}:`, error);
            }

            const schemaType = typeName;
            schemaCounts.set(schemaType, (schemaCounts.get(schemaType) || 0) + 1);
            const combined = `${entityName} ${entityObjType} ${typeName}`.toUpperCase();
            if (combined.includes('BAR') || combined.includes('REBAR') || combined.includes('THÉP') || combined.includes('REINFORC')) typeName = 'IFCREINFORCINGBAR';
            else if (combined.includes('COLUMN') || combined.includes('CỘT')) typeName = 'IFCCOLUMN';
            else if (combined.includes('BEAM') || combined.includes('DẦM') || combined.includes('GIRDER')) typeName = 'IFCBEAM';
            else if (combined.includes('SLAB') || combined.includes('SÀN') || combined.includes('FLOOR')) typeName = 'IFCSLAB';
            else if (combined.includes('WALL') || combined.includes('TƯỜNG') || combined.includes('VÁCH')) typeName = 'IFCWALL';
            else if (combined.includes('FOOTING') || combined.includes('MÓNG') || combined.includes('PAD')) typeName = 'IFCFOOTING';
            else if (combined.includes('COUPLER') || combined.includes('FASTENER')) typeName = 'IFCMECHANICALFASTENER';
            else if (combined.includes('STAIR') || combined.includes('THANG')) typeName = 'IFCSTAIR';

            const isRebar = REBAR_ENTITY_TYPES.has(typeName);
            const psets = psetCache.get(getPsetCacheKey(sourceId, expressID)) || [];
            for (const pset of psets) {
                for (const property of pset.properties) {
                    const propertyName = property.name.toLowerCase();
                    if (!entityTag && (propertyName.includes('mark') || propertyName.includes('tag') || propertyName.includes('pos'))) entityTag = String(property.value);
                    if (nominalDiameter === 0 && /(diameter|bar.?dia|nominaldia|(?:^|_)d(?:$|_))/i.test(propertyName)) nominalDiameter = parseDiameterMm(property.value);
                }
            }
            if (isRebar && nominalDiameter === 0) nominalDiameter = parseDiameterMm(`${entityName} ${entityObjType}`);

            for (let i = 0; i < placedGeometries.size(); i++) {
                const mesh = createThreeMeshFromIfc(openedModelID, expressID, typeName, isRebar, placedGeometries.get(i), {
                    name: entityName,
                    tag: entityTag,
                    objectType: entityObjType,
                    description: entityDesc,
                    diameter: nominalDiameter,
                    sourceId,
                    sourceModelID: openedModelID,
                    sourceFileName: file.name,
                    schemaType
                });

                if (!mesh) continue;
                mesh.userData.colorByDiameter = isRebar ? getRebarColorByDiameter(mesh.userData.diameter) : '';
                rt.modelGroup.add(mesh);
                meshCount++;
                loadedObjectKeys.add(getMeshKey(mesh));
                if (isRebar) {
                    rebarCount++;
                    if (checkIfFaultyRebar(mesh)) {
                        mesh.userData.isFaulty = true;
                        faultyCountAcc++;
                    }
                }
            }
        });

        if (meshCount === 0) throw new Error(t('Không tìm thấy hình học 3D trong file "{0}".', [file.name]));
        rebuildBatches();

        sourceFiles.value.push({
            id: sourceId,
            name: file.name,
            modelID: openedModelID,
            unitMeters,
            meshCount,
            rebarCount,
            visible: true,
            schemaName,
            schemaExpanded: false,
            schemaRows: Array.from(schemaCounts, ([type, count]) => ({ type, count }))
                .sort((a, b) => a.type.localeCompare(b.type))
        });
        isSampleModel.value = false;
        hasLoadedIfc.value = true;
        stats.meshes = countLogicalObjects();
        stats.rebarCount = rt.modelGroup.children.filter(mesh => mesh.isMesh && mesh.userData.isRebar).length;
        faultyCount.value = rt.modelGroup.children.filter(mesh => mesh.isMesh && mesh.userData.isFaulty).length;

        centerModelByBoundingBox();
        buildAllGroupingCollections();
        updateSelectionDimmingEffect();
        fitCameraToModel();

        const rebarRatio = stats.meshes > 0 ? stats.rebarCount / stats.meshes : 0;
        showEdges.value = !(rebarRatio > 0.35 || stats.rebarCount > 600);
        updateEdgesVisibility();
        if (isCropBoxActive.value) resetCropBoxToModel();
        showProjectInfoForSource(sourceFiles.value[sourceFiles.value.length - 1]);
        showToast(t('Tải thành công'), t('Đã thêm "{0}": {1} cấu kiện ({2} cốt thép).', [file.name, loadedObjectKeys.size, rebarCount]), 'success');
        return true;
    } catch (error) {
        console.error(`Lỗi phân tích IFC "${file.name}":`, error);
        rt.modelGroup.children.slice().forEach(mesh => {
            if (!mesh.isMesh || mesh.userData.sourceId !== sourceId) return;
            const edge = edgesGroup.children.find(line => line.userData.parentMesh === mesh);
            if (edge) {
                edge.geometry?.dispose();
                edgesGroup.remove(edge);
            }
            mesh.geometry?.dispose();
            rt.modelGroup.remove(mesh);
        });
        rebuildBatches();
        psetCache.forEach((value, key) => {
            if (key.startsWith(`${sourceId}:`)) psetCache.delete(key);
        });
        if (openedModelID !== null) {
            try { rt.ifcAPI.CloseModel(openedModelID); }
            catch (closeError) { console.warn('Không thể đóng model IFC lỗi:', closeError); }
        }
        if (rt.currentModelID === openedModelID) rt.currentModelID = sourceFiles.value[0]?.modelID ?? null;
        showToast(t('Lỗi mở tệp'), error.message || t('Tệp "{0}" không hợp lệ.', [file.name]));
        return false;
    } finally {
        isLoading.value = false;
        if (sourceFiles.value.length === 0) fileName.value = '';
    }
};

export const toggleSourceVisibility = (source) => {
    source.visible = !source.visible;
    rt.modelGroup.children.forEach(mesh => {
        if (mesh.isMesh && mesh.userData.sourceId === source.id) {
            mesh.userData.sourceVisible = source.visible;
            mesh.visible = shouldMeshBeVisible(mesh);
        }
    });
    updateEdgesVisibility();
};

export const removeSourceFile = (source) => {
    const selectedFromSource = selectedMeshes.value.some(mesh => mesh.userData.sourceId === source.id);
    selectedMeshes.value = selectedMeshes.value.filter(mesh => mesh.userData.sourceId !== source.id);
    if (selectedFromSource) {
        if (selectedMeshes.value.length > 0) showPropertiesForMesh(selectedMeshes.value[selectedMeshes.value.length - 1]);
        else {
            selectedObject.value = null;
            isEditingAttributes.value = false;
        }
        updateSelectionDimmingEffect();
    }
    if (rt.hoveredMesh && rt.hoveredMesh.userData.sourceId === source.id) {
        rt.hoveredMesh = null;
        hoveredType.value = '';
    }

    edgesGroup.children.slice().forEach(line => {
        if (line.userData.parentMesh?.userData.sourceId !== source.id) return;
        line.geometry?.dispose();
        edgesGroup.remove(line);
    });
    rt.modelGroup.children.slice().forEach(mesh => {
        if (!mesh.isMesh || mesh.userData.sourceId !== source.id) return;
        mesh.geometry?.dispose();
        rt.modelGroup.remove(mesh);
    });
    rebuildBatches();

    const sourceKeyPrefix = `${source.id}:`;
    Array.from(pendingDeletedExpressIDs).forEach(key => {
        if (key.startsWith(sourceKeyPrefix)) pendingDeletedExpressIDs.delete(key);
    });
    Array.from(manuallyHiddenExpressIDs).forEach(key => {
        if (key.startsWith(sourceKeyPrefix)) manuallyHiddenExpressIDs.delete(key);
    });
    deletedItems.value = deletedItems.value.filter(item => item.sourceId !== source.id);
    psetCache.forEach((value, key) => {
        if (key.startsWith(sourceKeyPrefix)) psetCache.delete(key);
    });

    removeProjectInfo(source.id);
    sourceFiles.value = sourceFiles.value.filter(item => item.id !== source.id);
    if (rt.currentModelID === source.modelID) rt.currentModelID = sourceFiles.value[0]?.modelID ?? null;
    try {
        rt.ifcAPI.CloseModel(source.modelID);
    } catch (error) {
        console.warn(`Không thể đóng model "${source.name}":`, error);
    }

    fileName.value = sourceFiles.value[0]?.name || '';
    hasLoadedIfc.value = sourceFiles.value.length > 0;
    stats.meshes = countLogicalObjects();
    stats.rebarCount = rt.modelGroup.children.filter(mesh => mesh.isMesh && mesh.userData.isRebar).length;
    faultyCount.value = rt.modelGroup.children.filter(mesh => mesh.isMesh && mesh.userData.isFaulty).length;
    if (stats.meshes === 0) {
        rt.modelGroup.position.set(0, 0, 0);
        rt.modelOffset.set(0, 0, 0);
        resetTransportState();
    } else {
        centerModelByBoundingBox();
    }
    buildAllGroupingCollections();
    updateAllMeshesVisibility();
    updateSelectionDimmingEffect();
    fitCameraToModel();
    if (isCropBoxActive.value && stats.meshes > 0) resetCropBoxToModel();
    showToast(t('Đã loại bỏ file'), t('Đã xóa "{0}" khỏi view và các danh sách.', [source.name]), 'success');
};

export const createThreeMeshFromIfc = (modelID, expressID, typeName, isRebar, placedGeometry, metaAttrs) => {
    const geometryData = rt.ifcAPI.GetGeometry(modelID, placedGeometry.geometryExpressID);
    const verts = rt.ifcAPI.GetVertexArray(geometryData.GetVertexData(), geometryData.GetVertexDataSize());
    const indices = rt.ifcAPI.GetIndexArray(geometryData.GetIndexData(), geometryData.GetIndexDataSize());

    if (verts.length === 0 || indices.length === 0) {
        geometryData.delete();
        return null;
    }

    const vertexCount = verts.length / 6;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
        positions[i * 3] = verts[i * 6];
        positions[i * 3 + 1] = verts[i * 6 + 1];
        positions[i * 3 + 2] = verts[i * 6 + 2];

        normals[i * 3] = verts[i * 6 + 3];
        normals[i * 3 + 4] = verts[i * 6 + 4];
        normals[i * 3 + 5] = verts[i * 6 + 5];
    }

    const bufferGeo = new THREE.BufferGeometry();
    bufferGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    bufferGeo.setIndex(new THREE.BufferAttribute(indices, 1));
    geometryData.delete();

    bufferGeo.computeVertexNormals();
    bufferGeo.computeBoundsTree();

    // LẤY MÀU SẮC CHUẨN XÁC:
    let assignedColorHex;
    if (isRebar) {
        let dia = metaAttrs.diameter;
        if (!dia) {
            bufferGeo.computeBoundingBox();
            const bSize = bufferGeo.boundingBox.getSize(new THREE.Vector3());
            const sorted = [bSize.x, bSize.y, bSize.z].sort((a,b)=>a-b);
            dia = parseDiameterMm(sorted[0]);
            if (dia < 4 || dia > 60) dia = 16;
        }
        dia = Math.round(dia);
        assignedColorHex = getRebarColorByDiameter(dia);
        metaAttrs.diameter = dia;
    } else {
        assignedColorHex = ENTITY_DEFAULT_COLORS[typeName] || '#78716c';
    }

    const meshColor = new THREE.Color(assignedColorHex);
    const rawColor = placedGeometry.color;
    const opacity = rawColor?.w < 0.98 ? rawColor.w : 1.0;
    const isTransparent = opacity < 0.99;
    const matKey = `${typeName}_${meshColor.getHexString()}_${opacity.toFixed(2)}`;

    // TÁI SỬ DỤNG MATERIAL CACHE CHO HÀNG NGHÌN ĐỐI TƯỢNG (GIẢM BỘ NHỚ VRAM & DRAW CALLS)
    let material = materialCache.get(matKey);
    if (!material) {
        material = new THREE.MeshStandardMaterial({
            color: meshColor,
            opacity: opacity,
            transparent: isTransparent,
            roughness: isRebar ? 0.35 : 0.6,
            metalness: isRebar ? 0.45 : 0.08,
            side: THREE.DoubleSide,
            depthWrite: !isTransparent,
            clippingPlanes: isCropBoxActive.value ? clippingPlanes : null
        });
        material.wireframe = isWireframe.value;
        materialCache.set(matKey, material);
    }
    const activeClippingPlanes = isCropBoxActive.value ? clippingPlanes : null;
    if (material.clippingPlanes !== activeClippingPlanes) {
        material.clippingPlanes = activeClippingPlanes;
        material.needsUpdate = true;
    }
    applyModelOpacityToMaterial(material);

    const mesh = new THREE.Mesh(bufferGeo, material);
    const matrix = new THREE.Matrix4();
    matrix.fromArray(placedGeometry.flatTransformation);
    // Dời gốc tương đối theo cấu kiện đầu tiên (tính bằng double) để tránh mất chính xác float32 khi model ở xa gốc tọa độ
    if (!rt.modelRebaseOrigin) rt.modelRebaseOrigin = new THREE.Vector3(matrix.elements[12], matrix.elements[13], matrix.elements[14]);
    matrix.elements[12] -= rt.modelRebaseOrigin.x;
    matrix.elements[13] -= rt.modelRebaseOrigin.y;
    matrix.elements[14] -= rt.modelRebaseOrigin.z;
    mesh.applyMatrix4(matrix);

    mesh.userData = {
        expressID: expressID,
        meshKey: createMeshKey(metaAttrs.sourceId, expressID),
        sourceId: metaAttrs.sourceId || null,
        sourceModelID: metaAttrs.sourceModelID ?? null,
        sourceFileName: metaAttrs.sourceFileName || '',
        sourceVisible: true,
        type: typeName,
        schemaType: metaAttrs.schemaType || typeName,
        isRebar: isRebar,
        name: metaAttrs.name || t('Cấu kiện #{0}', [expressID]),
        tag: metaAttrs.tag || '',
        objectType: metaAttrs.objectType || '',
        description: metaAttrs.description || '',
        diameter: metaAttrs.diameter || 0,
        colorByDiameter: isRebar ? assignedColorHex : '',
        originalMaterial: material,
        isFaulty: false
    };

    return mesh;
};

export const checkIfFaultyRebar = (mesh) => {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const minDim = Math.min(size.x, size.y, size.z);
    return (maxDim < 0.01 || maxDim > 25.0 || minDim < 0.003);
};

export const centerModelByBoundingBox = () => {
    rt.modelGroup.updateWorldMatrix(true, true);
    const inverseModelMatrix = rt.modelGroup.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    rt.modelGroup.children.forEach(mesh => {
        if (!mesh.isMesh || !mesh.geometry) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (!mesh.geometry.boundingBox) return;
        const toModelLocal = inverseModelMatrix.clone().multiply(mesh.matrixWorld);
        box.union(mesh.geometry.boundingBox.clone().applyMatrix4(toModelLocal));
    });
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    rt.modelGroup.position.set(-center.x, -box.min.y, -center.z);
    rt.modelOffset.set(-center.x, -box.min.y, -center.z);
    updateTransportScene();
};

export const clearCurrentModel = () => {
    clearClashResults();
    clearSelection();
    resetTransportState();
    rt.hoveredMesh = null;
    hoveredType.value = '';
    deletedItems.value = [];
    pendingDeletedExpressIDs.clear();
    manuallyHiddenExpressIDs.clear();
    exportListVersion.value++;

    // Nhãn thông tin nằm trên sàn của mô hình mẫu
    if (rt.sampleInfoLabel) {
        rt.sampleInfoLabel.parent?.remove(rt.sampleInfoLabel);
        rt.sampleInfoLabel.geometry.dispose();
        rt.sampleInfoLabel.material.map?.dispose();
        rt.sampleInfoLabel.material.dispose();
        rt.sampleInfoLabel = null;
    }

    while (rt.modelGroup.children.length > 0) {
        const child = rt.modelGroup.children[0];
        if (child === edgesGroup || child === batchGroup || child === overlayGroup) {
            rt.modelGroup.remove(child);
            continue;
        }
        if (child.geometry) child.geometry.dispose();
        rt.modelGroup.remove(child);
    }

    while (edgesGroup.children.length > 0) {
        const edgeLine = edgesGroup.children[0];
        if (edgeLine.geometry) edgeLine.geometry.dispose();
        edgesGroup.remove(edgeLine);
    }
    rt.modelGroup.add(edgesGroup);
    rt.modelGroup.add(batchGroup);
    rt.modelGroup.add(overlayGroup);
    rebuildBatches();

    rt.modelGroup.position.set(0, 0, 0);
    rt.modelOffset.set(0, 0, 0);
    rt.modelRebaseOrigin = null;
    stats.meshes = 0;
    stats.rebarCount = 0;
    faultyCount.value = 0;
    allGroups.pos = [];
    allGroups.name = [];
    allGroups.objectType = [];
    allGroups.entity = [];
};
