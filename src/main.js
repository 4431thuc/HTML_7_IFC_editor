import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { createApp, nextTick, onBeforeUnmount, onMounted } from 'vue';
import { clearClashResults, onClashButtonClick, runClashCheck, toggleClashPairObjects, zoomToClash } from './clash/clash.js';
import { visibleExportItems } from './core/helpers.js';
import { exportCombineIFC, exportModifiedIFC, exportVisibleIFC } from './ifc/export.js';
import { clashTypeOptions, filteredGroups, queueSelectedForRemoval, restoreRemovedItem, setAllActiveGroupsVisibility, toggleSelectedVisibility, toggleSingleGroupVisibility } from './ifc/groups.js';
import { handleAddIfcFiles, handleFileUpload, handleIfcDragEnter, handleIfcDragLeave, handleIfcDragOver, handleIfcDrop, removeSourceFile, toggleSourceVisibility } from './ifc/loader.js';
import { applyTransport, deleteTransportProfile, exportTransportProfiles, importTransportProfiles, loadTransportProfiles, openTransportProfileDialog, saveTransportProfile, undoTransport, useTransportProfile } from './ifc/transport.js';
import { cropToSelectedObjects, resetCropBoxToModel, toggleCropBox, toggleOutsideCropEdges } from './scene/cropbox.js';
import { applyXRayMaterialEffect, recalculateAllNormals, toggleEdges, toggleFilterFaultyBars, toggleFlatShading, toggleGrid, toggleRebarOnly, toggleWireframe, toggleXRayMode } from './scene/display.js';
import { fitCameraToModel, fitCameraToTarget, initThreeJS, initWebIFC, onWindowResize, setBackgroundTheme, setLightAngle, setViewDirection, toggleCameraProjection, updateLighting } from './scene/scene.js';
import { handleKeyDown, handleKeyUp, onPointerLeave } from './selection/input.js';
import { clearSelection, isMeshManuallyHidden, isMeshSelected, onGroupMouseEnter, onGroupMouseLeave, onItemClick, onItemDblClick, onItemMouseEnter, onItemMouseLeave, selectGroupMeshes, zoomToGroup } from './selection/selection.js';
import { allGroups, axisGizmoXLabel, axisGizmoXLine, axisGizmoXPoint, axisGizmoYLabel, axisGizmoYLine, axisGizmoYPoint, axisGizmoZLabel, axisGizmoZLine, axisGizmoZPoint, canvasContainer, clashBusy, clashCount, clashError, clashItems, clashModeActive, clashProgress, clashToleranceMm, clashTypeA, clashTypeB, clashVolume, contextMenu, deletedItems, deletedObjectCount, dontShowIntroAgain, editHistoryCount, editableAttributes, faultyCount, fileName, filterFaultyBars, groupCriterion, groupListContainer, groupSearchQuery, hasAttributeChanges, hasLoadedIfc, hasUnsavedChanges, hiddenObjectCount, hoveredType, introPanelContent, introPanelStorageKey, isBoxSelecting, isCropBoxActive, isEditingAttributes, isFlatShading, isIfcDragOver, isLightBackground, isLoading, isOrthographic, isRebarOnly, isSampleModel, isWireframe, isXRayMode, leftActiveTab, leftPanelWidth, lightExposure, lightPreset, loadingText, modelOpacityPercent, openFileCount, rightPanelWidth, rt, selectedClashId, selectedMeshes, selectedObject, selectionOutlineMaterial, selectionOutlines, showClashPairObjects, showEdges, showGrid, showIntroPanel, showLeftPanel, showOutsideCropEdges, showRightPanel, showTransportProfileModal, sourceFiles, stats, toastMessage, toastTitle, toastType, transportHistory, transportInnerTab, transportInputs, transportProfileName, transportProfileNameInput, transportProfiles, wasmReady, xrayOpacity } from './state/state.js';
import { closeContextMenu, contextMenuAction, openContextMenu } from './ui/context-menu.js';
import { adjustPanelWidth, boxSelectionStyle, closeIntroPanel, endPanelResize, persistModelOpacity, playUiPop, startPanelResize, togglePropertiesPanel, updateModelOpacity, updatePanelResize } from './ui/panels.js';
import { resetEditableAttributes, saveAttributeChanges } from './ui/properties.js';

// Kích hoạt raycast/bounds tree tăng tốc bằng three-mesh-bvh
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

createApp({
    setup() {
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
            await initWebIFC();
        });

        onBeforeUnmount(() => {
            cancelAnimationFrame(rt.animationFrameId);
            if (rt.canvasResizeObserver) rt.canvasResizeObserver.disconnect();
            window.removeEventListener('resize', onWindowResize);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
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
            groupListContainer,
            wasmReady,
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
            openContextMenu,
            closeContextMenu,
            contextMenuAction,
            saveAttributeChanges,
            resetEditableAttributes,
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
