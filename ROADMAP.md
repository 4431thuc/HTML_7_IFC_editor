# Lộ trình nâng cấp (ghi chú 21.11.2026)

Danh sách việc cần làm rút ra từ buổi rà soát code. Đánh dấu `[x]` khi xong và ghi vào `version.md`.

## Lộ trình đề xuất
1. Undo/Redo + Bar schedule (dùng được ngay)
2. Web Worker cho web-ifc + dùng chung hình học trùng (hiệu năng file lớn)
3. Tách Vue SFC + Tailwind build (dễ bảo trì, chạy offline)
4. Diff phiên bản, kiểm tra lớp bảo vệ/IDS, BCF (công cụ QA/QC)

---

## 1. Chức năng quản lý, chỉnh sửa IFC

### Ưu tiên cao (đặc thù BIM bê tông cốt thép)
- [ ] **Undo/Redo**: nâng `editHistoryCount` thành stack lệnh (command pattern), mỗi thao tác Pset/attribute/transport/remove lưu `{do, undo}`. Với web-ifc: lưu bản `GetLine` cũ trước khi `WriteLine`. Phím `Ctrl+Z` / `Ctrl+Y`.
- [ ] **Bảng thống kê thép (Bar schedule)**: gom theo Pos, Ø, số lượng, chiều dài, khối lượng (kg); xuất CSV/Excel. Dữ liệu có sẵn trong `psetCache`.
- [ ] **Kiểm tra lỗi thép** (mở rộng `checkIfFaultyRebar`):
  - [ ] Cùng Pos nhưng khác Ø / hình dạng / chiều dài
  - [ ] Thanh trùng (2 thanh chồng khít nhau)
  - [ ] Lớp bê tông bảo vệ: khoảng cách thép tới mặt cấu kiện (dùng BVH sẵn có)
  - [ ] Khoảng hở tối thiểu giữa các thanh
- [ ] **So sánh 2 phiên bản IFC**: diff theo `GlobalId` (thêm/xóa/đổi hình học/đổi Pset), tô màu xanh/đỏ/vàng.
- [ ] **Pset theo kiểu** (`IfcTypeObject.HasPropertySets`): đọc và sửa.

### Ưu tiên trung bình
- [ ] **Cây cấu trúc không gian** Project > Site > Building > Storey > cấu kiện (`IfcRelContainedInSpatialStructure`, `IfcRelAggregates`).
- [ ] **Bộ lọc/tìm kiếm nâng cao**: điều kiện kiểu `Pset.X = ... AND Ø >= 16`, lưu bộ lọc.
- [ ] **Tô màu theo thuộc tính bất kỳ** (color by property) kèm chú thích màu.
- [ ] **Mặt cắt (section plane)** tùy ý theo trục, xem 2D trực giao, đo trên mặt cắt.
- [ ] **Saved views / viewpoint**: lưu camera + ẩn/hiện + CropBox.
- [ ] **BCF**: issue có ảnh chụp + viewpoint, trao đổi với Revit/Allplan/Solibri.
- [ ] **Kiểm tra theo IDS**: khai báo Pset bắt buộc, báo cấu kiện thiếu.
- [ ] **Clash nâng cao**: ma trận luật nhóm A với nhóm B, dung sai, bỏ qua thép nằm trong chính cấu kiện chứa nó, trạng thái clash (mới/đã xử lý).
- [ ] **Khối lượng bê tông** theo cấu kiện/tầng (thể tích mesh hoặc `IfcElementQuantity`).

### Nhỏ nhưng đáng làm
- [ ] Phân loại cấu kiện ở `src/ifc/loader.js` (đoạn `combined.includes('BAR')`...) đang dò chuỗi, dễ nhận nhầm ("BARRIER" thành thép, "PADDING" thành móng). Ưu tiên loại IFC thật, chỉ dò chuỗi khi là `IfcBuildingElementProxy`.
- [ ] Restore all trong mục remove
- [ ] Xoay CropBox
- [ ] Tour hướng dẫn từng chức năng

