import { defineConfig } from 'vite';

export default defineConfig({
    // Đường dẫn tương đối để chạy được trên GitHub Pages (site nằm trong thư mục con /HTML_7_IFC_editor/)
    base: './',
    define: {
        __VUE_OPTIONS_API__: true,
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
    },
    resolve: {
        alias: {
            // Template Vue nằm trực tiếp trong index.html nên cần bản có trình biên dịch runtime
            vue: 'vue/dist/vue.esm-bundler.js'
        }
    },
    // web-ifc nạp WASM riêng, không để Vite tiền xử lý
    optimizeDeps: {
        exclude: ['web-ifc']
    }
});
