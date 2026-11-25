// Bảng thống kê thép (bar schedule): gom thép theo Pos + Ø (tùy chọn tách theo file), số lượng, chiều dài, khối lượng.
//
// Chiều dài 1 thanh lấy theo thứ tự:
//  1. thuộc tính IFC BarLength của IfcReinforcingBar (đổi theo đơn vị dài của file),
//  2. tính từ hình học: thanh thép là ống kín nên thể tích V và diện tích bề mặt S cho ra bán kính (trung đoạn) h
//     và chiều dài L, không cần biết thanh có uốn hay không (khung bao chỉ đúng cho thanh thẳng):
//        V = k·h²·L,  S = 2k·h·L + 2k·h²   (k = n·tan(π/n), mặt cắt đa giác đều n cạnh)
//     => 2k·h³ − S·h + 2V = 0, giải bằng Newton từ h0 = 2V/S.
// Khối lượng = L (m) × Ø² (mm) × 0.00616 kg/m (thép 7850 kg/m³). Ø là đường kính danh định đã nhận lúc nạp file.
import * as THREE from 'three';
import { selectGroupMeshes, zoomToGroup } from '../selection/selection.js';
import { barScheduleDiameters, barScheduleRows, barScheduleSplitByFile, barScheduleStale, barScheduleTotals, barScheduleVisibleOnly, fileName, pendingDeletedExpressIDs, rt, sourceFiles } from '../state/state.js';
import { showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';

const STEEL_KG_PER_M_PER_MM2 = 7850 * Math.PI / 4 * 1e-6;
// Mặt cắt đa giác 12 cạnh như web-ifc tạo cho thép swept disk (CIRCLE_SEGMENTS = 12 trong loader.js): k = 12·tan(15°)
const SECTION_FACTOR = 12 * Math.tan(Math.PI / 12);

export const markBarScheduleStale = () => { barScheduleStale.value = true; };

// --- HÌNH HỌC ---
// V, S của hình học (hệ local), tính một lần cho mỗi geometry
const geometryMeasureCache = new WeakMap();
const measureGeometry = (geometry) => {
    let cached = geometryMeasureCache.get(geometry);
    if (cached) return cached;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
    let volume = 0;
    let area = 0;
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
        const i0 = index ? index.getX(i) : i;
        const i1 = index ? index.getX(i + 1) : i + 1;
        const i2 = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(position, i0);
        b.fromBufferAttribute(position, i1);
        c.fromBufferAttribute(position, i2);
        volume += a.dot(cross.crossVectors(b, c)) / 6;
        area += cross.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).length() / 2;
    }
    cached = { volume: Math.abs(volume), area };
    geometryMeasureCache.set(geometry, cached);
    return cached;
};

const lengthFromVolumeArea = (volume, area) => {
    if (!(volume > 0) || !(area > 0)) return 0;
    const k = SECTION_FACTOR;
    let h = 2 * volume / area;
    for (let i = 0; i < 20; i++) {
        const f = 2 * k * h * h * h - area * h + 2 * volume;
        const df = 6 * k * h * h - area;
        if (Math.abs(df) < 1e-12) break;
        const next = h - f / df;
        if (!(next > 0)) break;
        if (Math.abs(next - h) < 1e-9) { h = next; break; }
        h = next;
    }
    const length = volume / (k * h * h);
    return Number.isFinite(length) ? length : 0;
};

// Chiều dài (m) theo hình học của một cấu kiện (có thể gồm nhiều mesh)
const geometricLength = (meshes) => {
    let volume = 0;
    let area = 0;
    meshes.forEach(mesh => {
        if (!mesh.geometry?.attributes?.position) return;
        const measure = measureGeometry(mesh.geometry);
        mesh.updateMatrix();
        const scale = Math.abs(mesh.matrix.determinant());
        volume += measure.volume * scale;
        area += measure.area * Math.cbrt(scale) ** 2;
    });
    let length = lengthFromVolumeArea(volume, area);
    // Hình học hở (không đo được thể tích): lấy cạnh dài nhất của khung bao
    if (!(length > 0)) {
        const box = new THREE.Box3();
        meshes.forEach(mesh => box.union(new THREE.Box3().setFromObject(mesh)));
        const size = box.getSize(new THREE.Vector3());
        length = Math.max(size.x, size.y, size.z);
    }
    return length;
};

