// Xóa cấu kiện khỏi text IFC (STEP) KÈM toàn bộ dữ liệu chỉ thuộc về chúng.
//
// Trước đây khi xuất chỉ DeleteLine đúng dòng cấu kiện và gỡ khỏi các quan hệ, nên hình học (IfcShapeRepresentation,
// IfcProductDefinitionShape, solid, điểm, mặt...), placement, Pset, vật liệu, kiểu... của cấu kiện đã xóa vẫn nằm lại
// trong file thành thực thể mồ côi: xuất 15 / 15.000 cấu kiện mà file gần như không nhỏ đi.
//
// Cách làm (thu gom rác theo tham chiếu):
//  1. Xóa cấu kiện. Thực thể nào tham chiếu tới thực thể đã xóa: nếu tham chiếu nằm trong danh sách thì bỏ khỏi danh sách,
//     danh sách rỗng hoặc tham chiếu đơn (RelatingObject...) thì xóa luôn thực thể đó (quan hệ), lan dần.
//  2. "Ứng viên" = mọi thứ thực thể đã xóa trỏ tới (bao đóng). Ứng viên được giữ nếu phần còn lại của file vẫn dùng
//     (ví dụ placement của tầng, OwnerHistory, Pset dùng chung), còn không thì xóa.
//  3. Thực thể "trỏ ngược" (không ai tham chiếu, không có GlobalId: IfcStyledItem, IfcPresentationLayerAssignment,
//     IfcMaterialProperties...) không giữ ứng viên lại; nếu chúng trỏ vào thứ đã xóa thì sửa / xóa theo bước 1.
// Chỉ xóa những gì truy được từ cấu kiện bị xóa, phần còn lại của file giữ nguyên từng ký tự.

const isDigit = (code) => code >= 48 && code <= 57;
const isNameChar = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || isDigit(code) || code === 95;
const QUOTE = 39; // '
const HASH = 35; // #

// --- ĐỌC TEXT STEP THÀNH DANH SÁCH THỰC THỂ + THAM CHIẾU (mảng phẳng để chịu được hàng triệu thực thể) ---
const parseEntities = (text, bodyStart, bodyEnd) => {
    const starts = [];
    const ends = [];
    const ids = [];
    const argStarts = [];
    const refOffsets = [0];
    const refs = [];
    let maxId = 0;
    let i = bodyStart;
    while (i < bodyEnd) {
        const code = text.charCodeAt(i);
        if (code === HASH) {
            const start = i;
            i++;
            let id = 0;
            while (isDigit(text.charCodeAt(i))) id = id * 10 + (text.charCodeAt(i++) - 48);
            // bỏ qua "= TÊN" tới dấu mở ngoặc của tham số
            while (i < bodyEnd && text.charCodeAt(i) !== 40) i++;
            const argStart = i;
            // quét tới ';' ngoài chuỗi, gom các #tham chiếu
            while (i < bodyEnd) {
                const c = text.charCodeAt(i);
                if (c === QUOTE) {
                    i++;
                    while (i < bodyEnd) {
                        if (text.charCodeAt(i) === QUOTE) {
                            if (text.charCodeAt(i + 1) === QUOTE) { i += 2; continue; }
                            break;
                        }
                        i++;
                    }
                    i++;
                    continue;
                }
                if (c === HASH) {
                    i++;
                    let ref = 0;
                    while (isDigit(text.charCodeAt(i))) ref = ref * 10 + (text.charCodeAt(i++) - 48);
                    refs.push(ref);
                    continue;
                }
                if (c === 59) { i++; break; } // ;
                i++;
            }
            starts.push(start);
            ends.push(i);
            ids.push(id);
            argStarts.push(argStart);
            refOffsets.push(refs.length);
            if (id > maxId) maxId = id;
            continue;
        }
        if (code === 47 && text.charCodeAt(i + 1) === 42) { // /* chú thích */
            const close = text.indexOf('*/', i + 2);
            i = close < 0 ? bodyEnd : close + 2;
            continue;
        }
        i++;
    }
    return { starts, ends, ids, argStarts, refOffsets, refs: Int32Array.from(refs), maxId };
};

// Tham số đầu tiên là GlobalId ('22 ký tự') -> thực thể IfcRoot
const hasGlobalId = (text, argStart) => {
    let i = argStart + 1;
    while (text.charCodeAt(i) === 32) i++;
    if (text.charCodeAt(i) !== QUOTE || text.charCodeAt(i + 23) !== QUOTE) return false;
    for (let k = i + 1; k <= i + 22; k++) {
        const c = text.charCodeAt(k);
        if (!isNameChar(c) && c !== 36) return false;
    }
    return true;
};

