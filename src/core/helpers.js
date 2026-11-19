import { computed, toRaw } from 'vue';
import { exportListVersion, pendingDeletedExpressIDs, rt } from '../state/state.js';

export const requestRender = () => { rt.needsRender = true; };
export const createMeshKey = (sourceId, expressID) => `${sourceId || 'demo'}:${expressID}`;
export const getMeshKey = (mesh) => mesh.userData.meshKey || createMeshKey(mesh.userData.sourceId, mesh.userData.expressID);
export const getObjectMeshes = (mesh) => rt.meshesByKey.get(getMeshKey(toRaw(mesh))) || [toRaw(mesh)];
export const countLogicalObjects = () => new Set(rt.modelGroup.children.filter(c => c.isMesh).map(getMeshKey)).size;
export const getPsetCacheKey = (sourceId, expressID) => createMeshKey(sourceId, expressID);
export const visibleExportItems = computed(() => {
    exportListVersion.value;
    const byId = new Map();
    rt.modelGroup.children.forEach(mesh => {
        if (!mesh.isMesh || !mesh.visible || pendingDeletedExpressIDs.has(getMeshKey(mesh))) return;
        const key = getMeshKey(mesh);
        if (!byId.has(key)) {
            byId.set(key, {
                key,
                expressID: mesh.userData.expressID,
                type: mesh.userData.type,
                name: mesh.userData.name,
                fileName: mesh.userData.sourceFileName || 'Mô hình mẫu'
            });
        }
    });
    return Array.from(byId.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
});
