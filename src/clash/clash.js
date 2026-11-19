import * as THREE from 'three';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import { markRaw } from 'vue';
import { getMeshKey, requestRender } from '../core/helpers.js';
import { refreshBatchMaterials } from '../scene/rendering.js';
import { batchGroup, clashAnnotationGroup, clashBlueMaterial, clashBusy, clashContextGroup, clashContextMaterial, clashCount, clashError, clashGroup, clashItems, clashModeActive, clashOutlineMaterial, clashPairGroup, clashPairMaterialA, clashPairMaterialB, clashProgress, clashRedMaterial, clashSelectionGroup, clashToleranceMm, clashTypeA, clashTypeB, clashVolume, clashYellowMaterial, edgesGroup, isOrthographic, overlayGroup, pendingDeletedExpressIDs, rt, selectedClashId, selectionOutlineMaterial, showClashPairObjects, showEdges } from '../state/state.js';
import { applyModelOpacityToScene, showToast } from '../ui/panels.js';

export const clearClashPairObjects = () => {
    while (clashPairGroup.children.length) {
        clashPairGroup.remove(clashPairGroup.children[0]);
    }
};
export const refreshClashPairObjects = () => {
    clearClashPairObjects();
    const item = clashItems.value.find(entry => entry.id === selectedClashId.value);
    if (showClashPairObjects.value && item) {
        [[item.sourceA, clashPairMaterialA], [item.sourceB, clashPairMaterialB]].forEach(([source, material]) => {
            if (!source?.geometry) return;
            // Dùng chung geometry gốc của cấu kiện (không dispose), chỉ đặt lại ma trận world.
            const pairMesh = new THREE.Mesh(source.geometry, material);
            pairMesh.matrixAutoUpdate = false;
            pairMesh.matrix.copy(source.matrixWorld);
            pairMesh.matrixWorld.copy(source.matrixWorld);
            pairMesh.frustumCulled = false;
            pairMesh.renderOrder = 50;
            clashPairGroup.add(pairMesh);
        });
    }
    requestRender();
};
export const toggleClashPairObjects = () => {
    showClashPairObjects.value = !showClashPairObjects.value;
    refreshClashPairObjects();
};
export const clearClashSelectionVisuals = () => {
    clearClashPairObjects();
    if (rt.clashFlashInterval) clearInterval(rt.clashFlashInterval);
    if (rt.clashFlashTimeout) clearTimeout(rt.clashFlashTimeout);
    rt.clashFlashInterval = null;
    rt.clashFlashTimeout = null;
    if (rt.selectedClashMesh && rt.selectedClashMesh.parent) {
        rt.selectedClashMesh.material = clashBlueMaterial;
    }
    rt.selectedClashMesh = null;
    selectedClashId.value = null;
    while (clashSelectionGroup.children.length) {
        const child = clashSelectionGroup.children[0];
        child.geometry?.dispose();
        clashSelectionGroup.remove(child);
    }
    while (clashAnnotationGroup.children.length) {
        const child = clashAnnotationGroup.children[0];
        child.traverse(node => {
            node.geometry?.dispose();
            if (node.material) {
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                materials.forEach(material => {
                    material.map?.dispose();
                    material.dispose();
                });
            }
        });
        clashAnnotationGroup.remove(child);
    }
};
export const addClashLocationLabel = (item, itemIndex) => {
    if (!item?.bounds?.min || !item?.bounds?.max) return;
    const box = new THREE.Box3(
        new THREE.Vector3(...item.bounds.min),
        new THREE.Vector3(...item.bounds.max)
    );
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.025);
    const anchor = new THREE.Vector3(center.x, box.max.y, center.z);

    const leaderGeometry = new THREE.BufferGeometry();
    const leader = new THREE.Line(leaderGeometry, new THREE.LineBasicMaterial({
        color: 0xffd21f, transparent: false, depthTest: false, depthWrite: false, toneMapped: false
    }));
    leader.renderOrder = 2000;
    leader.frustumCulled = false;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 8;
    const radiusPx = 22;
    ctx.beginPath();
    ctx.moveTo(radiusPx, 4);
    ctx.lineTo(canvas.width - radiusPx, 4);
    ctx.quadraticCurveTo(canvas.width - 4, 4, canvas.width - 4, radiusPx);
    ctx.lineTo(canvas.width - 4, canvas.height - radiusPx);
    ctx.quadraticCurveTo(canvas.width - 4, canvas.height - 4, canvas.width - radiusPx, canvas.height - 4);
    ctx.lineTo(radiusPx, canvas.height - 4);
    ctx.quadraticCurveTo(4, canvas.height - 4, 4, canvas.height - radiusPx);
    ctx.lineTo(4, radiusPx);
    ctx.quadraticCurveTo(4, 4, radiusPx, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 54px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde68a';
    ctx.fillText(`CLASH #${itemIndex + 1}`, canvas.width / 2, canvas.height / 2 + 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false
    }));
    // Kích thước nền bám theo vùng clash, không dùng một kích thước cố định cho mọi mô hình.
    const baseLabelWidth = THREE.MathUtils.clamp(radius * 2.25, 0.16, 1.15);
    sprite.scale.set(baseLabelWidth, baseLabelWidth * 0.25, 1);
    sprite.renderOrder = 2001;
    sprite.frustumCulled = false;

    const annotation = new THREE.Group();
    annotation.add(leader, sprite);
    annotation.userData.clashLabel = {
        anchor: anchor.clone(),
        radius,
        baseLabelWidth,
        baseOffset: Math.max(radius * 1.55, 0.14),
        leader,
        sprite
    };
    annotation.renderOrder = 2000;
    annotation.frustumCulled = false;
    clashAnnotationGroup.add(annotation);
    updateClashAnnotationCamera();
};

