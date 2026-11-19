import * as THREE from 'three';
import { countLogicalObjects, requestRender } from '../core/helpers.js';
import { buildAllGroupingCollections } from '../ifc/groups.js';
import { clearCurrentModel } from '../ifc/loader.js';
import { createEdgeOutline } from './display.js';
import { fitCameraToModel } from './scene.js';
import { ENTITY_DEFAULT_COLORS, REBAR_DIAMETER_COLORS, parseDiameterMm } from '../state/constants.js';
import { clippingPlanes, isCropBoxActive, isSampleModel, rt, stats } from '../state/state.js';

export const getRebarColorByDiameter = (diameterMm) => {
    const dia = Math.round(parseDiameterMm(diameterMm));
    if (!dia) return '#f59e0b';
    if (REBAR_DIAMETER_COLORS[dia]) return REBAR_DIAMETER_COLORS[dia];

    const keys = Object.keys(REBAR_DIAMETER_COLORS).map(Number).sort((a,b)=>a-b);
    const nearest = keys.reduce((best, key) =>
        Math.abs(key - dia) < Math.abs(best - dia) ? key : best, keys[0]);
    return REBAR_DIAMETER_COLORS[nearest];
};

// --- 3. MÔ HÌNH MẪU ĐẦY ĐỦ CỐT THÉP & BÊ TÔNG ---
export const createSampleRebarModel = () => {
    clearCurrentModel();
    isSampleModel.value = true;

    const addDemoMesh = (geo, hexColor, opacity, pos, rot, meta) => {
        geo.computeVertexNormals();
        const isTransparent = opacity < 0.99;
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(hexColor),
            roughness: meta.isRebar ? 0.35 : 0.6,
            metalness: meta.isRebar ? 0.45 : 0.08,
            transparent: isTransparent,
            opacity: opacity,
            side: THREE.DoubleSide,
            depthWrite: !isTransparent,
            clippingPlanes: isCropBoxActive.value ? clippingPlanes : null
        });

        const mesh = new THREE.Mesh(geo, mat);
        if (pos) mesh.position.set(...pos);
        if (rot) mesh.rotation.set(...rot);

        mesh.userData = {
            isDemo: true,
            originalMaterial: mat,
            ...meta
        };
        rt.modelGroup.add(mesh);

        if (!meta.isRebar) {
            createEdgeOutline(mesh, geo);
        }
        return mesh;
    };

    // Cột bê tông (IFCCOLUMN) - Xanh lam
    addDemoMesh(new THREE.BoxGeometry(0.8, 3.8, 0.8), ENTITY_DEFAULT_COLORS['IFCCOLUMN'], 1, [0, 1.9, 0], null, {
        expressID: 101,
        type: 'IFCCOLUMN',
        name: 'Cột C1-800x800',
        objectType: 'COLUMN_CONCRETE_800x800',
        tag: 'C-01',
        description: 'Cột bê tông cốt thép B30',
        globalId: '3K0jH9k3D1mN4P2qXyZa01',
        isRebar: false,
        attributes: { Name: 'Cột C1-800x800', ObjectType: 'COLUMN_CONCRETE_800x800', Tag: 'C-01', Description: 'Cột bê tông B30' },
        psets: [{ name: 'Pset_ColumnCommon', properties: [{ name: 'Reference', value: 'C1' }] }]
    });

    // Thép chủ D25 (IFCREINFORCINGBAR) - Phi 25 gán màu hồng tím
    const barGeo = new THREE.CylinderGeometry(0.0125, 0.0125, 3.6, 12);
    const coords = [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]];
    coords.forEach(([x, z], idx) => {
        addDemoMesh(barGeo, getRebarColorByDiameter(25), 1, [x, 1.9, z], null, {
            expressID: 201 + idx,
            type: 'IFCREINFORCINGBAR',
            name: `Thép chủ D25 #${idx + 1}`,
            objectType: 'REBAR_MAIN_CB400',
            tag: 'POS-01',
            description: 'Thép chủ dọc chịu lực CB400',
            globalId: `2R3bArX9K0mN8p2QvW4${idx}`,
            isRebar: true,
            diameter: 25,
            attributes: { Name: `Thép chủ D25 #${idx + 1}`, ObjectType: 'REBAR_MAIN_CB400', Tag: 'POS-01', NominalDiameter: '25 mm', SteelGrade: 'CB400-V' },
            rebarDetails: { barDiameter: '25 mm (Ø25)', steelGrade: 'CB400-V', barLength: '3600 mm', tagMark: 'POS-01' },
            psets: [{ name: 'Pset_ReinforcingBarCommon', properties: [{ name: 'NominalDiameter', value: '25.0 mm' }, { name: 'SteelGrade', value: 'CB400-V' }] }]
        });
    });

    // Coupler D25
    const couplerGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.12, 12);
    coords.forEach(([x, z], idx) => {
        addDemoMesh(couplerGeo, ENTITY_DEFAULT_COLORS['IFCMECHANICALFASTENER'], 1, [x, 0.8, z], null, {
            expressID: 301 + idx,
            type: 'IFCMECHANICALFASTENER',
            name: `Coupler Ren D25 #${idx + 1}`,
            objectType: 'COUPLER_THREADED',
            tag: 'CPL-01',
            description: 'Ống nối ren cơ học tiêu chuẩn ISO',
            globalId: `4C0upL3r9Jk1m2N3P4Q5${idx}`,
            isRebar: true,
            diameter: 25,
            attributes: { Name: `Coupler Ren D25 #${idx + 1}`, ObjectType: 'COUPLER_THREADED', Tag: 'CPL-01' },
            rebarDetails: { barDiameter: '25 mm (Ø25)', steelGrade: '45C Steel', barLength: '120 mm', tagMark: 'CPL-01' },
            psets: [{ name: 'Pset_MechanicalFastenerTypeCoupler', properties: [{ name: 'CouplerType', value: 'Threaded Coupler' }] }]
        });
    });

    // Thép đai D10 - Phi 10 gán màu xanh ngọc
    const tieY = [0.5, 0.85, 1.2, 1.55, 1.9, 2.25, 2.6, 2.95, 3.3];
    tieY.forEach((y, idx) => {
        const tieGeo = new THREE.RingGeometry(0.33, 0.35, 4);
        tieGeo.rotateX(Math.PI / 2);
        tieGeo.rotateY(Math.PI / 4);

        addDemoMesh(tieGeo, getRebarColorByDiameter(10), 1, [0, y, 0], null, {
            expressID: 401 + idx,
            type: 'IFCREINFORCINGBAR',
            name: `Thép đai D10 a150 #${idx + 1}`,
            objectType: 'REBAR_TIE_CB240',
            tag: 'POS-02',
            description: 'Thép đai vuông móc neo 135°',
            globalId: `5T1eB4r9Jk2m3N4P5Q6${idx}`,
            isRebar: true,
            diameter: 10,
            attributes: { Name: `Thép đai D10 a150 #${idx + 1}`, ObjectType: 'REBAR_TIE_CB240', Tag: 'POS-02', NominalDiameter: '10 mm', SteelGrade: 'CB240-T' },
            rebarDetails: { barDiameter: '10 mm (Ø10)', steelGrade: 'CB240-T', barLength: '2720 mm', tagMark: 'POS-02' },
            psets: [{ name: 'Pset_ReinforcingBarCommon', properties: [{ name: 'NominalDiameter', value: '10.0 mm' }, { name: 'Spacing', value: '150 mm' }] }]
        });
    });

    // Dầm kết cấu (IFCBEAM) - Xanh dương
    addDemoMesh(new THREE.BoxGeometry(4.2, 0.6, 0.4), ENTITY_DEFAULT_COLORS['IFCBEAM'], 1, [2.1, 3.5, 0], null, {
        expressID: 501,
        type: 'IFCBEAM',
        name: 'Dầm D1-400x600',
        objectType: 'BEAM_CONCRETE_400x600',
        tag: 'B-01',
        description: 'Dầm chính tầng 1',
        globalId: '6B34m9Jk3m4N5P6Q7R8S01',
        isRebar: false,
        attributes: { Name: 'Dầm D1-400x600', ObjectType: 'BEAM_CONCRETE_400x600', Tag: 'B-01' },
        psets: [{ name: 'Pset_BeamCommon', properties: [{ name: 'Reference', value: 'D1' }] }]
    });

    // Bản sàn bê tông (IFCSLAB) - Xám ghi
    addDemoMesh(new THREE.BoxGeometry(4.8, 0.25, 3.2), ENTITY_DEFAULT_COLORS['IFCSLAB'], 1, [2.1, 3.65, 1.4], null, {
        expressID: 601,
        type: 'IFCSLAB',
        name: 'Sàn S1 d=250',
        objectType: 'SLAB_FLOOR_250',
        tag: 'S-01',
        description: 'Bản sàn tầng 2',
        globalId: '7S14b9Jk4m5N6P7Q8R9S01',
        isRebar: false,
        attributes: { Name: 'Sàn S1 d=250', ObjectType: 'SLAB_FLOOR_250', Tag: 'S-01' },
        psets: [{ name: 'Pset_SlabCommon', properties: [{ name: 'Thickness', value: '250 mm' }] }]
    });

    stats.meshes = countLogicalObjects();
    stats.rebarCount = rt.modelGroup.children.filter(m => m.isMesh && m.userData.isRebar).length;
    createSampleInfoLabel();
    buildAllGroupingCollections();
    fitCameraToModel();
};

