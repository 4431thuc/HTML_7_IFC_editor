import { getMeshKey, visibleExportItems } from '../core/helpers.js';
import { applyIfcTransportToModel, getSourceTransportMatrix } from './transport.js';
import { applyHeaderOverrides } from './project-info.js';
import { deletedItems, editHistoryCount, fileName, hasUnsavedChanges, isLoading, isSampleModel, loadingText, pendingDeletedExpressIDs, rt, sourceFiles } from '../state/state.js';
import { showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';

export const exportModifiedIFC = () => {
    if (isSampleModel.value || rt.currentModelID === null) {
        showToast(t('Chưa có IFC để lưu'), t('Mở ít nhất một file IFC thật trước khi lưu file mới.'), 'error');
        return;
    }

    try {
        isLoading.value = true;
        loadingText.value = t('Đang tạo IFC kết hợp và áp dụng danh sách xóa...');
        const data = createFilteredIfcData('edited');
        downloadIfcData(data, sourceFiles.value.length > 1 ? '_combined_edited' : '_edited');
        editHistoryCount.value = 0;
        hasUnsavedChanges.value = false;
        showToast(t('Xuất tệp thành công!'), t('Đã lưu IFC với {0} cấu kiện đã xóa.', [pendingDeletedExpressIDs.size]), 'success');

    } catch (err) {
        console.error('Lỗi lưu file IFC:', err);
        showToast(t('Lỗi xuất tệp'), err.message || t('Không thể lưu file IFC.'));
    } finally {
        isLoading.value = false;
    }
};

export const exportVisibleIFC = () => {
    if (isSampleModel.value || rt.currentModelID === null) {
        showToast(t('Thông báo'), t('Hãy mở một file IFC thật trước khi xuất.'));
        return;
    }
    try {
        isLoading.value = true;
        loadingText.value = t('Đang tạo IFC chỉ gồm các cấu kiện đang hiển thị...');
        const data = createFilteredIfcData('visible');
        downloadIfcData(data, sourceFiles.value.length > 1 ? '_combined_visible' : '_visible');
        showToast(t('Xuất thành công'), t('Đã lưu IFC với {0} cấu kiện đang hiển thị.', [visibleExportItems.value.length]), 'success');
    } catch (err) {
        console.error('Lỗi xuất IFC đang hiển thị:', err);
        showToast(t('Lỗi xuất IFC'), err.message || t('Không thể xuất các cấu kiện đang hiển thị.'));
    } finally {
        isLoading.value = false;
    }
};

export const exportCombineIFC = () => {
    if (sourceFiles.value.length === 0) {
        showToast(t('Chưa có file IFC'), t('Mở hoặc thêm ít nhất một file IFC trước khi xuất.'));
        return;
    }
    try {
        isLoading.value = true;
        loadingText.value = t('Đang kết hợp {0} file IFC...', [sourceFiles.value.length]);
        const buffers = sourceFiles.value.map(createTransportedSourceData);
        const combinedData = mergeIfcData(buffers);
        downloadIfcData(combinedData, '_combined');
        showToast(t('Xuất gộp thành công'), t('Đã gộp {0} file IFC vào một file duy nhất.', [sourceFiles.value.length]));
    } catch (error) {
        console.error('Lỗi export IFC kết hợp:', error);
        showToast(t('Lỗi xuất gộp'), error.message || t('Không thể kết hợp các file IFC.'));
    } finally {
        isLoading.value = false;
    }
};

export const createTransportedSourceData = (source) => {
    const sourceData = rt.ifcAPI.SaveModel(source.modelID);
    if (!sourceData || sourceData.length === 0) throw new Error(t('Dữ liệu IFC "{0}" rỗng.', [source.name]));
    const tempModelID = rt.ifcAPI.OpenModel(new Uint8Array(sourceData));
    if (tempModelID < 0) throw new Error(t('Không thể mở bản IFC tạm của "{0}".', [source.name]));
    try {
        applyIfcTransportToModel(tempModelID, source.unitMeters || 1, getSourceTransportMatrix(source.id));
        const result = rt.ifcAPI.SaveModel(tempModelID);
        if (!result || result.length === 0) throw new Error(t('Dữ liệu IFC đã dịch chuyển từ "{0}" rỗng.', [source.name]));
        return result;
    } finally {
        rt.ifcAPI.CloseModel(tempModelID);
    }
};

export const createFilteredIfcData = (mode) => {
    if (sourceFiles.value.length === 0) throw new Error(t('Chưa có file IFC để xuất.'));
    const results = sourceFiles.value.map(source => {
        const sourceData = rt.ifcAPI.SaveModel(source.modelID);
        if (!sourceData || sourceData.length === 0) throw new Error(t('Dữ liệu IFC "{0}" rỗng.', [source.name]));

        const tempModelID = rt.ifcAPI.OpenModel(new Uint8Array(sourceData));
        if (tempModelID < 0) throw new Error(t('Không thể mở bản IFC tạm của "{0}".', [source.name]));
        try {
            applyIfcTransportToModel(tempModelID, source.unitMeters || 1, getSourceTransportMatrix(source.id));
            const allMeshIds = new Set();
            const visibleMeshIds = new Set();
            const sourceMeshes = rt.modelGroup.children.filter(mesh => mesh.isMesh && mesh.userData.sourceId === source.id);
            sourceMeshes.forEach(mesh => {
                const id = mesh.userData.expressID;
                allMeshIds.add(id);
                if (mesh.visible && !pendingDeletedExpressIDs.has(getMeshKey(mesh))) visibleMeshIds.add(id);
            });

            const idsToDelete = new Set();
            if (mode === 'edited' || mode === 'visible') {
                deletedItems.value.filter(item => item.sourceId === source.id).forEach(item => idsToDelete.add(item.expressID));
            }
            if (mode === 'visible') {
                allMeshIds.forEach(id => {
                    if (!visibleMeshIds.has(id)) idsToDelete.add(id);
                });
            }

            removeDeletedProductsFromRelationships(tempModelID, idsToDelete);
            idsToDelete.forEach(id => {
                if (rt.ifcAPI.GetLineType(tempModelID, id) !== 0) rt.ifcAPI.DeleteLine(tempModelID, id);
            });
            const result = rt.ifcAPI.SaveModel(tempModelID);
            if (!result || result.length === 0) throw new Error(t('Dữ liệu IFC xuất ra từ "{0}" rỗng.', [source.name]));
            return result;
        } finally {
            rt.ifcAPI.CloseModel(tempModelID);
        }
    });
    return mergeIfcData(results);
};

export const mergeIfcData = (buffers) => {
    if (buffers.length === 0) throw new Error(t('Không có dữ liệu IFC để kết hợp.'));
    if (buffers.length === 1) return buffers[0];

    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();
    let outputHeader = '';
    let expectedSchema = '';
    let idOffset = 0;
    const globalIds = new Set();
    const guidAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
    const combinedDataSections = [];

    buffers.forEach((buffer, index) => {
        const text = decoder.decode(buffer);
        const dataMarker = /(?:^|\n)\s*DATA\s*;/i.exec(text);
        const ending = /\bENDSEC\s*;\s*END-ISO-10303-21\s*;\s*$/i.exec(text.trimEnd());
        if (!dataMarker || !ending || ending.index <= dataMarker.index) {
            throw new Error(t('Không đọc được cấu trúc IFC-SPF của file thứ {0}.', [index + 1]));
        }

        const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(text);
        const schema = schemaMatch ? schemaMatch[1].toUpperCase() : '';
        if (!schema) throw new Error(t('Không xác định được IFC schema của file thứ {0}.', [index + 1]));
        if (expectedSchema && schema !== expectedSchema) {
            throw new Error(t('Không thể gộp khác IFC schema ({0} và {1}).', [expectedSchema, schema]));
        }
        expectedSchema = schema;

        if (index === 0) outputHeader = text.slice(0, dataMarker.index).trimEnd();
        const bodyStart = dataMarker.index + dataMarker[0].length;
        const bodyEnd = ending.index;
        const body = text.slice(bodyStart, bodyEnd);
        const idPattern = /#(\d+)\s*=/g;
        let match;
        let maxId = 0;
        while ((match = idPattern.exec(body)) !== null) maxId = Math.max(maxId, Number(match[1]));
        if (maxId === 0) throw new Error(t('Không tìm thấy thực thể nào trong file thứ {0}.', [index + 1]));

        const remappedReferences = body.replace(/'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|#(\d+)/g, (token, referenceId) => {
            return referenceId ? `#${Number(referenceId) + idOffset}` : token;
        });
        const uniqueGlobalIds = remappedReferences.replace(/(#\d+\s*=\s*IFC[A-Z0-9_]+\s*\(\s*)'([0-3][0-9A-Za-z_$]{21})'/g, (match, prefix, globalId) => {
            if (!globalIds.has(globalId)) {
                globalIds.add(globalId);
                return match;
            }
            const originalHigh = guidAlphabet.indexOf(globalId[20]);
            const originalLow = guidAlphabet.indexOf(globalId[21]);
            let replacement = '';
            for (let offset = 1; offset <= 4096; offset++) {
                const lowValue = originalLow + offset;
                const highValue = originalHigh + Math.floor(lowValue / guidAlphabet.length);
                const candidate = `${globalId.slice(0, 20)}${guidAlphabet[highValue % guidAlphabet.length]}${guidAlphabet[lowValue % guidAlphabet.length]}`;
                if (!globalIds.has(candidate)) {
                    replacement = candidate;
                    break;
                }
            }
            if (!replacement) throw new Error(t('Không tạo được GlobalId duy nhất khi gộp IFC.'));
            globalIds.add(replacement);
            return `${prefix}'${replacement}'`;
        });
        combinedDataSections.push(uniqueGlobalIds);
        idOffset += maxId;
    });

    const combinedText = `${outputHeader}\nDATA;\n${combinedDataSections.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
    return encoder.encode(combinedText);
};

export const removeDeletedProductsFromRelationships = (modelID, deletedIds) => {
    if (deletedIds.size === 0) return;
    const relationUpdates = [];
    const relationDeletes = [];
    const lineIds = rt.ifcAPI.GetAllLines(modelID);

    for (let i = 0; i < lineIds.size(); i++) {
        const expressID = lineIds.get(i);
        const typeName = (rt.ifcAPI.GetNameFromTypeCode(rt.ifcAPI.GetLineType(modelID, expressID)) || '').toUpperCase();
        if (!typeName.startsWith('IFCREL')) continue;
        const relation = rt.ifcAPI.GetLine(modelID, expressID, false);
        if (!relation) continue;

        let changed = false;
        let shouldDelete = false;
        Object.keys(relation).forEach(key => {
            if (!/^(Related|Relating)/i.test(key)) return;
            const value = relation[key];
            if (Array.isArray(value)) {
                const filtered = value.filter(reference =>
                    !(reference && typeof reference === 'object' && deletedIds.has(Number(reference.value))));
                if (filtered.length !== value.length) {
                    relation[key] = filtered;
                    changed = true;
                    if (filtered.length === 0 && /^Related/i.test(key)) shouldDelete = true;
                }
            } else if (value && typeof value === 'object' && deletedIds.has(Number(value.value))) {
                shouldDelete = true;
            }
        });

        if (shouldDelete) relationDeletes.push(expressID);
        else if (changed) relationUpdates.push(relation);
    }

    relationUpdates.forEach(relation => rt.ifcAPI.WriteLine(modelID, relation));
    relationDeletes.forEach(expressID => rt.ifcAPI.DeleteLine(modelID, expressID));
};

export const downloadIfcData = (data, suffix) => {
    const blob = new Blob([applyHeaderOverrides(data)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const originalBase = fileName.value.replace(/\.[^/.]+$/, '');
    link.download = `${originalBase}${suffix}.ifc`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
