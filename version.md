## 25.11.2026
- liên kết thép (coupler / muffe, đầu ren, TTP, MBT...; nhánh git `coupler-process`): nhận diện thuần hình học trong src/ifc/rebar-connections.js vì IFC Allplan không có quan hệ nào nối liên kết với thanh: liên kết = cấu kiện không phải thép mà mọi mesh là lăng trụ tròn nhỏ (trục lấy theo pháp tuyến mặt đáy, không theo cạnh dài nhất: đĩa ren dày 1-2 mm nhưng Ø16-30 mm); thép chủ = thanh đồng trục đi qua lòng liên kết (hoặc chạm mặt đầu coupler, cắm 0 mm) và kéo dài ra ngoài, lệch trục ≤ 0,4 Ø; chỗ thép chồng (Ø14 vẽ đè Ø20) giữ thanh đồng trục nhất. File mẫu 32R-08290: 1705 đầu ren (1 thép chủ), 1562 coupler nối 2 thanh, 132 coupler chờ (1 thanh), 0 liên kết không có thép chủ
- liên kết bị xuất trùng (Allplan xuất mỗi coupler / đầu ren 2 lần, khác GlobalId, trùng khít): khi nạp chỉ giữ một bản (expressID nhỏ nhất), bản sao không đưa vào scene nên view, nhóm, danh sách, Chia tách, clash, bộ đếm, bảng loại IFC chỉ còn một (file mẫu: 3399 bản sao, 7299 → 3900 cấu kiện); xóa / ẩn rồi xuất IFC thì bản sao bị bỏ theo bản giữ lại, còn lại file giữ nguyên; sửa Pset / attribute chỉ ghi vào bản giữ lại
- clash: bỏ qua cặp liên kết ↔ thép chủ của nó và hai liên kết cùng thép chủ (ren trong coupler); vẫn báo thép chủ ↔ liên kết của thanh khác, thép ↔ thép, liên kết ↔ liên kết khác mối nối; thép trùng lặp (giao ≥ 90% thể tích cả 2 thanh, hoặc nhóm thanh phủ nhau ≥ 90%, xét cả 2 thanh trong cùng một cấu kiện IFC) xếp đầu danh sách, ghi "Trùng lặp x%" ở danh sách và trên nhãn va chạm (viền cam); panel clash ghi số liên kết nhận diện, số cặp đã bỏ qua, số cặp trùng lặp
- clash: nhãn va chạm và danh sách ghi liên kết thép theo thép chủ: Pos + Ø của thép chủ rồi mã liên kết (ArticleNumber / Bezeichnung trong Pset), vd Pos 1010-Ø14-TTS14; coupler nối 2 thanh khác Pos ghi Pos 1010/1012-Ø14-TTS14
- clash: đóng nắp hai đầu ống thép trước khi tính CSG (web-ifc dựng IfcSweptDiskSolid thành ống hở nên thể tích giao có thể lớn hơn cả thanh)
- hoàn tác / làm lại (Ctrl+Z, Ctrl+Y hoặc Ctrl+Shift+Z, nút ↶ ↷ cạnh nút Lưu file IFC): stack lệnh trong src/core/history.js cho sửa attribute, sửa giá trị Pset (cả trường hợp tách bản sao pset/quan hệ), lượt transport, áp dụng thông tin dự án, đánh dấu xóa / khôi phục; ghi web-ifc qua createIfcRecorder (lưu bản GetLine cũ trước WriteLine/DeleteLine); bộ đếm trên nút Lưu là số thao tác khác bản đã lưu (mỗi thao tác tính 1, không còn tính theo số cấu kiện), hoàn tác về bản đã lưu thì nút tắt; mở file thay thế / đóng file thì xóa lịch sử
- tab Thống kê (bar schedule, src/ifc/bar-schedule.js): gom thép theo Pos + Ø, số lượng, chiều dài 1 thanh (BarLength IFC hoặc tính từ thể tích/diện tích mesh, ≈), tổng chiều dài, khối lượng kg, tổng theo đường kính; tùy chọn chỉ thép đang hiện, tách theo file; click hàng chọn + zoom, Ctrl+click thêm vào vùng chọn; xuất CSV và Excel (.xls XML 2 sheet)
- phím C không còn bật CropBox khi bấm Ctrl+C
- tạm ẩn tab Thống kê vì kết quả chưa chính xác (cờ SHOW_BAR_SCHEDULE_TAB trong src/state/constants.js), code vẫn giữ
- clash đỡ lag: đường bao xám của mô hình gộp thành 1 LineSegments (trước là 1 cho mỗi cấu kiện), các khối clash gộp thành 1 mesh + 1 viền, có frustum culling; khối đang chọn tô vàng/đỏ bằng mesh riêng vẽ đè; cạnh đường bao cache theo geometry nên lần kiểm tra sau dựng nhanh hơn
- view va chạm: click chỉ chọn khối va chạm (trượt 6px quanh khối mảnh vẫn bắt), hiện vàng + nhãn + đối tượng A/B và cuộn danh sách tới đúng cặp, không đổi camera; click nền/cấu kiện thì bỏ chọn; không còn chọn nhầm cấu kiện đang mờ/ẩn; vào view va chạm thì bỏ vùng chọn cấu kiện
- tab Nhóm: chuột phải tiêu đề tab (Pos Thép / Name / ObjType / IFC Type) > Áp dụng màu của tab: tô model theo màu chấm tròn của các nhóm (src/ifc/color-scheme.js), tab đang áp có icon bảng màu; Khôi phục màu mặc định để về màu theo loại IFC / đường kính; nạp thêm file hoặc sửa Name/Pos thì tự tô lại; mở file thay thế thì về màu mặc định; chỉ đổi màu hiển thị, không ghi vào IFC
- viền cấu kiện: hạ ngưỡng góc mặc định từ 24° xuống 8° (MODEL_EDGE_ANGLE_DEG trong src/state/constants.js) để thấy nếp đổi dốc của sàn/mái; cấu kiện > 4000 đỉnh và thép vẫn không vẽ viền
- tab Hiển thị: 2 thanh kéo 1°–45° "Viền nếp gấp: góc tối thiểu" (tạo lại viền riêng của cấu kiện, giữ đường giao) và "Bắt cạnh khi đo: góc tối thiểu" (xóa cache cạnh bắt điểm); áp dụng khi thả chuột, lưu localStorage
- view va chạm: nhãn cố định cỡ theo pixel (giống nhãn đo kích thước), ghi số va chạm, thể tích giao (cm³/dm³) và 2 đối tượng A/B: thép ghi Pos + Ø, loại khác ghi tên loại + Tag/Name; danh sách va chạm ghi cùng thông tin, có ô màu A/B
- view va chạm: mô hình nền và cấu kiện có va chạm vẽ kiểu một lớp (ghi độ sâu trước rồi chỉ tô bề mặt gần nhất, scene.js renderClashView) nên lồng thép dày không còn cộng dồn độ mờ thành mảng đặc; bỏ viền đậm của cấu kiện có va chạm; khối va chạm, A/B, chấm vẽ đè lên lớp mờ nên luôn thấy
- view va chạm dễ nhìn hơn: khối giao màu đỏ có ánh sáng, cặp đang chọn vàng (nhấp nháy trắng/vàng), đối tượng A xanh dương / B tím, tự hiện A/B khi chọn; mô hình nền là khối xám mờ (dùng lại batch), bê tông có viền rất nhạt, thép không vẽ viền; cấu kiện có va chạm đậm hơn + viền rõ; tùy chọn "Ẩn thép không có va chạm"; chú thích màu đầy đủ
- xuất IFC (Chia tách, Lưu file có danh sách xóa): xóa cấu kiện kèm toàn bộ dữ liệu chỉ thuộc về chúng (hình học, placement, Pset, kiểu, vật liệu, opening; styled item và layer trỏ tới hình học đã xóa) bằng thu gom theo tham chiếu trên text IFC (src/ifc/ifc-prune.js); trước đây chỉ xóa dòng cấu kiện nên phần còn lại thành rác mồ côi, file chia tách gần như không nhỏ đi (thử: 57 MB / 60.000 tường giữ 15 tường -> 14 KB, ~1,1 s)
- rê chuột/zoom đỡ lag (nhất là view clash): không dò hover khi đang giữ nút chuột (pan chuột phải/giữa) và trong 250ms sau khi lăn zoom; hover dò tối đa 1 lần mỗi khung hình; tâm xoay và hover chỉ lấy giao điểm đầu tiên mỗi cấu kiện (firstHitOnly của three-mesh-bvh, trừ khi bật CropBox)
- clash: thêm nút "Tắt view va chạm" / "Hiện view va chạm" về view bình thường mà vẫn giữ kết quả (bấm một cặp trong danh sách cũng bật lại view); nút "Hủy kết quả" hỏi xác nhận có/không trước khi xóa; dịch chuyển hoặc đóng file thì kết quả clash bị xóa (kể cả khi đang tắt view)

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