// BarLength không bị sửa trong app nên đọc một lần cho mỗi cấu kiện (mesh bị gỡ thì cache tự giải phóng)
const barLengthCache = new WeakMap();
const ifcBarLength = (mesh) => {
    if (barLengthCache.has(mesh)) return barLengthCache.get(mesh);
    const ud = mesh.userData;
    let length = 0;
    if (!ud.isDemo && ud.sourceModelID !== null && ud.sourceModelID !== undefined) {
        try {
            const value = Number(rt.ifcAPI.GetLine(ud.sourceModelID, ud.expressID, false)?.BarLength?.value);
            const unit = sourceFiles.value.find(source => source.id === ud.sourceId)?.unitMeters || 1;
            if (value > 0) length = value * unit;
        } catch (error) {}
    }
    barLengthCache.set(mesh, length);
    return length;
};

// --- LẬP BẢNG ---
const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

export const computeBarSchedule = () => {
    const groups = new Map();
    const splitByFile = barScheduleSplitByFile.value;
    (rt.meshesByKey || new Map()).forEach((meshes, key) => {
        const first = meshes[0];
        if (!first?.userData?.isRebar || pendingDeletedExpressIDs.has(key)) return;
        if (barScheduleVisibleOnly.value && !meshes.some(mesh => mesh.visible)) return;
        const ud = first.userData;
        const ifcLength = ifcBarLength(first);
        const length = ifcLength > 0 ? ifcLength : geometricLength(meshes);
        const pos = ud.tag || '';
        const diameter = Number(ud.diameter) || 0;
        const file = splitByFile ? (ud.sourceFileName || t('Mô hình mẫu')) : '';
        const groupKey = `${file}|${pos}|${diameter}`;
        let row = groups.get(groupKey);
        if (!row) {
            row = { key: groupKey, file, pos, diameter, count: 0, totalLength: 0, minLength: Infinity, maxLength: 0, estimated: false, meshes: [] };
            groups.set(groupKey, row);
        }
        row.count++;
        row.totalLength += length;
        row.minLength = Math.min(row.minLength, length);
        row.maxLength = Math.max(row.maxLength, length);
        if (!(ifcLength > 0)) row.estimated = true;
        row.meshes.push(...meshes);
    });

    const rows = Array.from(groups.values()).map(row => ({
        ...row,
        avgLength: row.count ? row.totalLength / row.count : 0,
        // Cùng Pos mà chiều dài lệch quá 1 cm: đáng kiểm tra
        lengthVaries: row.maxLength - row.minLength > 0.01,
        weight: row.totalLength * row.diameter * row.diameter * STEEL_KG_PER_M_PER_MM2
    })).sort((a, b) => naturalCompare(a.file, b.file) || naturalCompare(a.pos || '￿', b.pos || '￿') || a.diameter - b.diameter);

    const byDiameter = new Map();
    rows.forEach(row => {
        const item = byDiameter.get(row.diameter) || { diameter: row.diameter, count: 0, totalLength: 0, weight: 0 };
        item.count += row.count;
        item.totalLength += row.totalLength;
        item.weight += row.weight;
        byDiameter.set(row.diameter, item);
    });

    barScheduleRows.value = rows;
    barScheduleDiameters.value = Array.from(byDiameter.values()).sort((a, b) => a.diameter - b.diameter);
    barScheduleTotals.value = rows.reduce((sum, row) => ({
        count: sum.count + row.count,
        totalLength: sum.totalLength + row.totalLength,
        weight: sum.weight + row.weight
    }), { count: 0, totalLength: 0, weight: 0 });
    barScheduleStale.value = false;
};

// Tự lập lại bảng (gọi từ watch trong main.js khi tab đang mở và dữ liệu đổi)
let refreshTimer = 0;
export const scheduleBarScheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(computeBarSchedule, 120);
};

