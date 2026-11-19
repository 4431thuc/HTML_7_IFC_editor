import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { createApp, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { clearClashResults, onClashButtonClick, runClashCheck, toggleClashPairObjects, zoomToClash } from './clash/clash.js';
import { formatDimDistance, removeDimension, toggleDimensionMode, zoomToDimension } from './dimension/dimension.js';
import { visibleExportItems } from './core/helpers.js';
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
import { VIEW_CUBE_FACES } from './state/constants.js';
import { closeContextMenu, contextMenuAction, handleContextMenuEscape, handleContextMenuOutsidePointer, openContextMenu } from './ui/context-menu.js';
import { adjustPanelWidth, boxSelectionStyle, closeIntroPanel, endPanelResize, persistModelOpacity, playUiPop, startPanelResize, togglePropertiesPanel, updateModelOpacity, updatePanelResize } from './ui/panels.js';
import { resetEditableAttributes, saveAttributeChanges } from './ui/properties.js';
import { applyProjectInfoChanges, resetProjectInfo } from './ifc/project-info.js';

// Kích hoạt raycast/bounds tree tăng tốc bằng three-mesh-bvh
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

createApp({
    setup() {
        // Đổi ngôn ngữ: vẽ lại phần chữ nằm trong canvas 3D (bảng thông tin model mẫu)
        watch(lang, redrawSampleInfoLabel);

        // --- LIFECYCLE HOOKS ---
        onMounted(async () => {
            initThreeJS();
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
            selectionOutlines.forEach(entry => {
                if (rt.scene) rt.scene.remove(entry.outline);
                entry.outline.geometry.dispose();
            });
            selectionOutlines.clear();
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
            formatDimDistance,
            clashModeActive,
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
}).mount('#app');
