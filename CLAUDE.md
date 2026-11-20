# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dự án này là gì

Ứng dụng một trang, chạy hoàn toàn trên trình duyệt, để xem và chỉnh sửa mô hình thép (rebar) và BIM dạng IFC ("IFC 3D Rebar & BIM Editor"). Giao diện và comment trong code đều bằng tiếng Việt. Khi thêm chuỗi giao diện hoặc comment mới, hãy giữ đúng phong cách với phần code xung quanh. Luôn trao đổi với người dùng bằng tiếng Việt.

## Lệnh thường dùng

Dự án dùng **Vite** + npm (Node.js cài bản portable tại `C:\Users\Thuc.Hoang\tools\node\node-v26.13.1-win-x64`, đã thêm vào PATH người dùng; nếu một terminal chưa nhận `node`, hãy mở terminal mới hoặc thêm thư mục đó vào PATH của phiên).

- `npm install`: cài thư viện (thư mục `node_modules/` nằm trong `.gitignore`).
- `npm run dev`: chạy dev server (mặc định `http://localhost:5173`). **Không mở `index.html` trực tiếp bằng `file://`** vì module ES bị trình duyệt chặn.
- `npm run build`: build production vào `dist/` (cũng là cách nhanh để bắt lỗi import/export thiếu).
- Không có linter hay bộ test tự động. Kiểm tra thủ công trên trình duyệt: nạp model mẫu `32R-08290-BW31-P1-_.ifc` (thư mục gốc), thử chọn cấu kiện, CropBox, Clash, Đo đạc (phím D), Chia tách (tab `export`), và xem console có lỗi không. Có thể tự động hóa bằng `puppeteer-core` + Chrome cài sẵn (chạy `npx vite --port 5199`; sau khi sửa file nguồn phải khởi động lại vite vì module nạp lại có `?t=` thành bản sao khác; import module qua `import('/src/state/state.js')` trong `page.evaluate` để đọc state); không thêm vào dự án.
- Tailwind, icon Phosphor, font Inter và Google Analytics vẫn tải từ CDN trong `index.html`, nên cần internet khi chạy. WASM của web-ifc cũng tải từ jsDelivr (`ifcAPI.SetWasmPath` trong `src/scene/scene.js`).

## Kiến trúc

- `index.html`: chỉ còn `<head>` (CDN, khối `<style>` nhỏ) và **template HTML của Vue** gắn vào `#app`, kết thúc bằng `<script type="module" src="/src/main.js">`. Template nằm trực tiếp trong HTML nên Vite phải alias `vue` sang `vue.esm-bundler.js` (có trình biên dịch runtime), xem `vite.config.js`. Đừng đổi alias này.
- `src/main.js`: tạo `createApp({ setup() })`. `setup()` chỉ gồm `onMounted`, `onBeforeUnmount` và `return { ... }` (danh sách mọi thứ template dùng). Thêm state/hàm mới dùng trong template thì phải import vào đây **và** thêm vào `return`.
- `src/state/constants.js`: bảng màu, hằng số, hàm parse đường kính thép.
- `src/state/state.js`: toàn bộ state dùng chung (ref, reactive, Map, material, group Three.js). Các biến trước đây là `let` có thể gán lại nằm trong object **`rt`** (ví dụ `rt.scene`, `rt.camera`, `rt.ifcAPI`, `rt.needsRender`); luôn đọc/ghi qua `rt.xxx`, không tạo biến module để gán lại.
- Logic chia theo chủ đề, các module import trực tiếp lẫn nhau (có vòng import giữa các module hàm là bình thường vì chỉ dùng lúc gọi, không dùng lúc nạp module):
  - `src/core/helpers.js`: `requestRender`, khóa mesh (`createMeshKey`...).
  - `src/scene/`: `scene.js` (init web-ifc/Three.js, camera, ánh sáng, fit camera), `cropbox.js`, `display.js` (X-Ray, wireframe, edges...), `rendering.js` (batch và overlay vật liệu), `sample-model.js`.
  - `src/ifc/`: `loader.js` (nạp IFC, tạo mesh), `groups.js` (nhóm, hiển thị, remove/restore), `transport.js` (dịch/xoay model và profile), `export.js` (xuất, gộp IFC).
  - `src/clash/clash.js`: kiểm tra va chạm (three-bvh-csg).
  - `src/dimension/dimension.js`: đo đạc (phím D). `pickDimensionPoint` là nơi duy nhất quyết định điểm pick/bắt điểm (cạnh, góc giao, vuông góc cạnh, vuông góc bề mặt); hover và click đều dùng nó, thêm kiểu bắt điểm mới (đỉnh...) ở đây. Điểm đo lưu theo tọa độ world (mét), kích thước quả cầu/nhãn tính theo pixel (`worldUnitsPerPixel`). Viền được bắt dùng `LineSegments2` (line WebGL thường không đổi được độ dày).
  - `src/ifc/project-info.js`: thông tin cấp dự án (header, IfcProject/Site/Building/Storey, OwnerHistory, địa chỉ) hiển thị và sửa ở panel phải khi chưa chọn cấu kiện. Thực thể ghi lại bằng `GetLine` → sửa → `WriteLine`; **header ghi bằng hậu xử lý text** (`applyHeaderOverrides`, gọi trong `downloadIfcData`) vì web-ifc 0.0.66 không có SetHeaderLine. web-ifc nhân đôi/hỏng chuỗi có dấu nháy đơn và gạch chéo ngược qua các lần lưu - mở lại nên `sanitizeIfcText` thay các ký tự đó trước khi ghi. State: `projectInfos`, `projectInfoSourceId`, `projectHeaderOverrides` trong `state.js`.
  - `src/scene/intersections.js`: đường giao giữa các cấu kiện (bvhcast), tính nền theo lát 8ms, lưu trong `edgesGroup` với `userData.parentMesh/pairMesh`; dùng cho hiển thị viền và bắt điểm. Cấu kiện chưa có BVH (mô hình mẫu) được tạo qua `ensureBoundsTree`.
  - `src/selection/`: `selection.js` (chọn, outline, dimming), `input.js` (pointer, box select, phím).
  - `src/ui/`: `panels.js` (panel, toast, độ mờ), `properties.js` (thuộc tính, sửa attribute), `context-menu.js`.

