import { toRaw } from 'vue';
import { requestRender } from '../core/helpers.js';
import { rebuildBatches } from '../scene/rendering.js';
import { getRebarColorByDiameter } from '../scene/sample-model.js';
import { ENTITY_DEFAULT_COLORS } from '../state/constants.js';
import { allGroups, groupColorScheme, groupTabMenu, rt } from '../state/state.js';
import { showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';
import { getModelMaterial } from './loader.js';

// --- TÔ MÀU MODEL THEO MÀU CHẤM TRÒN CỦA TAB PHÂN NHÓM ---
// Chỉ đổi material hiển thị (userData.originalMaterial), không ghi gì vào IFC nên không vào lịch sử hoàn tác.

const CRITERION_LABELS = { pos: 'Pos Thép', name: 'Tên (Name)', objectType: 'ObjType', entity: 'IFC Type' };

// Màu mặc định lúc nạp: thép theo đường kính, cấu kiện khác theo loại IFC (giống loader.js)
const getDefaultMeshColor = (ud) => {
    if (ud.isRebar) return ud.colorByDiameter || (ud.diameter ? getRebarColorByDiameter(ud.diameter) : '#f59e0b');
    return ENTITY_DEFAULT_COLORS[ud.type] || '#78716c';
};

// Gán material theo màu cho từng cấu kiện; chỉ dựng lại batch khi thật sự có cấu kiện đổi màu
const recolorModel = (colorOf) => {
    let changed = 0;
    rt.modelGroup.children.forEach(mesh => {
        if (!mesh.isMesh) return;
        const ud = mesh.userData;
        const material = getModelMaterial(ud.type, !!ud.isRebar, colorOf(mesh) || getDefaultMeshColor(ud), ud.ifcOpacity ?? 1);
        const current = toRaw(ud.originalMaterial);
        if (current === material) return;
        // Mesh đang mang material gốc (không phải hover/X-Ray...) thì đổi theo
        if (toRaw(mesh.material) === current) mesh.material = material;
        ud.originalMaterial = material;
        changed++;
    });
    if (changed > 0) rebuildBatches();
    requestRender();
    return changed;
};

const buildGroupColorMap = (criterion) => {
    const colorByMesh = new Map();
    (allGroups[criterion] || []).forEach(grp => {
        grp.meshes.forEach(mesh => colorByMesh.set(toRaw(mesh), grp.color));
    });
    return colorByMesh;
};

export const applyGroupColorScheme = (criterion) => {
    closeGroupTabMenu();
    if (!allGroups[criterion]?.length) {
        showToast(t('Chưa có nhóm'), t('Mở file IFC trước khi tô màu theo nhóm.'));
        return;
    }
    const colorByMesh = buildGroupColorMap(criterion);
    groupColorScheme.value = criterion;
    recolorModel(mesh => colorByMesh.get(mesh));
    showToast(t('Đã đổi màu model'), t('Model đang tô theo màu nhóm của tab "{0}".', [t(CRITERION_LABELS[criterion])]), 'success');
};

export const resetGroupColorScheme = () => {
    closeGroupTabMenu();
    if (!groupColorScheme.value) return;
    groupColorScheme.value = '';
    recolorModel(() => null);
    showToast(t('Đã khôi phục màu'), t('Model trở về màu mặc định (theo loại IFC và đường kính thép).'), 'success');
};

// Gọi sau mỗi lần dựng lại danh sách nhóm (nạp thêm file, sửa Name/Pos...): tô lại theo màu nhóm mới
export const reapplyGroupColorScheme = () => {
    const criterion = groupColorScheme.value;
    if (!criterion) return;
    const colorByMesh = buildGroupColorMap(criterion);
    recolorModel(mesh => colorByMesh.get(mesh));
};

export const openGroupTabMenu = (event, criterion) => {
    groupTabMenu.visible = true;
    groupTabMenu.x = Math.min(event.clientX, window.innerWidth - 240);
    groupTabMenu.y = Math.min(event.clientY, window.innerHeight - 110);
    groupTabMenu.criterion = criterion;
};

export const closeGroupTabMenu = () => {
    groupTabMenu.visible = false;
};
