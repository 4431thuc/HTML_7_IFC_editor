import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { createApp, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { answerClashCancelPrompt, clearClashResults, onClashButtonClick, describeClashElement, formatClashDuplicate, formatClashVolume, requestClearClashResults, runClashCheck, toggleClashHideOtherRebar, toggleClashPairObjects, toggleClashView, zoomToClash } from './clash/clash.js';
import { formatDimCoords, formatDimDistance, removeDimension, toggleDimensionMode, zoomToDimension } from './dimension/dimension.js';
import { visibleExportItems } from './core/helpers.js';
import { canRedo, canUndo, redo, redoLabel, undo, undoLabel } from './core/history.js';
import { lang, t, toggleLanguage } from './i18n/index.js';
import { exportCombineIFC, exportModifiedIFC, exportVisibleIFC } from './ifc/export.js';
import { clashTypeOptions, filteredGroups, queueSelectedForRemoval, restoreRemovedItem, setAllActiveGroupsVisibility, toggleSelectedVisibility, toggleSingleGroupVisibility } from './ifc/groups.js';
import { answerDuplicateFilePrompt, handleAddIfcFiles, handleFileUpload, handleIfcDragEnter, handleIfcDragLeave, handleIfcDragOver, handleIfcDrop, removeSourceFile, toggleSourceVisibility } from './ifc/loader.js';
import { applyTransport, deleteTransportProfile, exportTransportProfiles, importTransportProfiles, loadTransportProfiles, openTransportProfileDialog, saveTransportProfile, undoTransport, useTransportProfile } from './ifc/transport.js';
import { cropToSelectedObjects, resetCropBoxToModel, toggleCropBox, toggleOutsideCropEdges } from './scene/cropbox.js';
import { applyXRayMaterialEffect, recalculateAllNormals, toggleEdges, toggleFilterFaultyBars, toggleFlatShading, toggleGrid, toggleRebarOnly, toggleWireframe, toggleXRayMode } from './scene/display.js';
import { redrawSampleInfoLabel } from './scene/sample-model.js';
import { fitCameraToModel, fitCameraToTarget, initThreeJS, initWebIFC, onWindowResize, setBackgroundTheme, setLightAngle, setViewDirection, toggleCameraProjection, updateLighting } from './scene/scene.js';
import { handleKeyDown, handleKeyUp, onPointerLeave } from './selection/input.js';
import { clearSelection, isMeshManuallyHidden, isMeshPendingRemoval, isMeshSelected, onGroupMouseEnter, onGroupMouseLeave, onItemClick, onItemDblClick, onItemMouseEnter, onItemMouseLeave, selectGroupMeshes, zoomToGroup } from './selection/selection.js';
import { duplicateFilePrompt, currentProjectInfo, projectInfoDirty, projectInfoSourceId, allGroups, axisGizmoXLabel, axisGizmoXLine, axisGizmoXPoint, axisGizmoYLabel, axisGizmoYLine, axisGizmoYPoint, axisGizmoZLabel, axisGizmoZLine, axisGizmoZPoint, canvasContainer, clashBusy, clashCount, clashError, clashItems, clashModeActive, clashProgress, clashToleranceMm, clashTypeA, clashTypeB, clashVolume, contextMenu, deletedItems, dimItems, dimModeActive, deletedObjectCount, dontShowIntroAgain, editHistoryCount, editableAttributes, faultyCount, fileName, filterFaultyBars, groupCriterion, groupListContainer, groupSearchQuery, hasAttributeChanges, hasLoadedIfc, hasUnsavedChanges, hiddenObjectCount, hoveredType, introPanelContent, introPanelStorageKey, isBoxSelecting, isCropBoxActive, isEditingAttributes, isFlatShading, isIfcDragOver, isLightBackground, isLoading, isOrthographic, isRebarOnly, isSampleModel, isWireframe, isXRayMode, leftActiveTab, leftPanelWidth, lightExposure, lightPreset, loadingText, modelOpacityPercent, openFileCount, rightPanelWidth, rt, selectedClashId, selectedDimId, selectedMeshes, statusIndicator, selectedObject, selectionOutlineMaterial, selectionOutlines, showClashPairObjects, showEdges, showGrid, showIntroPanel, showLeftPanel, showOutsideCropEdges, showRightPanel, showTransportProfileModal, sourceFiles, stats, toastMessage, toastTitle, toastType, transportHistory, transportInnerTab, transportInputs, transportProfileName, transportProfileNameInput, transportProfiles, wasmReady, xrayOpacity } from './state/state.js';
import { hoverViewDir, viewCubeEl } from './state/state.js';
import { SHOW_BAR_SCHEDULE_TAB, VIEW_CUBE_FACES } from './state/constants.js';
import { clashCancelPrompt, clashConnectorCount, clashDuplicateCount, clashHideOtherRebar, clashResultsReady, clashSkippedConnectionPairs } from './state/state.js';
import { applyGroupColorScheme, openGroupTabMenu, resetGroupColorScheme } from './ifc/color-scheme.js';
import { closeContextMenu, contextMenuAction, handleContextMenuEscape, handleContextMenuOutsidePointer, openContextMenu } from './ui/context-menu.js';
import { adjustPanelWidth, boxSelectionStyle, closeIntroPanel, endPanelResize, persistModelOpacity, playUiPop, startPanelResize, togglePropertiesPanel, updateModelOpacity, updatePanelResize } from './ui/panels.js';
import { resetEditableAttributes, saveAttributeChanges } from './ui/properties.js';
import { applyProjectInfoChanges, resetProjectInfo } from './ifc/project-info.js';
import { NumberField } from './ui/number-field.js';
import { initButtonStyle } from './ui/button-style.js';
import { applyPsetEdit } from './ifc/pset-edit.js';
import { computeBarSchedule, exportBarScheduleCsv, exportBarScheduleExcel, formatScheduleLength, scheduleBarScheduleRefresh, selectBarScheduleRow } from './ifc/bar-schedule.js';
import { barScheduleDiameters, barScheduleRows, barScheduleSplitByFile, barScheduleStale, barScheduleTotals, barScheduleVisibleOnly, exportListVersion } from './state/state.js';
import { psetEditDialog } from './state/state.js';
import { getSelectedCoords, getSourceCoords } from './ui/coords-info.js';
import { coordVersion } from './state/state.js';
import { groupColorScheme, groupTabMenu, modelEdgeAngleDeg, snapEdgeAngleDeg } from './state/state.js';
import { applyModelEdgeAngle } from './scene/display.js';
import { applySnapEdgeAngle } from './dimension/dimension.js';

// Kích hoạt raycast/bounds tree tăng tốc bằng three-mesh-bvh
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

createApp({
    setup() {
        // Đổi ngôn ngữ: vẽ lại phần chữ nằm trong canvas 3D (bảng thông tin model mẫu)
        watch(lang, redrawSampleInfoLabel);
        // Bảng thống kê thép: đánh dấu cũ khi ẩn/hiện/xóa/đổi tùy chọn, tự lập lại khi tab đang mở
        watch([exportListVersion, barScheduleVisibleOnly, barScheduleSplitByFile, lang], () => { barScheduleStale.value = true; });
        watch([leftActiveTab, barScheduleStale], ([tab, stale]) => {
            if (tab === 'schedule' && stale) scheduleBarScheduleRefresh();
        });

        // --- LIFECYCLE HOOKS ---
        onMounted(async () => {
            initThreeJS();
            initButtonStyle();
            loadTransportProfiles();
            rt.canvasResizeObserver = new ResizeObserver(() => nextTick(onWindowResize));
            if (canvasContainer.value) rt.canvasResizeObserver.observe(canvasContainer.value);
            try {
                showIntroPanel.value = localStorage.getItem(introPanelStorageKey) !== 'true';
            } catch (error) {
                showIntroPanel.value = true;
            }
            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);
            window.addEventListener('pointerdown', handleContextMenuOutsidePointer, true);
            window.addEventListener('keydown', handleContextMenuEscape);
            await initWebIFC();
        });

        onBeforeUnmount(() => {
            cancelAnimationFrame(rt.animationFrameId);
            if (rt.canvasResizeObserver) rt.canvasResizeObserver.disconnect();
            window.removeEventListener('resize', onWindowResize);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('pointerdown', handleContextMenuOutsidePointer, true);
            window.removeEventListener('keydown', handleContextMenuEscape);
            if (rt.renderer) rt.renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
            if (rt.renderer) rt.renderer.dispose();
            if (rt.selectionOutline) {
                if (rt.scene) rt.scene.remove(rt.selectionOutline);
                rt.selectionOutline.geometry.dispose();
                rt.selectionOutline = null;
            }
            selectionOutlineMaterial.dispose();
        });

        return {
            t,
            lang,
            toggleLanguage,
            canvasContainer,
            introPanelContent,
            showIntroPanel,
            dontShowIntroAgain,
            closeIntroPanel,
            playUiPop,
            axisGizmoXLine,
            axisGizmoYLine,
            axisGizmoZLine,
            axisGizmoXLabel,
            axisGizmoYLabel,
            axisGizmoZLabel,
            axisGizmoXPoint,
            axisGizmoYPoint,
            axisGizmoZPoint,
            viewCubeEl,
            hoverViewDir,
            viewCubeFaces: VIEW_CUBE_FACES,
            groupListContainer,
            wasmReady,
            statusIndicator,
            isLoading,
            loadingText,
            toastMessage,
            toastTitle,
            toastType,
            fileName,
            hasLoadedIfc,
            sourceFiles,
            isIfcDragOver,
            hiddenObjectCount,
            deletedObjectCount,
            openFileCount,
            modelOpacityPercent,
            updateModelOpacity,
            persistModelOpacity,
            transportInputs,
            transportInnerTab,
            transportProfiles,
            transportHistory,
            showTransportProfileModal,
            transportProfileName,
            transportProfileNameInput,
            openTransportProfileDialog,
            saveTransportProfile,
            exportTransportProfiles,
            importTransportProfiles,
            useTransportProfile,
            deleteTransportProfile,
            applyTransport,
            undoTransport,
            showLeftPanel,
            showRightPanel,
            togglePropertiesPanel,
            leftPanelWidth,
            rightPanelWidth,
            startPanelResize,
            updatePanelResize,
            endPanelResize,
            adjustPanelWidth,
            leftActiveTab,
            dimModeActive,
            dimItems,
            selectedDimId,
            toggleDimensionMode,
            zoomToDimension,
            removeDimension,
            formatDimCoords,
            applyPsetEdit,
            psetEditDialog,
            coordVersion,
            getSelectedCoords,
            getSourceCoords,
            formatDimDistance,
            clashModeActive,
            clashResultsReady,
            clashHideOtherRebar,
            describeClashElement,
            formatClashVolume,
            formatClashDuplicate,
            clashDuplicateCount,
            clashSkippedConnectionPairs,
            clashConnectorCount,
            toggleClashHideOtherRebar,
            clashCancelPrompt,
            toggleClashView,
            requestClearClashResults,
            answerClashCancelPrompt,
            showBarScheduleTab: SHOW_BAR_SCHEDULE_TAB,
            clashBusy,
            clashCount,
            clashVolume,
            clashError,
            clashItems,
            clashTypeA,
            clashTypeB,
            clashToleranceMm,
            clashTypeOptions,
            selectedClashId,
            runClashCheck,
            onClashButtonClick,
            clashProgress,
            clearClashResults,
            zoomToClash,
            showClashPairObjects,
            toggleClashPairObjects,
            groupCriterion,
            groupSearchQuery,
            isRebarOnly,
            isXRayMode,
            filterFaultyBars,
            isWireframe,
            isFlatShading,
            showGrid,
            showEdges,
            lightExposure,
            lightPreset,
            xrayOpacity,
            isOrthographic,
            isLightBackground,
            isCropBoxActive,
            hoveredType,
            faultyCount,
            editHistoryCount,
            hasUnsavedChanges,
            canUndo,
            canRedo,
            barScheduleRows,
            barScheduleDiameters,
            barScheduleTotals,
            barScheduleVisibleOnly,
            barScheduleSplitByFile,
            barScheduleStale,
            computeBarSchedule,
            exportBarScheduleCsv,
            exportBarScheduleExcel,
            formatScheduleLength,
            selectBarScheduleRow,
            undoLabel,
            redoLabel,
            undo,
            redo,
            stats,
            selectedMeshes,
            selectedObject,
            isSampleModel,
            showOutsideCropEdges,
            deletedItems,
            visibleExportItems,
            isEditingAttributes,
            editableAttributes,
            hasAttributeChanges,
            allGroups,
            filteredGroups,
            isBoxSelecting,
            boxSelectionStyle,
            contextMenu,
            handleFileUpload,
            handleAddIfcFiles,
            handleIfcDragEnter,
            handleIfcDragOver,
            handleIfcDragLeave,
            handleIfcDrop,
            toggleSourceVisibility,
            duplicateFilePrompt,
            answerDuplicateFilePrompt,
            removeSourceFile,
            fitCameraToTarget,
            fitCameraToModel,
            toggleWireframe,
            toggleFlatShading,
            toggleGrid,
            toggleEdges,
            toggleCameraProjection,
            setViewDirection,
            setBackgroundTheme,
            toggleCropBox,
            toggleOutsideCropEdges,
            cropToSelectedObjects,
            resetCropBoxToModel,
            recalculateAllNormals,
            updateLighting,
            setLightAngle,
            applyXRayMaterialEffect,
            clearSelection,
            toggleRebarOnly,
            toggleXRayMode,
            toggleFilterFaultyBars,
            toggleSingleGroupVisibility,
            setAllActiveGroupsVisibility,
            onGroupMouseEnter,
            onGroupMouseLeave,
            selectGroupMeshes,
            zoomToGroup,
            onItemMouseEnter,
            onItemMouseLeave,
            onItemClick,
            onItemDblClick,
            isMeshSelected,
            isMeshManuallyHidden,
            isMeshPendingRemoval,
            openContextMenu,
            applyGroupColorScheme,
            openGroupTabMenu,
            resetGroupColorScheme,
            groupColorScheme,
            groupTabMenu,
            modelEdgeAngleDeg,
            snapEdgeAngleDeg,
            applyModelEdgeAngle,
            applySnapEdgeAngle,
            closeContextMenu,
            contextMenuAction,
            saveAttributeChanges,
            resetEditableAttributes,
            currentProjectInfo,
            projectInfoDirty,
            projectInfoSourceId,
            applyProjectInfoChanges,
            resetProjectInfo,
            exportModifiedIFC,
            exportVisibleIFC,
            exportCombineIFC,
            queueSelectedForRemoval,
            restoreRemovedItem,
            toggleSelectedVisibility,
            handleKeyDown,
            handleKeyUp
        };
    }
}).component('number-field', NumberField).mount('#app');
