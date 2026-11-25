import { computed, reactive, ref, shallowRef } from 'vue';
import * as THREE from 'three';
import { EDGE_ANGLE_MAX_DEG, EDGE_ANGLE_MIN_DEG, INTRO_PANEL_CONTENT, MODEL_EDGE_ANGLE_DEG } from './constants.js';

export const canvasContainer = ref(null);
export const introPanelContent = INTRO_PANEL_CONTENT;
export const introPanelStorageKey = 'ifc-editor-intro-dismissed';
export const showIntroPanel = ref(false);
export const dontShowIntroAgain = ref(false);
export const axisGizmoXLine = ref(null);
export const axisGizmoYLine = ref(null);
export const axisGizmoZLine = ref(null);
export const axisGizmoXLabel = ref(null);
export const axisGizmoYLabel = ref(null);
export const axisGizmoZLabel = ref(null);
export const axisGizmoXPoint = ref(null);
export const axisGizmoYPoint = ref(null);
export const axisGizmoZPoint = ref(null);
export const axisGizmoRight = new THREE.Vector3();
export const axisGizmoUp = new THREE.Vector3();
export const axisGizmoBackward = new THREE.Vector3();
export const axisGizmoAxes = [
    { direction: new THREE.Vector3(1, 0, 0), line: axisGizmoXLine, label: axisGizmoXLabel, point: axisGizmoXPoint },
    { direction: new THREE.Vector3(0, 0, -1), line: axisGizmoYLine, label: axisGizmoYLabel, point: axisGizmoYPoint },
    { direction: new THREE.Vector3(0, 1, 0), line: axisGizmoZLine, label: axisGizmoZLabel, point: axisGizmoZPoint }
];
export const viewCubeEl = ref(null);
export const hoverViewDir = ref('');
export const groupListContainer = ref(null);
export const wasmReady = ref(false);
export const isLoading = ref(false);
export const loadingText = ref('');
export const toastMessage = ref('');
export const toastTitle = ref('');
export const toastType = ref('error');
export const fileName = ref('');
export const hasLoadedIfc = ref(false);
export const sourceFiles = ref([]);
export const isIfcDragOver = ref(false);
export const modelOpacityStorageKey = 'ifc-editor-model-opacity';
export const readStoredModelOpacity = () => {
    try {
        const stored = localStorage.getItem(modelOpacityStorageKey);
        if (stored === null) return 100;
        const value = Number(stored);
        return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 100;
    } catch (error) {
        console.error('Không thể đọc cài đặt độ mờ mô hình:', error);
        return 100;
    }
};
export const modelOpacityPercent = ref(readStoredModelOpacity());
export const transportInputs = reactive({
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    angleDegrees: 0,
    vectorX: 0,
    vectorY: 0,
    vectorZ: 0
});
export const transportInnerTab = ref('profiles');
export const transportProfiles = ref([]);
export const transportHistory = ref([]);
export const showTransportProfileModal = ref(false);
// Hộp thoại hỏi khi thêm file IFC trùng tên file đang có: { name, resolve } hoặc null
export const duplicateFilePrompt = ref(null);
export const transportProfileName = ref('');
export const transportProfileNameInput = ref(null);

// Thông tin cấp dự án của từng file IFC (xem ifc/project-info.js)
export const projectInfos = reactive({});
export const projectInfoSourceId = ref(null);
export const projectHeaderOverrides = reactive({});
export const currentProjectInfo = computed(() => projectInfos[projectInfoSourceId.value] ?? null);
export const projectInfoDirty = computed(() => {
    const info = currentProjectInfo.value;
    return !!info && info.sections.some(section => section.fields.some(field => field.value !== field.original));
});