---

## 2. Giao diện và layout
- [ ] **Header**: gom nhóm theo ngữ cảnh (File | Xem | Công cụ | Ngôn ngữ); cân nhắc thanh công cụ dọc ở cạnh trái view (Đo, Cắt, CropBox, Chọn) kiểu Allplan/Revit.
- [ ] **Panel trái**: tách "Dữ liệu" (Files, Nhóm, Cây không gian) khỏi "Công cụ" (Transport, Clash, Chia tách).
- [ ] **Panel thuộc tính**: ô tìm thuộc tính, ghim thuộc tính hay dùng, copy giá trị; chọn nhiều cấu kiện thì hiện "giá trị chung / *nhiều giá trị*".
- [ ] **Bảng dữ liệu dock ở đáy** (thu gọn được) cho bar schedule, kết quả clash, kết quả kiểm tra; click dòng thì zoom tới cấu kiện.
- [ ] **Phím tắt mới**: `H` ẩn, `I` cô lập, `Shift+H` hiện tất cả, `F` zoom tới vùng chọn, `Ctrl+Z/Y`, `?` mở bảng phím tắt.
- [ ] **Tiến trình**: thanh % và nút Hủy khi nạp file lớn hoặc chạy clash.

---

## 3. Cấu trúc và hiệu năng

### Hiệu năng
- [ ] **web-ifc chạy trong Web Worker**: `OpenModel`, `StreamAllMeshes`, `SaveModel` hiện chạy trên luồng chính nên UI bị đứng. Truyền `Float32Array/Uint32Array` qua transferable.
- [ ] **Bỏ hình học nhân đôi**: mỗi cấu kiện vừa là `THREE.Mesh` vừa được copy vào `BatchedMesh`, nên RAM gần gấp đôi. Chỉ giữ dữ liệu tối thiểu (bounds, BVH) ngoài batch.
- [ ] **Dùng chung hình học trùng**: thép cùng Pos cùng hình dạng, gom theo `geometryExpressID`, dùng `InstancedMesh` hoặc `BatchedMesh` nhiều instance (three r166+).
- [ ] **`rebuildBatches()` dựng lại toàn bộ**: đổi sang dựng lại theo source; transport chỉ cần `setMatrixAt`.
- [ ] **Lưu IFC** (`src/ifc/export.js`): đang `SaveModel`, rồi `OpenModel` bản tạm, rồi `SaveModel` lần nữa, tốn gấp 2–3 lần thời gian và RAM. Xem cách ghi thẳng vào model gốc, hoặc làm trong worker.
- [ ] **IndexedDB**: cache file đã mở (F5 không phải chọn lại), lưu phiên (đo, viewpoint, bộ lọc).

### Cấu trúc code
- [ ] **Tách `index.html` (~1570 dòng template) thành Vue SFC** (`.vue` + `@vitejs/plugin-vue`): `LeftPanel`, `PropertiesPanel`, `TransportTab`, `ClashTab`... Khi đó bỏ được alias `vue.esm-bundler` (nhẹ hơn), và `main.js` không phải `return` hàng trăm thứ.
- [ ] **Tailwind build qua Vite** thay CDN; tự host WASM web-ifc + font + icon để **chạy offline**.
- [ ] **Tách `state.js`** theo miền (selection, sources, dimension, clash), hạn chế vòng import.
- [ ] **Test tự động tối thiểu**:
  - [ ] Vitest cho `coords.js`, `sanitizeIfcText`, parse đường kính, tách Pset dùng chung
  - [ ] Playwright: nạp file mẫu > chọn > xuất > mở lại > kiểm tra tọa độ
- [ ] **Ghim phiên bản chính xác** trong `package.json` (hiện để `^`).
- [ ] **Cân nhắc nâng web-ifc** (0.0.66 khá cũ; bản mới có API ghi header, sửa lỗi chuỗi có dấu nháy). Test lại kỹ sau khi nâng.