// Bảng thông tin vẽ bằng canvas, đặt nằm phẳng trên mặt sàn mẫu (không thuộc modelGroup nên không bị chọn/xray/wireframe)
const SAMPLE_LABEL_PX_PER_METER = 400;

const drawSampleInfoLabel = (canvas) => {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const pad = 56;
    const font = (size, weight = 400) => `${weight} ${size}px Inter, 'Segoe UI', sans-serif`;
    ctx.clearRect(0, 0, w, h);

    // Nền thẻ bo góc
    const radius = 44;
    ctx.beginPath();
    ctx.roundRect(8, 8, w - 16, h - 16, radius);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.stroke();

    // Biểu tượng tòa nhà đơn giản trong ô vàng
    const iconSize = 150;
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
    ctx.beginPath();
    ctx.roundRect(pad, pad, iconSize, iconSize, 32);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(pad + 38, pad + 34, 74, 88);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) ctx.fillRect(pad + 50 + c * 30, pad + 46 + r * 24, 16, 12);

    const textX = pad + iconSize + 44;
    const textWidth = w - textX - pad;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#0f172a';
    ctx.font = font(66, 700);
    ctx.fillText('Mô hình mẫu Cột & Cốt thép 3D', textX, pad + 6);

    // Đoạn mô tả: các cụm có màu riêng, tự xuống dòng
    const segments = [
        ['View nền sáng rõ, thép phân màu theo ', '#475569'], ['Phi (Ø)', '#f59e0b'],
        ['. Bấm ', '#475569'], ['CropBox', '#0891b2'],
        [' để kéo mũi tên 6 mặt độc lập, hoặc đổi sang ', '#475569'], ['Orthographic', '#4f46e5'], ['!', '#475569']
    ];
    ctx.font = font(48);
    const lineHeight = 70;
    let x = textX;
    let y = pad + 118;
    segments.forEach(([text, color]) => {
        ctx.fillStyle = color;
        text.split(/(\s+)/).filter(Boolean).forEach(token => {
            const tokenWidth = ctx.measureText(token).width;
            if (x + tokenWidth > textX + textWidth && token.trim()) {
                x = textX;
                y += lineHeight;
            }
            if (!(x === textX && !token.trim())) ctx.fillText(token, x, y);
            x += tokenWidth;
        });
    });

    // Hàng hướng dẫn chuột
    const dividerY = h - pad - 110;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.fillRect(pad, dividerY, w - pad * 2, 4);
    const hints = [['Xoay: Trái', '#2563eb'], ['Pan: Giữa', '#2563eb'], ['Dịch: Phải', '#2563eb']];
    const colWidth = (w - pad * 2) / hints.length;
    ctx.font = font(50, 500);
    hints.forEach(([text, color], i) => {
        const cx = pad + i * colWidth;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx + 22, dividerY + 82, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#64748b';
        ctx.fillText(text, cx + 56, dividerY + 56);
    });
};

const createSampleInfoLabel = () => {
    // Vùng phẳng trên sàn S1, né cột C1 và dầm D1 ở mép sau-trái
    const slabTopY = 3.65 + 0.125;
    const width = 3.85;
    const depth = 2.45;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * SAMPLE_LABEL_PX_PER_METER);
    canvas.height = Math.round(depth * SAMPLE_LABEL_PX_PER_METER);
    drawSampleInfoLabel(canvas);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    // Vẽ lại khi font Inter tải xong để chữ không bị lệch
    document.fonts?.ready.then(() => {
        drawSampleInfoLabel(canvas);
        texture.needsUpdate = true;
        requestRender();
    });

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    label.rotation.x = -Math.PI / 2; // nằm phẳng, đầu chữ hướng về phía sau (-Z)
    label.position.set(2.475, slabTopY + 0.003, 1.675);
    label.renderOrder = 5;
    label.raycast = () => {};
    rt.scene.add(label);
    rt.sampleInfoLabel = label;
};