// Tab Panels
export const showLeftPanel = ref(true);
export const showRightPanel = ref(false);
export const leftActiveTab = ref('groups');
// clashModeActive: đang XEM view va chạm; clashResultsReady: đã có kết quả (vẫn giữ khi tắt view)
export const clashModeActive = ref(false);
export const clashResultsReady = ref(false);
export const clashCancelPrompt = ref(false);
export const clashBusy = ref(false);
export const clashProgress = ref(0);
export const clashCount = ref(0);
export const clashVolume = ref(0);
export const clashError = ref('');
export const clashItems = ref([]);
// Kết quả phụ của lần kiểm tra: số cặp thép trùng lặp (xếp đầu danh sách), số cặp liên kết ↔ thép chủ đã bỏ qua,
// số cấu kiện liên kết thép (coupler, đầu ren...) nhận diện được (src/ifc/rebar-connections.js)
export const clashDuplicateCount = ref(0);
export const clashSkippedConnectionPairs = ref(0);
export const clashConnectorCount = ref(0);
export const selectedClashId = ref(null);
// --- ĐO ĐẠC (DIMENSION): mỗi nhóm gồm 2 điểm world (mét) và khoảng cách giữa chúng ---
export const dimModeActive = ref(false);
export const dimItems = ref([]);
export const selectedDimId = ref(null);
export const dimGroup = new THREE.Group();
dimGroup.name = 'Dimensions';
export const clashTypeA = ref('*');
export const clashTypeB = ref('*');
export const clashToleranceMm = ref(0);
// Trạng thái hiển thị ở thanh trạng thái: chữ (khóa tiếng Việt) và màu nút tròn, đổi theo chế độ đang bật
export const statusIndicator = computed(() => {
    if (!wasmReady.value) return { label: 'Đang nạp WASM...', dotClass: 'bg-amber-500 animate-pulse' };
    if (dimModeActive.value) return { label: 'Chế độ đo đạc', dotClass: 'bg-red-500 animate-pulse' };
    if (clashBusy.value) return { label: 'Đang kiểm tra va chạm', dotClass: 'bg-blue-500 animate-pulse' };
    if (clashModeActive.value) return { label: 'Chế độ kết quả va chạm', dotClass: 'bg-blue-500' };
    return { label: 'Sẵn sàng', dotClass: 'bg-emerald-500' };
});
export const leftPanelWidth = ref(320);
export const rightPanelWidth = ref(384);
export const groupCriterion = ref('name');
export const groupSearchQuery = ref('');

// Display Options
export const isRebarOnly = ref(false);
export const isXRayMode = ref(false);
export const filterFaultyBars = ref(false);
export const isWireframe = ref(false);
export const isFlatShading = ref(false);
export const showGrid = ref(true);
export const showEdges = ref(true);
export const lightExposure = ref(1.25);
export const lightPreset = ref('morning');
export const xrayOpacity = ref(0.18);

// CHUYỂN ĐỔI CAMERA: PERSPECTIVE <-> ORTHOGRAPHIC
export const isOrthographic = ref(false);

// MÀU NỀN VIEW 3D: SÁNG (LIGHT) / TỐI (DARK)
export const backgroundThemeStorageKey = 'ifc-editor-background-light';
export const readStoredBackgroundLight = () => {
    try {
        const stored = localStorage.getItem(backgroundThemeStorageKey);
        return stored === null ? true : stored === 'true';
    } catch (error) {
        console.error('Không thể đọc cài đặt màu nền:', error);
        return true;
    }
};
export const isLightBackground = ref(readStoredBackgroundLight());

// NGƯỠNG GÓC NẾP GẤP: viền hiển thị (src/scene/display.js) và cạnh bắt điểm khi đo (src/dimension/dimension.js)
export const modelEdgeAngleStorageKey = 'ifc-editor-edge-angle';
export const snapEdgeAngleStorageKey = 'ifc-editor-snap-edge-angle';
const readStoredAngle = (key) => {
    try {
        const value = Number(localStorage.getItem(key));
        if (value >= EDGE_ANGLE_MIN_DEG && value <= EDGE_ANGLE_MAX_DEG) return value;
    } catch (error) {
        console.error('Không thể đọc cài đặt góc nếp gấp:', error);
    }
    return MODEL_EDGE_ANGLE_DEG;
};
export const modelEdgeAngleDeg = ref(readStoredAngle(modelEdgeAngleStorageKey));
export const snapEdgeAngleDeg = ref(readStoredAngle(snapEdgeAngleStorageKey));
// Mặc định nền sáng kỹ thuật sạch sẽ

// CROPBOX (SECTION BOX 6 MẶT MŨI TÊN ĐỘC LẬP)
export const isCropBoxActive = ref(false);
export const showOutsideCropEdges = ref(false);
export const isSampleModel = ref(true);
export const deletedItems = ref([]);
export const pendingDeletedExpressIDs = reactive(new Set());
export const manuallyHiddenExpressIDs = reactive(new Set());
export const hiddenObjectCount = computed(() => manuallyHiddenExpressIDs.size);
export const deletedObjectCount = computed(() => pendingDeletedExpressIDs.size);
export const openFileCount = computed(() => sourceFiles.value.length);
export const exportListVersion = ref(0);
// Tăng khi model đổi vị trí (nạp/xóa file, căn giữa, dịch chuyển) để các tọa độ hiển thị tính lại
export const coordVersion = ref(0);

