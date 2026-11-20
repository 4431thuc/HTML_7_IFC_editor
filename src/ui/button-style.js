// Style nút kiểu "3D": viền đáy dày màu đậm hơn chính nút, chữ in hoa giãn chữ, nhấn xuống khi bấm.
// Màu nút giữ nguyên theo Tailwind; JS chỉ đọc màu nền thật của nút để tính màu viền đáy (--btn-edge) và gắn
// data-btn3d cho các nút có nền đặc (nút trong suốt như tab, icon, menu không bị gắn). CSS nằm trong index.html.
const EDGE_FACTOR = 0.62;
// Nút thật và nhãn đóng vai nút (Mở IFC, Thêm IFC)
const TARGET_SELECTOR = 'button, label.cursor-pointer';
const EXCLUDE_SELECTOR = '.left-tabs, .num-field, .vc-wrap, .vc-cell, [class*="rounded-t"], [class*="active:scale"]';

const colorCanvas = document.createElement('canvas');
colorCanvas.width = colorCanvas.height = 1;
const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });

// Mọi định dạng màu CSS (rgb, oklch, color()...) -> [r, g, b, a] qua canvas
const parseColor = (value) => {
    if (!colorContext || !value) return null;
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = '#000';
    colorContext.fillStyle = value;
    colorContext.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
};

// Áp style cho một nút theo màu nền đã đọc (color = [r, g, b, a] hoặc null)
const applyStyle = (button, color) => {
    if (!color || color[3] < 0.15 || button.closest(EXCLUDE_SELECTOR)) {
        if (button.hasAttribute('data-btn3d')) button.removeAttribute('data-btn3d');
        return;
    }
    const edge = `rgb(${color.slice(0, 3).map(v => Math.round(v * EDGE_FACTOR)).join(', ')})`;
    if (button.style.getPropertyValue('--btn-edge') !== edge) button.style.setProperty('--btn-edge', edge);
    if (!button.hasAttribute('data-btn3d')) button.setAttribute('data-btn3d', '');
};

// Đọc màu nền ĐÍCH của nút: tắt transition tạm thời, nếu không getComputedStyle trả về màu đang chuyển dở
// (màu cũ) khiến viền đáy luôn chậm một bước so với màu nút.
const refresh = () => {
    const buttons = Array.from(document.querySelectorAll(TARGET_SELECTOR));
    buttons.forEach(button => { button.style.transition = 'none'; });
    const colors = buttons.map(button => parseColor(getComputedStyle(button).backgroundColor));
    buttons.forEach(button => { button.style.removeProperty('transition'); });
    buttons.forEach((button, index) => applyStyle(button, colors[index]));
};

export const initButtonStyle = () => {
    let timer = null;
    let frame = null;
    // Tính ngay ở khung hình kế tiếp, rồi tính lại sau một nhịp ngắn phòng khi Tailwind CDN chưa kịp sinh CSS cho class mới
    const schedule = () => {
        if (frame === null) frame = requestAnimationFrame(() => { frame = null; refresh(); });
        clearTimeout(timer);
        timer = setTimeout(refresh, 90);
    };
    // Chỉ theo dõi class/disabled và việc thêm bớt phần tử; data-btn3d và style không kích hoạt lại vòng lặp
    new MutationObserver(schedule).observe(document.getElementById('app') || document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled']
    });
    schedule();
};
