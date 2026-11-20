## 20.11.2026
- hệ trục: mọi tọa độ hiển thị/nhập theo hệ xây dựng X, Y, Z hướng lên (khớp View Cube), đơn vị mét, tọa độ dự án; scene three là Y-up (three = X, Z, -Y), quy đổi tập trung ở src/core/coords.js; sửa trục Y của gizmo View Cube, kích thước bao ở panel thuộc tính theo X, Y, Z-up
- đo đạc: tọa độ P1/P2 hiển thị theo tọa độ dự án; khi chọn điểm 2, rê lên mặt là hiện sẵn vùng tròn gợi ý tại chân vuông góc, rê lên cạnh là hiện ô vuông gợi ý điểm vuông góc (chưa bắt, phạm vi bắt vẫn 7px); mở file thay thế thì xóa các đo cũ; đo đi theo model khi model được căn giữa lại
- transport: áp riêng cho các file đang mở lúc bấm (file mở thêm sau giữ nguyên vị trí), xoay quanh Z qua tâm trước rồi mới dịch theo vector; ô nhập theo hệ IFC (cm, độ), mỗi ô có nhãn trục và đơn vị, xếp 3 dòng; dòng nhắc thứ tự ở đầu tab; mỗi lượt tính 1 thay đổi, bật nút lưu IFC; sửa lỗi lưu IFC sai trục (thép đứng dọc khi mở lại); nút dịch chuyển ghim ở đáy panel; profile mẫu "Allplan 👉🏻 S21"
- panel thuộc tính và panel thông tin dự án hiện tọa độ (tâm, min, max) theo hệ dự án; bỏ nút Lưu IFC trùng trong panel thông tin dự án
- giao diện: ô nhập số dùng component number-field (nút tăng/giảm cùng phong cách web); nút kiểu 3D (viền đáy đậm theo màu nút, chữ in hoa) qua src/ui/button-style.js; View Cube + trục chuyển sang góc trên trái view, trục nằm đúng cạnh khối
- chọn bằng khung kéo xét đỉnh/tam giác thật thay vì hộp bao (thép xiên không còn bị chọn nhầm hoặc bỏ sót)
- sửa giá trị thuộc tính Pset: chuột phải vào thuộc tính trong Property Sets > Sửa giá trị, áp cho các cấu kiện đang chọn; Pset/thuộc tính dùng chung với cấu kiện không chọn thì tách bản sao (pset + IfcRelDefinesByProperties mới) để cấu kiện khác giữ giá trị cũ; cập nhật Pos/đường kính suy ra từ Pset (nhóm, màu thép), bộ đếm lưu IFC; code ở src/ifc/pset-edit.js
- "Chỉ hiện tương tự" ẩn/hiện qua manuallyHiddenExpressIDs: bộ đếm Ẩn, hàng mờ trong nhóm đồng bộ
- tối ưu chọn nhiều cấu kiện: kiểm tra đã chọn bằng Set (selectedMeshSet), cấu kiện đang chọn vẽ bằng vài BatchedMesh (rebuildSelectionBatches) thay vì mỗi cấu kiện một overlay, viền chọn gộp thành 1 LineSegments, cạnh local được cache theo geometry

## 19.11.2026
- thêm file IFC (tab Gộp, kéo thả) trùng tên file đang mở: hiện hộp thoại hỏi có mở tiếp không
- panel phải hiển thị và sửa thông tin cấp dự án của file IFC vừa mở (header, project, site, building, storey, người/ứng dụng xuất IFC, địa chỉ), lưu vào IFC mới; code ở src/ifc/project-info.js (header ghi bằng hậu xử lý text khi xuất)
- đổi tên tab "Xuất" thành "Chia tách" (EN: Split) vì chức năng là xuất riêng phần đang hiển thị; mã tab vẫn là `export`
- tab Đo đạc (Dimension): phím D bật/tắt chế độ đo, click 2 điểm tạo đường đo + nhãn cm/m, quả cầu tự co theo zoom, hover hiện điểm pick, danh sách có nút xóa và zoom tới khoảng đo; code ở src/dimension/dimension.js (hàm pickDimensionPoint là chỗ cắm bắt điểm/line/bề mặt)
- đo đạc: đường nối + nhãn khoảng cách xem trước khi hover điểm 2; tự bắt điểm vào cạnh model trong 7px màn hình (quả cầu xanh đậm, cạnh được bắt tô vàng); ở điểm 2 ưu tiên bắt điểm vuông góc với cạnh (7px); nhãn độ mờ 80%
- viền mép: thêm đường giao giữa các cấu kiện (tính nền, src/scene/intersections.js), cũng dùng để bắt điểm khi đo
- thanh trạng thái đổi chữ + màu nút tròn theo chế độ (đo đạc, clash); panel giới thiệu thêm mục Đo đạc; cập nhật README.md và CLAUDE.md
- xoay view bằng chuột trái: nếu điểm click nằm trên mesh thì lấy điểm đó làm tâm xoay (bù tịnh tiến trong sự kiện change của OrbitControls, scene.js); header: bỏ nút Viền mép (vẫn còn trong tab Hiển thị), thêm nút [D]Measure
- đo đạc: bắt góc giao của 2 cạnh trở lên (cạnh xa hơn không giao thì ưu tiên cạnh gần con trỏ hơn); lấy cả cạnh của cấu kiện sát bên; ngoài không trung/đối tượng ẩn/vùng CropBox cắt thì cursor bàn tay, không bắt điểm; bắt vuông góc: dấu vuông ở góc phải trên con trỏ, nhóm đo vuông góc hiện 2 hình vuông thay quả cầu
- đo đạc: viền được bắt dày gấp đôi (LineSegments2) luôn trên cùng; bắt vuông góc tới bề mặt cấu kiện khác (7px): vùng tròn vàng trên mặt, dấu tam giác ở con trỏ, nhóm đo hiện 2 tam giác
- bắt vuông góc tới bề mặt cho phép cả mặt khác của chính cấu kiện (mặt đối diện của cột); lưu màu nền sáng/tối vào localStorage (độ mờ model đã lưu sẵn); sửa đường giao không hiện ở mô hình mẫu (thiếu BVH)
- đồng bộ ẩn/hiện nhóm giữa các tiêu chí phân nhóm và bộ đếm "Ẩn" ở thanh status
- đa ngôn ngữ VI/EN: nút [VI/EN] ở header (giữa nút Căn giữa và nút bảng quản lý) và ở panel giới thiệu; bản dịch nằm trong src/i18n/en.js, chuỗi tiếng Việt là khóa gốc
- Việt hóa các nhãn còn tiếng Anh (tab Display/Groups/..., Transport, Clash...)

## 18.11.2026
- check clash

## chưa làm
- Pset gắn qua kiểu cấu kiện (IfcTypeObject.HasPropertySets) chưa đọc/sửa được
- xoay cropbox
- restore all trong mục remove
- thêm tùy chọn để làm 1 tour hướng dẫn từng chức năng trong web