export const hoveredType = ref('');
export const faultyCount = ref(0);
export const editHistoryCount = ref(0);
export const hasUnsavedChanges = ref(false);
export const attributeBaseline = reactive({
    Name: '',
    ObjectType: '',
    Tag: '',
    Description: ''
});

export const stats = reactive({ meshes: 0, rebarCount: 0 });

// Bảng thống kê thép (tab Thống kê, src/ifc/bar-schedule.js). Hàng chứa mảng mesh nên dùng shallowRef (không bọc proxy).
export const barScheduleRows = shallowRef([]);
export const barScheduleDiameters = shallowRef([]);
export const barScheduleTotals = shallowRef(null);
export const barScheduleVisibleOnly = ref(false);
export const barScheduleSplitByFile = ref(false);
export const barScheduleStale = ref(true);

export const selectedMeshes = ref([]);
export const selectedObject = ref(null);
export const isEditingAttributes = ref(false);

// Shift Box Selection
export const isBoxSelecting = ref(false);
export const boxStart = reactive({ x: 0, y: 0 });
export const boxEnd = reactive({ x: 0, y: 0 });
export const isShiftPressed = ref(false);

export const contextMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    attrKey: '',
    attrValue: '',
    // Tên Pset khi chuột phải vào một thuộc tính Pset (rỗng = attribute thường); editable = sửa được giá trị
    psetName: '',
    editable: false
});

// Menu chuột phải trên tiêu đề tab phân nhóm (Pos / Name / ObjType / IFC Type)
export const groupTabMenu = reactive({ visible: false, x: 0, y: 0, criterion: '' });
// Bảng màu đang tô cho model: '' = màu mặc định (loại IFC / đường kính thép), hoặc tên tiêu chí nhóm
// ('pos' | 'name' | 'objectType' | 'entity') = tô theo màu chấm tròn của các nhóm (src/ifc/color-scheme.js)
export const groupColorScheme = ref('');

// Hộp thoại sửa giá trị thuộc tính Pset cho các cấu kiện đang chọn (src/ifc/pset-edit.js)
export const psetEditDialog = reactive({
    visible: false,
    psetName: '',
    propName: '',
    value: '',
    original: '',
    kind: 'text',
    targetCount: 0
});

export const editableAttributes = reactive({
    Name: '',
    ObjectType: '',
    Tag: '',
    Description: ''
});
export const hasAttributeChanges = computed(() =>
    editableAttributes.Name !== attributeBaseline.Name ||
    editableAttributes.ObjectType !== attributeBaseline.ObjectType ||
    editableAttributes.Tag !== attributeBaseline.Tag ||
    editableAttributes.Description !== attributeBaseline.Description
);

export const allGroups = reactive({
    pos: [],
    name: [],
    objectType: [],
    entity: []
});
export const IDLE_RENDER_INTERVAL_MS = 200;
export const selectionOutlines = new Map();
export const transportRotationAxis = new THREE.Vector3(0, 1, 0);

// BỘ 6 MẶT PHẲNG CẮT CROPBOX
export const clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100), // +X: mặt phải (x max)
    new THREE.Plane(new THREE.Vector3( 1, 0, 0), 100), // -X: mặt trái (x min)
    new THREE.Plane(new THREE.Vector3( 0,-1, 0), 100), // +Y: mặt trên (y max)
    new THREE.Plane(new THREE.Vector3( 0, 1, 0), 100), // -Y: mặt dưới (y min)
    new THREE.Plane(new THREE.Vector3( 0, 0,-1), 100), // +Z: mặt trước (z max)
    new THREE.Plane(new THREE.Vector3( 0, 0, 1), 100)  // -Z: mặt sau (z min)
];

// Trạng thái bounding box hiện tại của CropBox [minX, maxX, minY, maxY, minZ, maxZ]
export const cropBounds = reactive({
    minX: -5, maxX: 5,
    minY: -5, maxY: 5,
    minZ: -5, maxZ: 5
});