// --- SỬA THAM SỐ CỦA MỘT THỰC THỂ: bỏ tham chiếu tới thực thể đã xóa ---
// Trả về text mới, hoặc null nếu phải xóa cả thực thể (tham chiếu đơn bị xóa hoặc danh sách bị rỗng)
const rewriteEntity = (entityText, argOffset, removed) => {
    let i = argOffset;
    let mustRemove = false;
    const skipSpaces = () => { while (entityText.charCodeAt(i) === 32 || entityText.charCodeAt(i) === 10 || entityText.charCodeAt(i) === 13) i++; };
    const parseValue = () => {
        skipSpaces();
        const c = entityText.charCodeAt(i);
        if (c === 40) return { list: parseList() };
        if (c === QUOTE) {
            const start = i++;
            while (i < entityText.length) {
                if (entityText.charCodeAt(i) === QUOTE) {
                    if (entityText.charCodeAt(i + 1) === QUOTE) { i += 2; continue; }
                    break;
                }
                i++;
            }
            i++;
            return { raw: entityText.slice(start, i) };
        }
        if (c === HASH) {
            const start = i++;
            let ref = 0;
            while (isDigit(entityText.charCodeAt(i))) ref = ref * 10 + (entityText.charCodeAt(i++) - 48);
            return { ref, raw: entityText.slice(start, i) };
        }
        if (isNameChar(c) && !isDigit(c)) {
            const start = i;
            while (isNameChar(entityText.charCodeAt(i))) i++;
            const name = entityText.slice(start, i);
            skipSpaces();
            if (entityText.charCodeAt(i) === 40) return { prefix: name, list: parseList() };
            return { raw: name };
        }
        const start = i;
        while (i < entityText.length) {
            const d = entityText.charCodeAt(i);
            if (d === 44 || d === 41) break; // , )
            i++;
        }
        return { raw: entityText.slice(start, i).trim() };
    };
    const parseList = () => {
        i++; // (
        const items = [];
        skipSpaces();
        if (entityText.charCodeAt(i) === 41) { i++; return items; }
        while (i < entityText.length) {
            items.push(parseValue());
            skipSpaces();
            const c = entityText.charCodeAt(i++);
            if (c === 41) break;
        }
        return items;
    };
    const filter = (items, depth) => items.filter(item => {
        if (item.ref !== undefined && removed.has(item.ref)) {
            if (depth === 1) mustRemove = true;
            return false;
        }
        if (item.list && !item.prefix) {
            const before = item.list.length;
            item.list = filter(item.list, depth + 1);
            if (before > 0 && item.list.length === 0) mustRemove = true;
        }
        return true;
    });
    const serialize = (item) => (item.list ? `${item.prefix || ''}(${item.list.map(serialize).join(',')})` : item.raw);

    const args = parseList();
    const filtered = filter(args, 1);
    if (mustRemove) return null;
    return `${entityText.slice(0, argOffset)}(${filtered.map(serialize).join(',')});`;
};

