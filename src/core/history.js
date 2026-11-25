// Hoàn tác / làm lại (Ctrl+Z / Ctrl+Y) theo kiểu stack lệnh.
//
// Mỗi thao tác ghi vào IFC (attribute, Pset, transport, thông tin dự án, đánh dấu xóa) đẩy một lệnh
// { label, undo(), redo() } bằng pushHistory SAU KHI đã thực hiện xong. Bộ đếm lưu IFC (editHistoryCount)
// và hasUnsavedChanges tính từ vị trí stack so với lần lưu gần nhất, nên hoàn tác về đúng bản đã lưu thì nút lưu tắt.
//
// Thay đổi trên model web-ifc ghi qua createIfcRecorder(): lưu bản GetLine cũ trước khi WriteLine/DeleteLine,
// sau đó chụp bản mới, để hoàn tác/làm lại chỉ cần ghi lại đúng bản tương ứng.
import { computed, shallowRef } from 'vue';
import { editHistoryCount, hasUnsavedChanges, rt } from '../state/state.js';
import { showToast } from '../ui/panels.js';
import { t } from '../i18n/index.js';

const MAX_HISTORY = 200;

export const undoStack = shallowRef([]);
export const redoStack = shallowRef([]);
export const canUndo = computed(() => undoStack.value.length > 0);
export const canRedo = computed(() => redoStack.value.length > 0);
export const undoLabel = computed(() => undoStack.value[undoStack.value.length - 1]?.label || '');
export const redoLabel = computed(() => redoStack.value[redoStack.value.length - 1]?.label || '');

// Độ sâu stack tại lần lưu gần nhất; null = bản đã lưu không còn quay lại được (đã rẽ nhánh hoặc bị cắt bớt)
let savedDepth = 0;

const syncDirtyState = () => {
    const depth = undoStack.value.length;
    editHistoryCount.value = savedDepth === null ? Math.max(1, depth) : Math.abs(depth - savedDepth);
    hasUnsavedChanges.value = editHistoryCount.value > 0;
};

export const pushHistory = (command) => {
    const stack = undoStack.value.slice();
    if (savedDepth !== null && stack.length < savedDepth) savedDepth = null;
    stack.push(command);
    if (stack.length > MAX_HISTORY) {
        stack.shift();
        if (savedDepth !== null) savedDepth = savedDepth > 0 ? savedDepth - 1 : null;
    }
    undoStack.value = stack;
    redoStack.value = [];
    syncDirtyState();
};

let isReplaying = false;

export const undo = () => {
    if (isReplaying || undoStack.value.length === 0) return;
    const command = undoStack.value[undoStack.value.length - 1];
    isReplaying = true;
    try {
        command.undo();
    } catch (error) {
        console.error('Lỗi hoàn tác:', error);
        showToast(t('Lỗi hoàn tác'), error.message || String(error));
        return;
    } finally {
        isReplaying = false;
    }
    undoStack.value = undoStack.value.slice(0, -1);
    redoStack.value = [...redoStack.value, command];
    syncDirtyState();
    showToast(t('Đã hoàn tác'), command.label, 'success');
};

export const redo = () => {
    if (isReplaying || redoStack.value.length === 0) return;
    const command = redoStack.value[redoStack.value.length - 1];
    isReplaying = true;
    try {
        command.redo();
    } catch (error) {
        console.error('Lỗi làm lại:', error);
        showToast(t('Lỗi làm lại'), error.message || String(error));
        return;
    } finally {
        isReplaying = false;
    }
    redoStack.value = redoStack.value.slice(0, -1);
    undoStack.value = [...undoStack.value, command];
    syncDirtyState();
    showToast(t('Đã làm lại'), command.label, 'success');
};

// Gỡ một lệnh khỏi giữa stack (hoàn tác lượt dịch chuyển từ danh sách lịch sử transport). Trả về true nếu tìm thấy.
export const removeHistoryCommand = (predicate) => {
    const index = undoStack.value.findIndex(predicate);
    if (index < 0) return false;
    if (savedDepth !== null && index < savedDepth) savedDepth = null;
    undoStack.value = undoStack.value.filter((_, i) => i !== index);
    redoStack.value = [];
    syncDirtyState();
    return true;
};

// Đã lưu file IFC: vị trí hiện tại là bản sạch
export const markHistorySaved = () => {
    savedDepth = undoStack.value.length;
    syncDirtyState();
};

// Mở file thay thế / đóng file: các lệnh cũ trỏ vào model không còn nữa.
// keepDirty: các file còn lại vẫn có thay đổi chưa lưu (đóng một file trong nhiều file) thì giữ nút lưu bật.
export const resetHistory = ({ keepDirty = false } = {}) => {
    const wasDirty = hasUnsavedChanges.value;
    undoStack.value = [];
    redoStack.value = [];
    savedDepth = keepDirty && wasDirty ? null : 0;
    syncDirtyState();
};

// --- GHI THAY ĐỔI WEB-IFC CÓ THỂ HOÀN TÁC ---
const lineKey = (modelID, expressID) => `${modelID}:${expressID}`;

// web-ifc chặn WriteLine vào expressID đã DeleteLine (chỉ là danh sách phía JS), nên bỏ id khỏi danh sách đó
// mỗi khi xóa để còn ghi lại được lúc hoàn tác / làm lại.
const forgetDeletedLine = (modelID, expressID) => rt.ifcAPI.deletedLines?.get(modelID)?.delete(expressID);

const writeSnapshot = (modelID, expressID, line) => {
    if (line) {
        forgetDeletedLine(modelID, expressID);
        // Ghi lại dòng đã xóa: WriteLine gọi GetLineType trên id không còn tồn tại và in lỗi vô hại, tạm tắt log
        rt.ifcAPI.SetLogLevel?.(6);
        try {
            rt.ifcAPI.WriteLine(modelID, line);
        } finally {
            rt.ifcAPI.SetLogLevel?.(4);
        }
    } else {
        rt.ifcAPI.DeleteLine(modelID, expressID);
        forgetDeletedLine(modelID, expressID);
    }
};

export const createIfcRecorder = () => {
    const entries = new Map(); // khóa -> { modelID, expressID, before, after, deleted }
    const touch = (modelID, expressID, isNew) => {
        const key = lineKey(modelID, expressID);
        if (entries.has(key)) return entries.get(key);
        const entry = { modelID, expressID, before: isNew ? null : rt.ifcAPI.GetLine(modelID, expressID, false), after: null, deleted: false };
        entries.set(key, entry);
        return entry;
    };
    return {
        write(modelID, line) {
            const isNew = !(line.expressID > 0);
            if (!isNew) touch(modelID, line.expressID, false).deleted = false;
            rt.ifcAPI.WriteLine(modelID, line);
            if (isNew) touch(modelID, line.expressID, true);
        },
        delete(modelID, expressID) {
            touch(modelID, expressID, false).deleted = true;
            rt.ifcAPI.DeleteLine(modelID, expressID);
            forgetDeletedLine(modelID, expressID);
        },
        get size() { return entries.size; },
        // Chụp trạng thái sau thay đổi; trả về { undo, redo } để ghi lại model
        finish() {
            const list = Array.from(entries.values());
            list.forEach(entry => {
                entry.after = entry.deleted ? null : rt.ifcAPI.GetLine(entry.modelID, entry.expressID, false);
            });
            return {
                undo: () => list.slice().reverse().forEach(entry => writeSnapshot(entry.modelID, entry.expressID, entry.before)),
                redo: () => list.forEach(entry => writeSnapshot(entry.modelID, entry.expressID, entry.after))
            };
        }
    };
};