// Giữ nhãn luôn hướng theo camera; khi zoom gần, nhãn và độ lệch khỏi điểm clash tự thu nhỏ.
export const updateClashAnnotationCamera = () => {
    if (!rt.camera || !clashAnnotationGroup.visible) return;
    rt.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(rt.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(rt.camera.matrixWorld, 1).normalize();
    clashAnnotationGroup.children.forEach(annotation => {
        const data = annotation.userData.clashLabel;
        if (!data) return;
        let zoomScale = 1;
        if (isOrthographic.value) {
            zoomScale = THREE.MathUtils.clamp(1 / Math.sqrt(Math.max(rt.orthoCamera.zoom, 0.01)), 0.38, 1.35);
        } else {
            const distance = Math.max(rt.camera.position.distanceTo(data.anchor), 0.001);
            const referenceDistance = Math.max(data.radius * 12, 0.25);
            zoomScale = THREE.MathUtils.clamp(Math.sqrt(distance / referenceDistance), 0.38, 1.35);
        }
        const width = data.baseLabelWidth * zoomScale;
        data.sprite.scale.set(width, width * 0.25, 1);
        const offset = data.baseOffset * zoomScale;
        const labelPosition = data.anchor.clone()
            .addScaledVector(right, offset)
            .addScaledVector(up, offset * 0.72);
        data.sprite.position.copy(labelPosition);
        data.leader.geometry.setFromPoints([data.anchor, labelPosition]);
        data.leader.geometry.computeBoundingSphere();
    });
};
export const selectClashItem = (item) => {
    clearClashSelectionVisuals();
    if (!item?.mesh || !item.mesh.isMesh) return;
    selectedClashId.value = item.id;
    rt.selectedClashMesh = item.mesh;
    rt.selectedClashMesh.material = clashYellowMaterial;

    // Viền nét đứt cùng phong cách viền đối tượng đang được select trong mô hình.
    rt.selectedClashMesh.updateWorldMatrix(true, false);
    const outlineGeometry = new THREE.EdgesGeometry(rt.selectedClashMesh.geometry, 15);
    outlineGeometry.applyMatrix4(rt.selectedClashMesh.matrixWorld);
    const outline = new THREE.LineSegments(outlineGeometry, selectionOutlineMaterial);
    outline.computeLineDistances();
    outline.renderOrder = 2002;
    outline.frustumCulled = false;
    clashSelectionGroup.add(outline);
    addClashLocationLabel(item, Math.max(0, clashItems.value.findIndex(entry => entry.id === item.id)));

    // Nhấp nháy đỏ/vàng trong 0,5 giây, sau đó giữ màu vàng.
    let showRed = true;
    rt.selectedClashMesh.material = clashRedMaterial;
    rt.clashFlashInterval = setInterval(() => {
        if (!rt.selectedClashMesh || rt.selectedClashMesh !== item.mesh) return;
        showRed = !showRed;
        rt.selectedClashMesh.material = showRed ? clashRedMaterial : clashYellowMaterial;
        requestRender();
    }, 65);
    rt.clashFlashTimeout = setTimeout(() => {
        if (rt.clashFlashInterval) clearInterval(rt.clashFlashInterval);
        rt.clashFlashInterval = null;
        rt.clashFlashTimeout = null;
        if (rt.selectedClashMesh === item.mesh) rt.selectedClashMesh.material = clashYellowMaterial;
        requestRender();
        }, 500);
    requestRender();
    refreshClashPairObjects();
};
export const applyClashDisplayMode = () => {
    const active = clashModeActive.value;
    if (batchGroup) batchGroup.visible = !active;
    if (overlayGroup) overlayGroup.visible = !active;
    if (edgesGroup) edgesGroup.visible = showEdges.value && !active;
    clashContextGroup.visible = active;
    clashGroup.visible = active;
    clashSelectionGroup.visible = active;
    clashAnnotationGroup.visible = active;
    requestRender();
};
export const clearClashGeometry = () => {
    clearClashSelectionVisuals();
    while (clashGroup.children.length) {
        const child = clashGroup.children[0];
        child.traverse(node => {
            if (node.geometry) node.geometry.dispose();
        });
        clashGroup.remove(child);
    }
    while (clashContextGroup.children.length) {
        const child = clashContextGroup.children[0];
        child.geometry?.dispose();
        clashContextGroup.remove(child);
    }
};
export const clearClashResults = () => {
    clearClashGeometry();
    clashModeActive.value = false;
    clashCount.value = 0;
    clashVolume.value = 0;
    clashItems.value = [];
    clashError.value = '';
    refreshBatchMaterials();
    applyModelOpacityToScene();
    applyClashDisplayMode();
    requestRender();
};
export const zoomToClash = (item) => {
    if (!item?.bounds?.min || !item?.bounds?.max || !rt.camera || !rt.controls || !rt.renderer) return;
    selectClashItem(item);
    const box = new THREE.Box3(
        new THREE.Vector3(...item.bounds.min),
        new THREE.Vector3(...item.bounds.max)
    );
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.025);
    const direction = rt.camera.position.clone().sub(rt.controls.target).normalize();
    if (direction.lengthSq() < 0.001) direction.set(1, 0.7, 1).normalize();
    const aspect = Math.max(rt.renderer.domElement.clientWidth / Math.max(rt.renderer.domElement.clientHeight, 1), 0.1);
    if (isOrthographic.value) {
        const halfHeight = Math.max(size.y, size.x / aspect, size.z, 0.05) * 0.75;
        rt.orthoCamera.left = -halfHeight * aspect;
        rt.orthoCamera.right = halfHeight * aspect;
        rt.orthoCamera.top = halfHeight;
        rt.orthoCamera.bottom = -halfHeight;
        rt.orthoCamera.near = 0.001;
        rt.orthoCamera.far = Math.max(radius * 30, 100);
        rt.orthoCamera.zoom = 1;
        rt.orthoCamera.updateProjectionMatrix();
        rt.camera.position.copy(center).addScaledVector(direction, Math.max(radius * 3, 1));
    } else {
        const fov = THREE.MathUtils.degToRad(rt.camera.fov);
        const distance = Math.max(radius / Math.sin(fov / 2) * 1.35, 0.75);
        rt.camera.position.copy(center).addScaledVector(direction, distance);
        rt.camera.near = Math.max(radius / 1000, 0.001);
        rt.camera.far = Math.max(distance + radius * 20, 100);
        rt.camera.updateProjectionMatrix();
    }
    rt.controls.target.copy(center);
    rt.controls.update();
    requestRender();
};
export const runClashCheck = async () => {
    if (clashBusy.value) return;
    const candidates = rt.modelGroup.children.filter(mesh =>
        mesh.isMesh && mesh.visible && mesh.geometry?.attributes?.position &&
        !pendingDeletedExpressIDs.has(getMeshKey(mesh))
    );
    if (candidates.length < 2) {
        showToast('Chưa đủ cấu kiện', 'Cần ít nhất hai cấu kiện đang hiển thị để kiểm tra clash.');
        return;
    }
    const toleranceMm = Number(clashToleranceMm.value);
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0 || toleranceMm > 1000) {
        clashError.value = 'Dung sai phải nằm trong khoảng từ 0 đến 1000 mm.';
        return;
    }
    const toleranceMeters = toleranceMm / 1000;
    const halfTolerance = toleranceMeters / 2;
    clashBusy.value = true;
    clashError.value = '';
    try {
        clearClashGeometry();
        clashItems.value = [];
        clashCount.value = 0;
        clashVolume.value = 0;
        clashModeActive.value = false;
        applyClashDisplayMode();
        rt.modelGroup.updateWorldMatrix(true, true);
        const typeA = clashTypeA.value;
        const typeB = clashTypeB.value;
        const pairMatchesTypes = (meshA, meshB) => {
            const aType = meshA.userData.type || 'IFCELEMENT';
            const bType = meshB.userData.type || 'IFCELEMENT';
            if (typeA === '*' && typeB === '*') return true;
            if (typeA === '*') return aType === typeB || bType === typeB;
            if (typeB === '*') return aType === typeA || bType === typeA;
            return (aType === typeA && bType === typeB) || (aType === typeB && bType === typeA);
        };
        const entries = candidates.map(mesh => {
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
            if (halfTolerance > 0) box.expandByScalar(halfTolerance);
            return { mesh, box };
        });
        const evaluator = new Evaluator();
        evaluator.useGroups = false;
        evaluator.attributes = ['position', 'normal'];
        const brushCache = new Map();
        const makeBrush = (mesh) => {
            let brush = brushCache.get(mesh);
            if (brush) return brush;
            const geometry = mesh.geometry.clone();
            if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
            if (halfTolerance > 0) {
                // Nới từng bề mặt ra 1/2 dung sai để bắt cả khe hở nhỏ trong giới hạn cho phép.
                const positions = geometry.getAttribute('position');
                const normals = geometry.getAttribute('normal');
                const normal = new THREE.Vector3();
                for (let vertex = 0; vertex < positions.count; vertex++) {
                    normal.fromBufferAttribute(normals, vertex);
                    if (normal.lengthSq() > 1e-12) normal.normalize();
                    positions.setXYZ(
                        vertex,
                        positions.getX(vertex) + normal.x * halfTolerance,
                        positions.getY(vertex) + normal.y * halfTolerance,
                        positions.getZ(vertex) + normal.z * halfTolerance
                    );
                }
                positions.needsUpdate = true;
                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
            }
            if (!geometry.boundsTree && geometry.computeBoundsTree) geometry.computeBoundsTree();
            brush = new Brush(geometry, clashBlueMaterial);
            brush.matrixAutoUpdate = false;
            brush.matrix.copy(mesh.matrixWorld);
            brush.updateMatrixWorld(true);
            brushCache.set(mesh, brush);
            return brush;
        };
        const found = [];
        let checked = 0;
        let totalPairs = 0;
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const a = entries[i], b = entries[j];
                if (getMeshKey(a.mesh) !== getMeshKey(b.mesh) && pairMatchesTypes(a.mesh, b.mesh) && a.box.intersectsBox(b.box)) totalPairs++;
            }
        }
        for (let i = 0; i < entries.length; i++) {
            if (rt.clashCancelRequested) break;
            const a = entries[i];
            for (let j = i + 1; j < entries.length; j++) {
                const b = entries[j];
                if (rt.clashCancelRequested) break;
                if (getMeshKey(a.mesh) === getMeshKey(b.mesh) || !pairMatchesTypes(a.mesh, b.mesh) || !a.box.intersectsBox(b.box)) continue;
                checked++;
                clashProgress.value = checked / Math.max(totalPairs, 1);
                if (checked % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));

                try {
                    const result = evaluator.evaluate(makeBrush(a.mesh), makeBrush(b.mesh), INTERSECTION);
                    const geometry = result.geometry;
                    if (!geometry?.attributes?.position || geometry.attributes.position.count < 4) {
                        geometry?.dispose();
                        continue;
                    }
                    result.updateMatrixWorld(true);
                    const position = geometry.attributes.position;
                    const index = geometry.index;
                    let signedVolume = 0;
                    const triangleCount = index ? index.count / 3 : position.count / 3;
                    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
                    for (let triangle = 0; triangle < triangleCount; triangle++) {
                        const ia = index ? index.getX(triangle * 3) : triangle * 3;
                        const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
                        const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
                        va.fromBufferAttribute(position, ia);
                        vb.fromBufferAttribute(position, ib);
                        vc.fromBufferAttribute(position, ic);
                        signedVolume += va.dot(vb.clone().cross(vc)) / 6;
                    }
                    const transformScale = Math.abs(result.matrixWorld.determinant());
                    const intersectionVolume = Math.abs(signedVolume) * transformScale;
                    if (!Number.isFinite(intersectionVolume) || intersectionVolume < 1e-10) {
                        geometry.dispose();
                        continue;
                    }
                    const clashMesh = new THREE.Mesh(geometry, clashBlueMaterial);
                    clashMesh.matrixAutoUpdate = false;
                    clashMesh.matrix.copy(result.matrixWorld);
                    clashMesh.matrixWorld.copy(result.matrixWorld);
                    clashMesh.frustumCulled = false;
                    clashMesh.renderOrder = 100;
                    const outlineGeometry = new THREE.EdgesGeometry(geometry, 18);
                    const outline = new THREE.LineSegments(outlineGeometry, clashOutlineMaterial);
                    outline.renderOrder = 101;
                    outline.frustumCulled = false;
                    clashMesh.add(outline);
                    clashGroup.add(clashMesh);
                    clashMesh.updateMatrixWorld(true);
                    const intersectionBounds = new THREE.Box3().setFromObject(clashMesh);
                    found.push({
                        id: `${getMeshKey(a.mesh)}|${getMeshKey(b.mesh)}|${i}|${j}`,
                        nameA: a.mesh.userData.name || `#${a.mesh.userData.expressID}`,
                        nameB: b.mesh.userData.name || `#${b.mesh.userData.expressID}`,
                        typeA: a.mesh.userData.type || 'IFCELEMENT',
                        typeB: b.mesh.userData.type || 'IFCELEMENT',
                        volume: intersectionVolume,
                        mesh: markRaw(clashMesh),
                        sourceA: markRaw(a.mesh),
                        sourceB: markRaw(b.mesh),
                        bounds: {
                            min: intersectionBounds.min.toArray(),
                            max: intersectionBounds.max.toArray()
                        }
                    });
                } catch (pairError) {
                    console.warn('Không thể tính giao thể tích cho một cặp cấu kiện:', pairError);
                }
            }
        }
        brushCache.forEach(brush => brush.geometry.dispose());
        if (rt.clashCancelRequested) {
            clearClashGeometry();
            clashModeActive.value = false;
            refreshBatchMaterials();
            applyModelOpacityToScene();
            applyClashDisplayMode();
            requestRender();
            showToast('Đã hủy kiểm tra', 'Tiến trình kiểm tra clash đã được hủy.');
            return;
        }

        // Chỉ hiện đường bao xám ngoài bề mặt; không vẽ mesh đặc của mô hình nền.
        candidates.forEach(mesh => {
            try {
                const outlineGeometry = new THREE.EdgesGeometry(mesh.geometry, 18);
                outlineGeometry.applyMatrix4(mesh.matrixWorld);
                const outline = new THREE.LineSegments(outlineGeometry, clashContextMaterial);
                outline.frustumCulled = false;
                outline.renderOrder = 1;
                clashContextGroup.add(outline);
            } catch (edgeError) {
                console.warn('Không tạo được đường bao cấu kiện:', edgeError);
            }
        });

        // Xếp cặp có thể tích giao lớn nhất lên đầu danh sách.
        found.sort((a, b) => b.volume - a.volume);
        clashItems.value = found;
        clashCount.value = found.length;
        // Tổng thể tích giao theo từng cặp cấu kiện (có thể đếm trùng nếu nhiều cấu kiện cùng giao một vùng).
        clashVolume.value = found.reduce((sum, item) => sum + item.volume, 0);
        clashModeActive.value = true;
        refreshBatchMaterials();
        applyModelOpacityToScene();
        applyClashDisplayMode();
        requestRender();
        showToast('Hoàn tất kiểm tra Clash', `Phát hiện ${found.length} cặp có vùng giao nhau.`, 'success');
    } catch (error) {
        console.error('Clash check failed:', error);
        clashError.value = error?.message || 'Không thể hoàn tất kiểm tra clash.';
        clearClashGeometry();
        clashModeActive.value = false;
        refreshBatchMaterials();
        applyModelOpacityToScene();
        applyClashDisplayMode();
        showToast('Lỗi kiểm tra Clash', clashError.value);
    } finally {
        clashBusy.value = false;
        clashProgress.value = 0;
        rt.clashCancelRequested = false;
    }
};
export const onClashButtonClick = () => {
    if (clashBusy.value) {
        rt.clashCancelRequested = true;
        return;
    }
    runClashCheck();
};