export const pruneIfcText = (text, deletedIds) => {
    if (!deletedIds || deletedIds.size === 0) return { text, removedCount: 0 };
    const dataMarker = /(?:^|\n)\s*DATA\s*;/i.exec(text);
    const endMarker = /ENDSEC\s*;\s*END-ISO-10303-21\s*;\s*$/i.exec(text.trimEnd());
    if (!dataMarker || !endMarker) return { text, removedCount: 0 };
    const bodyStart = dataMarker.index + dataMarker[0].length;
    const bodyEnd = endMarker.index;
    const parsed = parseEntities(text, bodyStart, bodyEnd);
    const { starts, ends, ids, argStarts, refOffsets, refs, maxId } = parsed;
    const count = ids.length;

    const indexOf = new Int32Array(maxId + 1).fill(-1);
    for (let e = 0; e < count; e++) indexOf[ids[e]] = e;

    // Tham chiếu ngược (CSR)
    const incomingCount = new Int32Array(count);
    for (let r = 0; r < refs.length; r++) {
        const target = refs[r] <= maxId ? indexOf[refs[r]] : -1;
        if (target >= 0) incomingCount[target]++;
    }
    const inOffsets = new Int32Array(count + 1);
    for (let e = 0; e < count; e++) inOffsets[e + 1] = inOffsets[e] + incomingCount[e];
    const inRefs = new Int32Array(inOffsets[count]);
    const fill = inOffsets.slice(0, count);
    for (let e = 0; e < count; e++) {
        for (let r = refOffsets[e]; r < refOffsets[e + 1]; r++) {
            const target = refs[r] <= maxId ? indexOf[refs[r]] : -1;
            if (target >= 0) inRefs[fill[target]++] = e;
        }
    }

    // 0 = giữ, 1 = đã xóa, 2 = ứng viên (chưa quyết định)
    const state = new Uint8Array(count);
    const rewritten = new Map(); // chỉ số thực thể -> text mới
    const removedIds = new Set();
    const markRemoved = (e) => { state[e] = 1; removedIds.add(ids[e]); rewritten.delete(e); };

    // Sửa các thực thể đang trỏ tới thực thể vừa xóa (lan dần khi quan hệ bị xóa theo)
    const fixReferrers = (queue) => {
        while (queue.length > 0) {
            const e = queue.pop();
            for (let k = inOffsets[e]; k < inOffsets[e + 1]; k++) {
                const referrer = inRefs[k];
                if (state[referrer] === 1) continue;
                const current = rewritten.get(referrer) ?? text.slice(starts[referrer], ends[referrer]);
                const argOffset = rewritten.has(referrer) ? current.indexOf('(') : argStarts[referrer] - starts[referrer];
                const next = rewriteEntity(current, argOffset, removedIds);
                if (next === null) {
                    markRemoved(referrer);
                    queue.push(referrer);
                } else {
                    rewritten.set(referrer, next);
                }
            }
        }
    };

    // 1. Xóa cấu kiện + sửa / xóa quan hệ
    const firstQueue = [];
    deletedIds.forEach(id => {
        const e = id <= maxId ? indexOf[id] : -1;
        if (e >= 0 && state[e] !== 1) { markRemoved(e); firstQueue.push(e); }
    });
    if (firstQueue.length === 0) return { text, removedCount: 0 };
    fixReferrers(firstQueue);
    const removedByStep1 = [];
    for (let e = 0; e < count; e++) if (state[e] === 1) removedByStep1.push(e);

    // 2. Ứng viên: bao đóng các thứ thực thể đã xóa trỏ tới
    const stack = [];
    const pushTargets = (e) => {
        for (let r = refOffsets[e]; r < refOffsets[e + 1]; r++) {
            const target = refs[r] <= maxId ? indexOf[refs[r]] : -1;
            if (target >= 0 && state[target] === 0) { state[target] = 2; stack.push(target); }
        }
    };
    removedByStep1.forEach(pushTargets);
    while (stack.length > 0) pushTargets(stack.pop());

    // 3. Giữ ứng viên còn được phần còn lại của file dùng (thực thể trỏ ngược không tính)
    const isReverse = (e) => incomingCount[e] === 0 && !hasGlobalId(text, argStarts[e]);
    const keepStack = [];
    const keepTargets = (e) => {
        for (let r = refOffsets[e]; r < refOffsets[e + 1]; r++) {
            const target = refs[r] <= maxId ? indexOf[refs[r]] : -1;
            if (target >= 0 && state[target] === 2) { state[target] = 0; keepStack.push(target); }
        }
    };
    for (let e = 0; e < count; e++) {
        if (state[e] === 0 && !isReverse(e)) keepTargets(e);
    }
    while (keepStack.length > 0) keepTargets(keepStack.pop());

    // 4. Ứng viên không ai dùng: xóa; sửa thực thể trỏ ngược tới chúng (styled item, layer...)
    const secondQueue = [];
    for (let e = 0; e < count; e++) {
        if (state[e] === 2) { markRemoved(e); secondQueue.push(e); }
    }
    fixReferrers(secondQueue);

    // Ghép text: giữ nguyên phần đầu/cuối và mọi thực thể không đổi
    const parts = [text.slice(0, bodyStart), '\n'];
    let removedCount = 0;
    for (let e = 0; e < count; e++) {
        if (state[e] === 1) { removedCount++; continue; }
        parts.push(rewritten.get(e) ?? text.slice(starts[e], ends[e]), '\n');
    }
    parts.push(text.slice(bodyEnd));
    return { text: parts.join(''), removedCount };
};