// --- XUẤT FILE ---
const exportColumns = () => [
    ...(barScheduleSplitByFile.value ? [{ title: t('File'), value: row => row.file, text: true }] : []),
    { title: 'Pos', value: row => row.pos || '', text: true },
    { title: t('Ø (mm)'), value: row => row.diameter },
    { title: t('Số lượng'), value: row => row.count },
    { title: t('L 1 thanh (m)'), value: row => Number(row.avgLength.toFixed(3)) },
    { title: t('L min (m)'), value: row => Number(row.minLength.toFixed(3)) },
    { title: t('L max (m)'), value: row => Number(row.maxLength.toFixed(3)) },
    { title: t('Tổng L (m)'), value: row => Number(row.totalLength.toFixed(2)) },
    { title: t('Khối lượng (kg)'), value: row => Number(row.weight.toFixed(2)) },
    { title: t('Nguồn chiều dài'), value: row => (row.estimated ? t('Hình học') : 'IFC BarLength'), text: true }
];

const downloadText = (content, extension, mime) => {
    const base = (fileName.value || 'model').replace(/\.[^/.]+$/, '');
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${base}_bar_schedule.${extension}`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const ensureRows = () => {
    if (barScheduleStale.value) computeBarSchedule();
    if (barScheduleRows.value.length === 0) {
        showToast(t('Không có thép'), t('Không có thanh thép nào để thống kê.'));
        return false;
    }
    return true;
};

export const exportBarScheduleCsv = () => {
    if (!ensureRows()) return;
    const columns = exportColumns();
    const escape = (value) => {
        const text = String(value);
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [columns.map(column => escape(column.title)).join(',')];
    barScheduleRows.value.forEach(row => lines.push(columns.map(column => escape(column.value(row))).join(',')));
    // BOM để Excel đọc đúng UTF-8 (tiếng Việt, ký hiệu Ø)
    downloadText(`﻿${lines.join('\r\n')}\r\n`, 'csv', 'text/csv;charset=utf-8');
};

// Excel 2003 XML (SpreadsheetML): ô số có kiểu Number nên không phụ thuộc dấu thập phân theo vùng như CSV
export const exportBarScheduleExcel = () => {
    if (!ensureRows()) return;
    const columns = exportColumns();
    const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cell = (value, text, style = '') => {
        const isNumber = !text && typeof value === 'number' && Number.isFinite(value);
        return `<Cell${style}><Data ss:Type="${isNumber ? 'Number' : 'String'}">${xml(value)}</Data></Cell>`;
    };
    const rowXml = (cells) => `<Row>${cells.join('')}</Row>`;
    const scheduleRows = [
        rowXml(columns.map(column => cell(column.title, true, ' ss:StyleID="h"'))),
        ...barScheduleRows.value.map(row => rowXml(columns.map(column => cell(column.value(row), column.text))))
    ];
    const totals = barScheduleTotals.value;
    const diameterRows = [
        rowXml([t('Ø (mm)'), t('Số lượng'), t('Tổng L (m)'), t('Khối lượng (kg)')].map(title => cell(title, true, ' ss:StyleID="h"'))),
        ...barScheduleDiameters.value.map(item => rowXml([
            cell(item.diameter), cell(item.count), cell(Number(item.totalLength.toFixed(2))), cell(Number(item.weight.toFixed(2)))
        ])),
        rowXml([cell(t('Tổng'), true, ' ss:StyleID="h"'), cell(totals.count), cell(Number(totals.totalLength.toFixed(2))), cell(Number(totals.weight.toFixed(2)))])
    ];
    const sheet = (name, rows) => `<Worksheet ss:Name="${xml(name)}"><Table>${rows.join('')}</Table></Worksheet>`;
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#DDEBF7" ss:Pattern="Solid"/></Style></Styles>
${sheet(t('Thống kê thép'), scheduleRows)}
${sheet(t('Theo đường kính'), diameterRows)}
</Workbook>`;
    downloadText(content, 'xls', 'application/vnd.ms-excel');
};

export const formatScheduleLength = (row) => (row.lengthVaries
    ? `${row.minLength.toFixed(2)}–${row.maxLength.toFixed(2)}`
    : row.avgLength.toFixed(2));

// Click hàng: chọn + zoom tới các thanh của hàng; Ctrl+click: thêm vào vùng chọn
export const selectBarScheduleRow = (row, event) => {
    if (event?.ctrlKey || event?.metaKey) selectGroupMeshes(row);
    else zoomToGroup(row);
};