// Nhóm chứa khung viền CropBox và 6 tay cầm mũi tên
export const cropGroup = new THREE.Group();
export const handleMeshes = [];

// Nhóm viền đen mỏng Edges
export const edgesGroup = new THREE.Group();
// BatchedMesh: mỗi cấu kiện là một instance trong batch theo vật liệu; mesh gốc chỉ giữ dữ liệu (layer ẩn khỏi render)
export const batchGroup = new THREE.Group();
export const overlayGroup = new THREE.Group();
export const clashGroup = new THREE.Group();
clashGroup.name = 'ClashIntersectionVolumes';
export const clashContextGroup = new THREE.Group();
clashContextGroup.name = 'ClashContextOutlines';
export const clashSelectionGroup = new THREE.Group();
clashSelectionGroup.name = 'SelectedClashOutline';
export const clashAnnotationGroup = new THREE.Group();
clashAnnotationGroup.name = 'SelectedClashAnnotation';
export const clashPairGroup = new THREE.Group();
clashPairGroup.name = 'SelectedClashPairObjects';
// Màu view va chạm: khối giao ĐỎ, cặp đang chọn VÀNG, đối tượng A XANH DƯƠNG, đối tượng B TÍM, mô hình nền xám mờ
export const clashPairMaterialA = new THREE.MeshLambertMaterial({
    color: 0x3b82f6, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false
});
export const clashPairMaterialB = new THREE.MeshLambertMaterial({
    color: 0xa855f7, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false
});
// Chọn một cặp là hiện luôn 2 đối tượng A/B (vẫn tắt được bằng nút)
export const showClashPairObjects = ref(true);
// Ẩn thép không dính va chạm cho đỡ rối (thép có va chạm vẫn hiện)
export const clashHideOtherRebar = ref(false);
// Mô hình nền trong view va chạm: khối mờ có ánh sáng (dùng lại BatchedMesh của view thường, ít lệnh vẽ).
// Vẽ theo kiểu MỘT LỚP (scene.js: renderClashView): ghi độ sâu trước rồi chỉ tô bề mặt gần nhất, nên lồng thép
// hàng trăm lớp vẫn chỉ mờ đúng bằng opacity dưới đây, không cộng dồn thành mảng đặc.
export const CLASH_GHOST_LAYER = 2;
export const clashGhostConcreteMaterial = new THREE.MeshLambertMaterial({
    color: 0xa3aec0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false
});
export const clashGhostRebarMaterial = new THREE.MeshLambertMaterial({
    color: 0x8792a3, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false
});
// Cấu kiện có tham gia va chạm: đậm hơn nền (cũng một lớp)
export const clashInvolvedMaterial = new THREE.MeshLambertMaterial({
    color: 0x64748b, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false
});
// Lượt ghi độ sâu (không tô màu) trước khi tô lớp mờ
export const clashGhostDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
// Đường bao rất nhạt của bê tông (không vẽ cho thép để đỡ rối)
export const clashContextMaterial = new THREE.LineBasicMaterial({
    color: 0x94a3b8, transparent: true, opacity: 0.22,
    depthTest: true, depthWrite: false, toneMapped: false
});
export const clashOutlineMaterial = new THREE.LineBasicMaterial({
    color: 0x080d16, transparent: false, opacity: 1,
    depthTest: true, depthWrite: false, toneMapped: false
});
export const batchSlotByElement = new WeakMap();
// Cấu kiện đang chọn -> { batch, id } trong batch chọn
export const selectionSlotByElement = new Map();
export const overlayByElement = new Map();
export const edgeCropUniforms = {
    cropActive: { value: false },
    showOutsideEdges: { value: false },
    cropMin: { value: new THREE.Vector3() },
    cropMax: { value: new THREE.Vector3() }
};
export const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x1e293b,
    linewidth: 1,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
});
edgeMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, edgeCropUniforms);
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEdgeWorldPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdgeWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEdgeWorldPosition;\nuniform bool cropActive;\nuniform bool showOutsideEdges;\nuniform vec3 cropMin;\nuniform vec3 cropMax;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nif (cropActive && (any(lessThan(vEdgeWorldPosition, cropMin)) || any(greaterThan(vEdgeWorldPosition, cropMax)))) { if (!showOutsideEdges) discard; diffuseColor.a *= 0.3; }');
};

