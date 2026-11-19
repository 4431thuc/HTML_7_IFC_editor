// Bảng màu phân biệt cấu kiện kiến trúc & kết cấu
export const ENTITY_DEFAULT_COLORS = {
    'IFCCOLUMN': '#0284c7',               // Xanh lam cột kết cấu
    'IFCBEAM': '#3b82f6',                 // Xanh dương dầm kết cấu
    'IFCSLAB': '#64748b',                 // Xám ghi bản sàn
    'IFCWALL': '#78716c',                 // Màu đá tự nhiên cho tường vách
    'IFCWALLSTANDARDCASE': '#78716c',
    'IFCFOOTING': '#475569',              // Móng
    'IFCPILE': '#334155',                 // Cọc
    'IFCDOOR': '#10b981',                 // Xanh ngọc cửa đi
    'IFCWINDOW': '#38bdf8',               // Xanh kính trong
    'IFCBUILDINGELEMENTPROXY': '#6366f1', // Tím proxy
    'IFCROOF': '#57534e',                 // Mái che
    'IFCSTAIR': '#0d9488',                // Xanh sẫm cầu thang
    'IFCRAILING': '#f43f5e',              // Đỏ hồng lan can
    'IFCMECHANICALFASTENER': '#ec4899',   // Hồng tím coupler / bu-lông
    'IFCTENDON': '#8b5cf6',               // Tím cáp dự ứng lực
    'IFCTENDONANCHOR': '#a855f7'          // Tím đậm đầu neo
};

// BẢNG MÀU PHÂN BỔ THÉP THEO PHI (ĐƯỜNG KÍNH Ø)
export const REBAR_DIAMETER_COLORS = {
    6:  '#94a3b8',
    8:  '#38bdf8',
    10: '#2dd4bf', // Ø10: Xanh ngọc
    12: '#facc15', // Ø12: Vàng chanh
    14: '#f59e0b', // Ø14: Vàng cam
    16: '#fb923c', // Ø16: Cam sáng
    18: '#ea580c', // Ø18: Cam đỏ
    20: '#ef4444', // Ø20: Đỏ tươi
    22: '#dc2626', // Ø22: Đỏ sẫm
    25: '#ec4899', // Ø25: Hồng tím
    28: '#d946ef', // Ø28: Tím magenta
    32: '#8b5cf6', // Ø32: Tím đậm
    36: '#6366f1',
    40: '#4338ca'
};

export const parseDiameterMm = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 && value < 1 ? value * 1000 : value;
    }
    const text = String(value ?? '').replace(',', '.').trim();
    const match = text.match(/(?:ø|⌀|phi|(?:^|[\s_-])d(?:ia(?:meter)?)?\s*[:=]?\s*)(\d+(?:\.\d+)?)/i)
        || text.match(/^\s*(\d+(?:\.\d+)?)/);
    if (!match) return 0;
    let diameter = Number(match[1]);
    if (!Number.isFinite(diameter) || diameter <= 0) return 0;
    if (/\bcm\b/i.test(text)) diameter *= 10;
    else if (/(?:\bm\b|метр)/i.test(text) && !/\bmm\b/i.test(text)) diameter *= 1000;
    else if (!/\bmm\b/i.test(text) && diameter < 1) diameter *= 1000;
    return diameter;
};

export const REBAR_ENTITY_TYPES = new Set([
    'IFCREINFORCINGBAR',
    'IFCREINFORCINGMESH',
    'IFCMECHANICALFASTENER',
    'IFCTENDON',
    'IFCTENDONANCHOR'
]);

export const PALETTE = [
    '#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6',
    '#06b6d4', '#f97316', '#6366f1', '#14b8a6', '#84cc16',
    '#e11d48', '#0284c7', '#d97706', '#a855f7', '#64748b'
];

