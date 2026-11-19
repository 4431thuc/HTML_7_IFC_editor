import { computed } from 'vue';
import { boxEnd, boxStart, currentProjectInfo, dontShowIntroAgain, edgeMaterial, hoverMaterial, introPanelStorageKey, leftPanelWidth, materialCache, modelOpacityBases, modelOpacityPercent, modelOpacityStorageKey, rightPanelWidth, rt, selectMaterial, selectedMeshes, showIntroPanel, showLeftPanel, showRightPanel, toastMessage, toastTitle, toastType, xrayMaterials } from '../state/state.js';
import { t } from '../i18n/index.js';

export const playUiPop = (frequencyOrEvent = 620) => {
    const frequency = typeof frequencyOrEvent === 'number' ? frequencyOrEvent : 620;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!rt.uiAudioContext) rt.uiAudioContext = new AudioContextClass();
        if (rt.uiAudioContext.state === 'suspended') rt.uiAudioContext.resume();

        const now = rt.uiAudioContext.currentTime;
        const oscillator = rt.uiAudioContext.createOscillator();
        const gain = rt.uiAudioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, now + 0.035);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.025, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        oscillator.connect(gain);
        gain.connect(rt.uiAudioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.06);
    } catch (error) {
        console.warn('Không thể phát âm thanh giao diện:', error);
    }
};
export const closeIntroPanel = () => {
    showIntroPanel.value = false;
    if (dontShowIntroAgain.value) {
        try { localStorage.setItem(introPanelStorageKey, 'true'); }
        catch (error) { console.warn('Không thể lưu trạng thái ẩn banner giới thiệu:', error); }
    }
};
export const togglePropertiesPanel = () => {
    if (!showRightPanel.value && selectedMeshes.value.length === 0 && !currentProjectInfo.value) return;
    showRightPanel.value = !showRightPanel.value;
};
export const getPanelWidthLimit = (side) => {
    const otherPanelWidth = side === 'left'
        ? (showRightPanel.value ? rightPanelWidth.value : 0)
        : (showLeftPanel.value ? leftPanelWidth.value : 0);
    return Math.max(240, Math.min(640, window.innerWidth - otherPanelWidth - 280));
};
export const startPanelResize = (side, event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    rt.panelResizeState = {
        side,
        startX: event.clientX,
        startWidth: side === 'left' ? leftPanelWidth.value : rightPanelWidth.value
    };
    event.currentTarget.setPointerCapture(event.pointerId);
};
export const updatePanelResize = (event) => {
    if (!rt.panelResizeState) return;
    const delta = event.clientX - rt.panelResizeState.startX;
    const direction = rt.panelResizeState.side === 'left' ? 1 : -1;
    const width = Math.max(240, Math.min(
        getPanelWidthLimit(rt.panelResizeState.side),
        rt.panelResizeState.startWidth + delta * direction
    ));
    if (rt.panelResizeState.side === 'left') leftPanelWidth.value = width;
    else rightPanelWidth.value = width;
};
export const endPanelResize = () => {
    rt.panelResizeState = null;
};
export const adjustPanelWidth = (side, delta) => {
    const width = side === 'left' ? leftPanelWidth : rightPanelWidth;
    width.value = Math.max(240, Math.min(getPanelWidthLimit(side), width.value + delta));
};
export const getModelOpacityBase = (material) => {
    let base = modelOpacityBases.get(material);
    if (!base) {
        base = {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite
        };
        modelOpacityBases.set(material, base);
    }
    return base;
};
export const applyModelOpacityToMaterial = (material, baseOpacity) => {
    if (!material || !('opacity' in material)) return;
    const base = getModelOpacityBase(material);
    if (baseOpacity !== undefined) base.opacity = baseOpacity;
    const opacityFactor = modelOpacityPercent.value / 100;
    const transparent = base.transparent || opacityFactor < 1;
    if (material.transparent !== transparent) material.needsUpdate = true;
    material.opacity = base.opacity * opacityFactor;
    material.transparent = transparent;
    material.depthWrite = base.depthWrite;
};
export const applyModelOpacityToScene = () => {
    const materials = new Set([
        edgeMaterial,
        hoverMaterial,
        selectMaterial,
        ...Object.values(xrayMaterials),
        ...materialCache.values()
    ]);
    const addMaterial = (material) => {
        if (Array.isArray(material)) material.forEach(item => materials.add(item));
        else if (material) materials.add(material);
    };
    rt.modelGroup.children.forEach(mesh => {
        if (mesh.isMesh) addMaterial(mesh.material);
    });
    materials.forEach(material => applyModelOpacityToMaterial(material));
};
export const updateModelOpacity = () => {
    applyModelOpacityToScene();
};
export const persistModelOpacity = () => {
    try {
        localStorage.setItem(modelOpacityStorageKey, String(modelOpacityPercent.value));
    } catch (error) {
        console.error('Không thể lưu cài đặt độ mờ mô hình:', error);
        showToast(t('Không lưu được cài đặt'), t('Độ mờ đã áp dụng nhưng không thể lưu vào trình duyệt.'));
    }
};

export const showToast = (title, message, type = 'error') => {
    toastTitle.value = title;
    toastMessage.value = message;
    toastType.value = type;
    if (type === 'success') {
        setTimeout(() => {
            if (toastMessage.value === message) toastMessage.value = '';
        }, 4000);
    }
};

export const boxSelectionStyle = computed(() => {
    const x = Math.min(boxStart.x, boxEnd.x);
    const y = Math.min(boxStart.y, boxEnd.y);
    const w = Math.abs(boxEnd.x - boxStart.x);
    const h = Math.abs(boxEnd.y - boxStart.y);
    return {
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`
    };
});
