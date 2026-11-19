import { ref } from 'vue';
import { EN } from './en.js';

// Bộ ngôn ngữ gốc là tiếng Việt: chuỗi tiếng Việt chính là khóa tra cứu.
// Ngôn ngữ khác (tiếng Anh) nằm trong en.js; thiếu bản dịch thì tự dùng lại chuỗi tiếng Việt.
export const LANGUAGES = ['vi', 'en'];
const DICTIONARIES = { vi: null, en: EN };
const langStorageKey = 'ifcEditorLanguage';

const readStoredLanguage = () => {
    try {
        const stored = localStorage.getItem(langStorageKey);
        if (LANGUAGES.includes(stored)) return stored;
    } catch (error) {
        console.warn('Không thể đọc ngôn ngữ đã lưu:', error);
    }
    return 'vi';
};

export const lang = ref(readStoredLanguage());
document.documentElement.lang = lang.value;

// t('Chuỗi tiếng Việt {0}', [giáTrị]): {0}, {1}... được thay bằng phần tử tương ứng của params
export const t = (key, params) => {
    const dictionary = DICTIONARIES[lang.value];
    let text = dictionary?.[key] ?? key;
    if (params) text = text.replace(/\{(\d+)\}/g, (match, index) => params[index] ?? match);
    return text;
};

export const setLanguage = (value) => {
    if (!LANGUAGES.includes(value)) return;
    lang.value = value;
    document.documentElement.lang = value;
    try { localStorage.setItem(langStorageKey, value); }
    catch (error) { console.warn('Không thể lưu ngôn ngữ:', error); }
};

export const toggleLanguage = () => setLanguage(lang.value === 'vi' ? 'en' : 'vi');