// Chỉnh sửa nội dung banner giới thiệu ngay tại đây để cập nhật văn bản cho các lần ra mắt tiếp theo.
export const INTRO_PANEL_CONTENT = {
    badge: 'IFC BIM Editor',
    title: 'Trình xem và chỉnh sửa IFC dành cho kết cấu',
    subtitle: 'Không chỉ xem mô hình: công cụ được xây dựng để kiểm tra, chỉnh sửa và chuẩn bị dữ liệu BIM ngay trong trình duyệt.',
    features: [
        { icon: 'ph-cube-transparent', title: 'View 3D chuyên sâu', text: 'Xoay, soi, lọc và chọn từng cấu kiện với mô hình IFC thực tế.' },
        { icon: 'ph-intersect', title: 'CropBox chính xác', text: 'Kiểm tra lát cắt, điều chỉnh từng mặt và tập trung vào vùng quan tâm.' },
        { icon: 'ph-pencil-simple-line', title: 'Chỉnh sửa Attributes', text: 'Cập nhật Name, ObjectType, Tag, Description và lưu thành IFC mới.' },
        { icon: 'ph-stack', title: 'Combine nhiều file IFC', text: 'Gộp, quản lý và xuất nhiều mô hình trong cùng một view 3D.' },
        { icon: 'ph-intersect-three', title: 'Kiểm tra xung đột (Clash)', text: 'Tìm va chạm giữa các cấu kiện thép, dầm, cột và sàn ngay trong trình duyệt. Bấm một cặp clash để zoom tới vị trí, khối được chọn sẽ được tô nổi bật kèm nhãn chỉ vị trí.', wide: true }
    ],
    advantageTitle: 'Vượt trội hơn viewer thông thường',
    advantageText: 'Có thể đánh dấu cấu kiện, quản lý Remove/Restore, phân nhóm, soi thép X-Ray, transport tọa độ và xuất lại file đã chỉnh sửa.',
    roadmapTitle: 'Định hướng phát triển',
    roadmapText: 'Nền tảng sẵn sàng mở rộng hệ thống đo đạt, thông tin khối lượng và các công cụ QC chuyên biệt.'
};

// --- VIEW CUBE: khối cubic chọn hướng nhìn (6 mặt, 12 cạnh, 8 góc) ---
export const VIEW_CUBE_SIZE_PX = 52;
export const VIEW_CUBE_BOX_PX = 120;

// Hệ trục Three.js: X phải, Y lên (Top), Z hướng ra trước (Front).
// right/down là hướng "phải"/"xuống" của chính mặt đó khi nhìn từ ngoài vào.
const VIEW_CUBE_FACE_DEFS = [
    { id: 'front', label: 'Front', normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0], rotate: '' },
    { id: 'back', label: 'Back', normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0], rotate: 'rotateY(180deg) ' },
    { id: 'right', label: 'Right', normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0], rotate: 'rotateY(90deg) ' },
    { id: 'left', label: 'Left', normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0], rotate: 'rotateY(-90deg) ' },
    { id: 'top', label: 'Top', normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1], rotate: 'rotateX(90deg) ' },
    { id: 'bottom', label: 'Bottom', normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1], rotate: 'rotateX(-90deg) ' }
];

const describeViewDirection = (dir) => {
    const names = [];
    if (dir[1]) names.push(dir[1] > 0 ? 'Top' : 'Bottom');
    if (dir[2]) names.push(dir[2] > 0 ? 'Front' : 'Back');
    if (dir[0]) names.push(dir[0] > 0 ? 'Right' : 'Left');
    return names.join('-');
};

export const VIEW_CUBE_FACES = VIEW_CUBE_FACE_DEFS.map(def => {
    const cells = [];
    for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
            const dir = def.normal.map((value, i) => value + col * def.right[i] + row * def.down[i]);
            const nonZero = (col !== 0 ? 1 : 0) + (row !== 0 ? 1 : 0);
            cells.push({
                id: `${def.id}-${col}-${row}`,
                key: dir.join(','),
                dir,
                kind: nonZero === 0 ? 'vc-face-cell' : (nonZero === 1 ? 'vc-edge' : 'vc-corner'),
                title: `Nhìn từ ${describeViewDirection(dir)}`
            });
        }
    }
    return {
        id: def.id,
        label: def.label,
        transform: `${def.rotate}translateZ(${VIEW_CUBE_SIZE_PX / 2}px)`,
        cells
    };
});
