import { editHistoryCount, hasUnsavedChanges, projectHeaderOverrides, projectInfoSourceId, projectInfos, rt, showRightPanel, selectedMeshes, sourceFiles } from '../state/state.js';
import { showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';

// Thông tin cấp dự án của file IFC: header file (FILE_NAME / FILE_DESCRIPTION), IfcProject, IfcSite, IfcBuilding,
// IfcBuildingStorey, lịch sử sở hữu (người, tổ chức, ứng dụng xuất IFC) và địa chỉ.
// Mỗi file đã nạp có một bản `projectInfos[sourceId] = { sourceId, sections }`; mỗi section có các field binding trực tiếp
// vào ô nhập (field.value) và giữ giá trị gốc (field.original) để biết đã sửa gì.

const FILE_DESCRIPTION = 599546466;
const FILE_NAME = 1390159747;
const FILE_SCHEMA = 1109904537;
const IFC_TYPE = {
    project: 103090709,
    site: 4097777520,
    building: 4031249490,
    storey: 3124254112
};

// [thuộc tính, nhãn (khóa tiếng Việt), kiểu]. Thuộc tính null không mang kiểu nên phải khai báo kiểu ở đây.
// Chỉ hiển thị thuộc tính thực sự có trong dòng đọc được (IFC2X3 và IFC4 khác nhau).
const COMMON_FIELDS = [
    ['GlobalId', 'GlobalId', 'readonly'],
    ['Name', 'Tên (Name)', 'string'],
    ['LongName', 'Tên đầy đủ (LongName)', 'string'],
    ['Description', 'Mô tả (Description)', 'string'],
    ['ObjectType', 'Kiểu đối tượng (ObjectType)', 'string']
];
const ENTITY_SECTIONS = [
    { key: 'project', type: IFC_TYPE.project, title: 'Dự án (IfcProject)', open: true, fields: [...COMMON_FIELDS, ['Phase', 'Giai đoạn (Phase)', 'string']] },
    {
        key: 'site', type: IFC_TYPE.site, title: 'Khu đất (IfcSite)', open: true,
        fields: [...COMMON_FIELDS,
            ['RefLatitude', 'Vĩ độ (RefLatitude: độ, phút, giây, phần triệu giây)', 'angle'],
            ['RefLongitude', 'Kinh độ (RefLongitude: độ, phút, giây, phần triệu giây)', 'angle'],
            ['RefElevation', 'Cao độ tham chiếu (RefElevation)', 'number'],
            ['LandTitleNumber', 'Số giấy chứng nhận đất (LandTitleNumber)', 'string']],
        address: 'SiteAddress'
    },
    {
        key: 'building', type: IFC_TYPE.building, title: 'Tòa nhà (IfcBuilding)', open: true,
        fields: [...COMMON_FIELDS,
            ['ElevationOfRefHeight', 'Cao độ tham chiếu công trình (ElevationOfRefHeight)', 'number'],
            ['ElevationOfTerrain', 'Cao độ địa hình (ElevationOfTerrain)', 'number']],
        address: 'BuildingAddress'
    },
    { key: 'storey', type: IFC_TYPE.storey, title: 'Tầng (IfcBuildingStorey)', open: false, fields: [...COMMON_FIELDS, ['Elevation', 'Cao độ tầng (Elevation)', 'number']] }
];
const ADDRESS_FIELDS = [
    ['AddressLines', 'Dòng địa chỉ (AddressLines)', 'list'],
    ['InternalLocation', 'Vị trí nội bộ (InternalLocation)', 'string'],
    ['PostalBox', 'Hộp thư (PostalBox)', 'string'],
    ['Town', 'Thành phố (Town)', 'string'],
    ['Region', 'Tỉnh / Vùng (Region)', 'string'],
    ['PostalCode', 'Mã bưu chính (PostalCode)', 'string'],
    ['Country', 'Quốc gia (Country)', 'string']
];
// IFC4 dùng Identification, IFC2X3 dùng Id
const PERSON_FIELDS = [['Identification', 'Mã định danh (Identification)', 'string'], ['Id', 'Mã định danh (Id)', 'string'], ['FamilyName', 'Họ (FamilyName)', 'string'], ['GivenName', 'Tên riêng (GivenName)', 'string']];
const ORGANIZATION_FIELDS = [['Identification', 'Mã định danh (Identification)', 'string'], ['Id', 'Mã định danh (Id)', 'string'], ['Name', 'Tên tổ chức (Name)', 'string'], ['Description', 'Mô tả (Description)', 'string']];
const APPLICATION_FIELDS = [['Version', 'Phiên bản (Version)', 'string'], ['ApplicationFullName', 'Tên ứng dụng (ApplicationFullName)', 'string'], ['ApplicationIdentifier', 'Mã ứng dụng (ApplicationIdentifier)', 'string']];
const OWNER_HISTORY_FIELDS = [['ChangeAction', 'Hành động thay đổi (ChangeAction)', 'readonly'], ['CreationDate', 'Ngày tạo (CreationDate)', 'timestamp']];

const safeGetLine = (modelID, id) => {
    try {
        return rt.ifcAPI.GetLine(modelID, id, false);
    } catch (error) {
        return null;
    }
};
const getIdsOfType = (modelID, type) => {
    const ids = [];
    try {
        const vector = rt.ifcAPI.GetLineIDsWithType(modelID, type);
        for (let i = 0; i < vector.size(); i++) ids.push(vector.get(i));
    } catch (error) {
        console.warn('Không đọc được danh sách thực thể thông tin dự án:', error);
    }
    return ids;
};
const refId = (attribute) => (attribute && typeof attribute === 'object' && attribute.type === 5 ? attribute.value : null);

// Chuyển thuộc tính web-ifc thành chuỗi hiển thị trong ô nhập
const toDisplayValue = (attribute, kind) => {
    if (attribute === null || attribute === undefined) return '';
    if (kind === 'list') return Array.isArray(attribute) ? attribute.map(item => String(item?.value ?? '')).join('\n') : '';
    if (kind === 'angle') return Array.isArray(attribute.value) ? attribute.value.join(', ') : '';
    if (kind === 'timestamp') {
        const date = new Date(Number(attribute.value) * 1000);
        return Number.isNaN(date.getTime()) ? String(attribute.value) : date.toISOString();
    }
    return attribute.value === null || attribute.value === undefined ? '' : String(attribute.value);
};

const makeField = (expressID, key, label, kind, value) => ({
    id: `${expressID ?? 'header'}.${key}`,
    expressID,
    key,
    label,
    kind: kind === 'timestamp' ? 'readonly' : kind,
    readonly: kind === 'readonly' || kind === 'timestamp',
    value,
    original: value
});

// Các field của một thực thể, bỏ qua thuộc tính không tồn tại trong dòng (khác schema)
const buildEntityFields = (expressID, line, definitions) => {
    const fields = [];
    definitions.forEach(([key, label, kind]) => {
        if (!(key in line)) return;
        const attribute = line[key];
        let effectiveKind = kind;
        // Góc vĩ/kinh độ đang null: không có định dạng gốc để ghi lại nên chỉ cho xem
        if (kind === 'angle' && (attribute === null || attribute === undefined)) effectiveKind = 'readonly';
        fields.push(makeField(expressID, key, label, effectiveKind, toDisplayValue(attribute, kind)));
    });
    return fields;
};

const buildSection = (key, title, expressID, subtitle, fields, open = true, typeName = '') => ({
    key, title, expressID, subtitle, fields, open, typeName
});

const readHeader = (modelID) => {
    const fields = [];
    const readLine = (code) => {
        try {
            return rt.ifcAPI.GetHeaderLine(modelID, code);
        } catch (error) {
            return null;
        }
    };
    const listText = (value) => (Array.isArray(value) ? value.map(item => String(item?.value ?? '')).join('\n') : '');
    const textOf = (value) => String(value?.value ?? '');

    const fileName = readLine(FILE_NAME)?.arguments;
    if (fileName) {
        fields.push(makeField(null, 'name', 'Tên file (name)', 'string', textOf(fileName[0])));
        fields.push(makeField(null, 'time_stamp', 'Thời gian (time_stamp)', 'string', textOf(fileName[1])));
        fields.push(makeField(null, 'author', 'Tác giả (author)', 'list', listText(fileName[2])));
        fields.push(makeField(null, 'organization', 'Tổ chức (organization)', 'list', listText(fileName[3])));
        fields.push(makeField(null, 'preprocessor_version', 'Phần mềm tiền xử lý (preprocessor_version)', 'string', textOf(fileName[4])));
        fields.push(makeField(null, 'originating_system', 'Hệ thống gốc (originating_system)', 'string', textOf(fileName[5])));
        fields.push(makeField(null, 'authorization', 'Người duyệt / ủy quyền (authorization)', 'string', textOf(fileName[6])));
    }
    const description = readLine(FILE_DESCRIPTION)?.arguments;
    if (description) {
        fields.push(makeField(null, 'description', 'Mô tả file (description)', 'list', listText(description[0])));
        fields.push(makeField(null, 'implementation_level', 'Mức triển khai (implementation_level)', 'string', textOf(description[1])));
    }
    const schema = readLine(FILE_SCHEMA)?.arguments;
    if (schema) fields.push(makeField(null, 'schema', 'IFC schema', 'readonly', listText(schema[0])));
    return fields.length ? buildSection('header', 'Header file IFC (FILE_NAME / FILE_DESCRIPTION)', null, '', fields, true, 'HEADER') : null;
};

const addEntitySection = (sections, seen, key, title, modelID, expressID, definitions, open = true, typeName = '') => {
    if (expressID === null || seen.has(expressID)) return null;
    const line = safeGetLine(modelID, expressID);
    if (!line) return null;
    seen.add(expressID);
    const fields = buildEntityFields(expressID, line, definitions);
    if (fields.length === 0) return line;
    const subtitle = line.Name?.value || line.ApplicationFullName?.value || [line.GivenName?.value, line.FamilyName?.value].filter(Boolean).join(' ') || '';
    sections.push(buildSection(`${key}-${expressID}`, title, expressID, subtitle, fields, open, typeName));
    return line;
};

export const loadProjectInfo = (source) => {
    if (!source || !rt.ifcAPI) return null;
    const modelID = source.modelID;
    const sections = [];
    const seen = new Set();

    const header = readHeader(modelID);
    if (header) sections.push(header);

    let ownerHistoryId = null;
    ENTITY_SECTIONS.forEach(definition => {
        getIdsOfType(modelID, definition.type).forEach(expressID => {
            const line = addEntitySection(sections, seen, definition.key, definition.title, modelID, expressID, definition.fields, definition.open, definition.key.toUpperCase());
            if (!line) return;
            if (ownerHistoryId === null) ownerHistoryId = refId(line.OwnerHistory);
            const addressId = definition.address ? refId(line[definition.address]) : null;
            addEntitySection(sections, seen, 'address', 'Địa chỉ (IfcPostalAddress)', modelID, addressId, ADDRESS_FIELDS, false, 'ADDRESS');
        });
    });

    // Người / tổ chức / ứng dụng xuất IFC lấy từ OwnerHistory của đối tượng gốc
    const history = ownerHistoryId === null ? null : addEntitySection(sections, seen, 'history', 'Lịch sử sở hữu (IfcOwnerHistory)', modelID, ownerHistoryId, OWNER_HISTORY_FIELDS, false, 'OWNERHISTORY');
    if (history) {
        const personAndOrganization = safeGetLine(modelID, refId(history.OwningUser));
        if (personAndOrganization) {
            addEntitySection(sections, seen, 'person', 'Người xuất IFC (IfcPerson)', modelID, refId(personAndOrganization.ThePerson), PERSON_FIELDS, true, 'PERSON');
            addEntitySection(sections, seen, 'organization', 'Tổ chức của người xuất (IfcOrganization)', modelID, refId(personAndOrganization.TheOrganization), ORGANIZATION_FIELDS, true, 'ORGANIZATION');
        }
        const application = addEntitySection(sections, seen, 'application', 'Ứng dụng xuất IFC (IfcApplication)', modelID, refId(history.OwningApplication), APPLICATION_FIELDS, true, 'APPLICATION');
        if (application) {
            addEntitySection(sections, seen, 'developer', 'Nhà phát triển ứng dụng (IfcOrganization)', modelID, refId(application.ApplicationDeveloper), ORGANIZATION_FIELDS, false, 'ORGANIZATION');
        }
    }

    const info = { sourceId: source.id, sections };
    projectInfos[source.id] = info;
    return info;
};

// Nạp xong một file: lập thông tin dự án và mở panel phải (nếu đang không chọn cấu kiện nào)
export const showProjectInfoForSource = (source) => {
    const info = loadProjectInfo(source);
    if (!info) return;
    projectInfoSourceId.value = source.id;
    if (selectedMeshes.value.length === 0) showRightPanel.value = true;
};

export const removeProjectInfo = (sourceId) => {
    delete projectInfos[sourceId];
    delete projectHeaderOverrides[sourceId];
    if (projectInfoSourceId.value === sourceId) {
        projectInfoSourceId.value = sourceFiles.value.find(item => item.id !== sourceId)?.id ?? null;
    }
};

export const isProjectInfoDirty = (info) => !!info && info.sections.some(section => section.fields.some(field => field.value !== field.original));

// --- GHI LẠI VÀO IFC ĐANG MỞ ---
const splitLines = (text) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

// web-ifc không bỏ dấu escape khi đọc lại chuỗi có dấu nháy đơn / gạch chéo ngược, nên qua các lần lưu - mở file xuất
// chuỗi sẽ bị nhân đôi hoặc làm hỏng file. Thay bằng ký tự tương đương an toàn trước khi ghi vào thực thể IFC.
const sanitizeIfcText = (text) => text.split("'").join('’').split(String.fromCharCode(92)).join('/');

const toIfcAttribute = (field, original) => {
    const text = sanitizeIfcText(field.value);
    if (field.kind === 'list') {
        const items = splitLines(text);
        if (items.length === 0) return null;
        return items.map(item => ({ type: 1, value: item }));
    }
    if (field.kind === 'angle') {
        const parts = text.split(/[,\s]+/).filter(Boolean).map(Number);
        if (parts.length < 3 || parts.length > 4 || parts.some(part => !Number.isFinite(part))) return undefined;
        return { ...original, value: parts.map(Math.trunc) };
    }
    if (field.kind === 'number') {
        if (text.trim() === '') return null;
        const number = Number(text.replace(',', '.'));
        return Number.isFinite(number) ? (original ? { ...original, value: number } : { type: 4, value: number }) : undefined;
    }
    if (text.trim() === '') return null;
    return original ? { ...original, value: text } : { type: 1, value: text };
};

export const applyProjectInfoChanges = () => {
    const info = projectInfos[projectInfoSourceId.value];
    const source = sourceFiles.value.find(item => item.id === projectInfoSourceId.value);
    if (!info || !source) return;

    const entityChanges = new Map();
    let headerChanged = false;
    const invalid = [];
    info.sections.forEach(section => section.fields.forEach(field => {
        if (field.readonly || field.value === field.original) return;
        if (field.expressID === null) headerChanged = true;
        else {
            if (!entityChanges.has(field.expressID)) entityChanges.set(field.expressID, []);
            entityChanges.get(field.expressID).push(field);
        }
    }));

    let written = 0;
    let sanitizedCount = 0;
    entityChanges.forEach((fields, expressID) => {
        const line = safeGetLine(source.modelID, expressID);
        if (!line) return;
        const applied = [];
        fields.forEach(field => {
            const attribute = toIfcAttribute(field, line[field.key]);
            if (attribute === undefined) {
                invalid.push(t(field.label));
                return;
            }
            line[field.key] = attribute;
            const sanitized = sanitizeIfcText(field.value);
            if (sanitized !== field.value) sanitizedCount++;
            field.value = sanitized;
            applied.push(field);
        });
        if (applied.length === 0) return;
        try {
            rt.ifcAPI.WriteLine(source.modelID, line);
            applied.forEach(field => { field.original = field.value; });
            written += applied.length;
        } catch (error) {
            console.error(`Không ghi được thực thể #${expressID}:`, error);
            invalid.push(`#${expressID}`);
        }
    });

    // Header không ghi được qua web-ifc: lưu lại và áp dụng vào text IFC khi xuất (export.js)
    if (headerChanged) {
        const header = info.sections.find(section => section.key === 'header');
        projectHeaderOverrides[source.id] = Object.fromEntries(header.fields.map(field => [field.key, field.value]));
        header.fields.forEach(field => {
            if (field.value !== field.original) written++;
            field.original = field.value;
        });
    }

    if (written > 0) {
        editHistoryCount.value++;
        hasUnsavedChanges.value = true;
        showToast(t('Đã lưu thông tin dự án'), t('Đã cập nhật {0} thông tin. Bấm "Lưu file IFC" để tạo file mới.', [written]), 'success');
    }
    if (sanitizedCount > 0) showToast(t("Đã thay ký tự đặc biệt"), t("Dấu nháy đơn và gạch chéo ngược được thay bằng ’ và / để tránh làm hỏng file IFC."));
    if (invalid.length > 0) showToast(t('Giá trị không hợp lệ'), t('Không áp dụng được: {0}', [invalid.join(', ')]));
};

export const resetProjectInfo = () => {
    const source = sourceFiles.value.find(item => item.id === projectInfoSourceId.value);
    if (!source) return;
    // Khôi phục các field chưa áp dụng về giá trị đã ghi vào IFC
    projectInfos[source.id]?.sections.forEach(section => section.fields.forEach(field => { field.value = field.original; }));
};

// --- HEADER KHI XUẤT FILE ---
// Mã hóa chuỗi theo STEP: ' -> '', \ -> \\, ký tự ngoài ASCII -> \X2\....\X0\ (\X4\ cho ký tự ngoài BMP)
export const encodeStepString = (text) => {
    let output = '';
    let pending = '';
    const flush = () => {
        if (!pending) return;
        const hasAstral = Array.from(pending).some(char => char.codePointAt(0) > 0xFFFF);
        if (hasAstral) output += `\\X4\\${Array.from(pending).map(char => char.codePointAt(0).toString(16).toUpperCase().padStart(8, '0')).join('')}\\X0\\`;
        else output += `\\X2\\${Array.from(pending).map(char => char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')}\\X0\\`;
        pending = '';
    };
    for (const char of text) {
        if (char.codePointAt(0) > 126) {
            pending += char;
            continue;
        }
        flush();
        output += char === "'" ? "''" : char === '\\' ? '\\\\' : char;
    }
    flush();
    return output;
};

const stepString = (text) => `'${encodeStepString(text ?? '')}'`;
const stepList = (text) => `(${splitLines(text ?? '').map(stepString).join(',')})`;

// Thay FILE_NAME / FILE_DESCRIPTION trong phần HEADER bằng giá trị đã sửa của file đầu tiên
export const applyHeaderOverrides = (data) => {
    const firstSource = sourceFiles.value[0];
    const override = firstSource ? projectHeaderOverrides[firstSource.id] : null;
    if (!override) return data;
    const text = new TextDecoder('utf-8').decode(data);
    const dataStart = text.search(/\n\s*DATA\s*;/i);
    if (dataStart < 0) return data;
    let header = text.slice(0, dataStart);
    const statement = (name) => new RegExp(`${name}\\s*\\((?:'(?:''|[^'])*'|[^';])*\\)\\s*;`, 'i');
    header = header.replace(statement('FILE_NAME'), () =>
        `FILE_NAME(${stepString(override.name)},${stepString(override.time_stamp)},${stepList(override.author)},${stepList(override.organization)},${stepString(override.preprocessor_version)},${stepString(override.originating_system)},${stepString(override.authorization)});`);
    header = header.replace(statement('FILE_DESCRIPTION'), () =>
        `FILE_DESCRIPTION(${stepList(override.description)},${stepString(override.implementation_level)});`);
    return new TextEncoder().encode(header + text.slice(dataStart));
};