### Các ý tưởng xuyên suốt

- **Định danh đối tượng**: mesh được khóa theo `sourceId:expressID` (`createMeshKey`). Nhiều file IFC có thể cùng được nạp, nên mọi thao tác tìm cấu kiện phải dùng khóa này, không chỉ dùng expressID.
- **Nguồn model (source)**: mỗi file đã nạp là một "source" với trạng thái hiển thị và xóa riêng. Các hàm xuất hoạt động theo từng source hoặc trên tập đã gộp.
- **Render theo yêu cầu**: render được kích hoạt bởi `requestRender()` (đặt `rt.needsRender`), không dùng vòng lặp liên tục. Code nào thay đổi hình ảnh đều phải gọi hàm này.
- **Chế độ và thanh trạng thái**: `statusIndicator` (computed trong `state.js`) quyết định chữ/màu nút tròn ở thanh trạng thái theo chế độ (nạp WASM, đo đạc, clash). Thêm chế độ mới thì thêm nhánh vào đó và thêm bản dịch EN.
- **Phím tắt**: nằm trong `handleKeyDown` (`input.js`), đã bỏ qua khi đang gõ trong input/textarea/select. Hiện có C (CropBox), X (X-Ray), D (đo đạc), Space, Delete, Esc (hủy điểm đo 1).
- **Lưu trữ**: thiết lập nhỏ theo người dùng (panel giới thiệu, độ mờ, màu nền sáng/tối, transport profile) dùng `localStorage`, bọc trong try/catch.
- **Thư viện**: phiên bản ghim trong `package.json` (Three.js 0.160, three-mesh-bvh 0.7.8, three-bvh-csg 0.0.17, web-ifc 0.0.66, Vue 3). Đổi phiên bản có thể đổi hành vi, nên test lại.

### Hệ trục tọa độ (RẤT QUAN TRỌNG)

- Mọi tọa độ hiển thị/nhập cho người dùng phải theo **hệ xây dựng/IFC của dự án: X phải, Y đi vào trong, Z hướng lên trời** (đúng hệ trục đang vẽ trên View Cube), đơn vị mét, và là tọa độ dự án (không phải tọa độ scene đã căn giữa/dời gốc).
- Scene Three.js là Y-up do web-ifc đổi trục: `three = (X, Z, -Y)` và `IFC = (x, -z, y)` (đã kiểm chứng bằng file IFC thử: đặt tại IFC (10,20,30) -> flatTransformation (10,30,-20)). Dùng `src/core/coords.js` (`ifcToThree`, `threeToIfc`, `worldToProjectCoords`), không tự hoán đổi trục ở nơi khác.
- Tọa độ dự án = world - modelOffset + modelRebaseOrigin (chuyển trục về IFC), đã gồm transport. `modelOffset` là phép căn giữa của `modelGroup`, `modelRebaseOrigin` là gốc dời lúc nạp để tránh mất độ chính xác float32.
- Ô nhập Transport (tâm xoay, vector dịch) nhập theo hệ IFC (cm), góc xoay quanh Z của IFC; kích thước bao ở panel thuộc tính cũng theo X, Y, Z-up. Tính năng mới có tọa độ/hướng phải tuân theo quy ước này.
- Transport (tab dịch chuyển) áp **riêng cho từng file IFC đang mở lúc bấm**, không áp cho cả view: ma trận mỗi file lưu trong `transport.js` (`getSourceTransportMatrix`), cấu kiện của file được dời trực tiếp trong scene rồi `rebuildBatches`; file mở thêm sau đó giữ nguyên. Khi xuất IFC, ma trận của từng file được ghi vào placement gốc. Mỗi lượt dịch chuyển tính 1 thay đổi (`editHistoryCount`) và bật nút lưu IFC.

## Ghi chú

- `version.md` là nhật ký thay đổi và danh sách việc cần làm của tác giả (tiếng Việt). Cập nhật khi hoàn thành tính năng.
- File IFC mẫu (~20 MB) đang được git theo dõi; hạn chế commit thêm file nhị phân lớn.
- Thư mục dự án nằm trong OneDrive: `node_modules/` có hàng nghìn file và sẽ bị đồng bộ. Cân nhắc loại trừ thư mục này khỏi OneDrive.
- `.gitattributes` đặt `* text=auto` (chuẩn hóa LF). Lịch sử git dùng commit message ngắn, không theo quy chuẩn chặt chẽ.