export const psetCache = new Map();
export const materialCache = new Map();
export const flatMaterialCache = new WeakMap();
export const xrayMaterials = {
    lit: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8, side: THREE.DoubleSide, transparent: true, depthWrite: false }),
    flat: new THREE.MeshBasicMaterial({ color: 0x94a3b8, side: THREE.DoubleSide, transparent: true, depthWrite: false })
};

// Raycasting & Highlight
export const raycaster = new THREE.Raycaster();
export const mouse = new THREE.Vector2();

export const hoverMaterial = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.35,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthTest: true
});

export const selectMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.5,
    roughness: 0.2,
    metalness: 0.3,
    side: THREE.DoubleSide
});

export const selectionOutlineMaterial = new THREE.LineDashedMaterial({
    color: 0xfbbf24,
    dashSize: 0.12,
    gapSize: 0.07,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false
});

export const modelOpacityBases = new WeakMap();

export const transportProfileStorageKey = 'ifc-editor-transport-profiles';
export const transportInputFields = ['centerX', 'centerY', 'centerZ', 'angleDegrees', 'vectorX', 'vectorY', 'vectorZ'];

// --- KIỂM TRA CLASH: khối giao đặc màu đỏ (có ánh sáng để thấy hình khối) ---
export const clashVolumeMaterial = new THREE.MeshLambertMaterial({
    color: 0xef4444, emissive: 0x450a0a, side: THREE.DoubleSide, transparent: false,
    opacity: 1, depthWrite: true, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -1
});
// Khối clash đang chọn là một mesh riêng vẽ đè lên khối đỏ đã gộp: offset mạnh hơn để luôn nằm trên
export const clashYellowMaterial = new THREE.MeshLambertMaterial({
    color: 0xfacc15, emissive: 0x3f2d00, side: THREE.DoubleSide, transparent: false,
    opacity: 1, depthWrite: true, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4
});
// Màu nhấp nháy xen kẽ với vàng khi vừa chọn
export const clashFlashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, side: THREE.DoubleSide, transparent: false,
    opacity: 1, depthWrite: true, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, toneMapped: false
});
// Biến runtime có thể gán lại (trước đây là `let` trong setup)
export const rt = {
    canvasResizeObserver: null,
    lastCanvasWidth: 0,
    lastCanvasHeight: 0,
    uiAudioContext: null,
    clashCancelRequested: false,
    selectedClashMesh: null,
    clashFlashInterval: null,
    clashFlashTimeout: null,
    panelResizeState: null,
    scene: null,
    camera: null,
    perspCamera: null,
    orthoCamera: null,
    activeCamera: null,
    renderer: null,
    controls: null,
    gridHelper: null,
    dirLight1: null,
    dirLight2: null,
    ambientLight: null,
    hemiLight: null,
    animationFrameId: null,
    needsRender: true,
    lastRenderTime: 0,
    ifcAPI: null,
    currentModelID: null,
    modelGroup: new THREE.Group(),
    transportGroup: new THREE.Group(),
    sampleInfoLabel: null,
    lastMiddleClick: null,
    modelOffset: new THREE.Vector3(0, 0, 0),
    modelRebaseOrigin: null,
    cropBoxWireframe: null,
    hoveredCropHandle: null,
    cropDragHandle: null,
    cropDragAxis: '',
    cropDragIsMin: false,
    cropDragStartMouse: { x: 0, y: 0 },
    cropDragStartValue: 0,
    cropDragPixelToWorld: 0,
    batchRecords: [],
    // Batch vẽ các cấu kiện đang chọn (rendering.js rebuildSelectionBatches) và đường viền chọn gộp (selection.js)
    selectionBatches: [],
    selectionOutline: null,
    meshesByKey: new Map(),
    sourceFileSequence: 0,
    pointerDownPos: { x: 0, y: 0 },
    isMiddleMouseDown: false,
    isOrbiting: false,
    lastSelectedMeshes: new Set(),
    orbitPivot: null,
    dimPendingPoint: null,
    dimPendingMarker: null,
    dimPendingElement: null,
    dimShapeMarkers: null,
    dimSurfaceDisc: null,
    dimEdgeHint: null,
    dimHoverMarker: null,
    intersectionToken: 0,
    intersectionSignature: '',
    dimPreview: null,
    dimSnapLine: null,
    dimSequence: 0,
    hoveredMesh: null
};
