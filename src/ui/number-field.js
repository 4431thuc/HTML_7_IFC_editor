// Ô nhập số dùng chung: thay nút tăng/giảm gốc của trình duyệt bằng nút cùng phong cách giao diện,
// kèm nhãn đơn vị (hậu tố) và nhãn đầu (tiền tố) luôn hiển thị để hướng dẫn đơn vị nhập.
// Dùng: <number-field v-model="x" unit="cm" prefix="X" :step="1" :aria-label="..."></number-field>
const roundStep = (value) => Math.round(value * 1e10) / 1e10;

export const NumberField = {
    name: 'NumberField',
    props: {
        modelValue: { type: [Number, String], default: '' },
        step: { type: Number, default: 1 },
        min: { type: Number, default: undefined },
        max: { type: Number, default: undefined },
        unit: { type: String, default: '' },
        prefix: { type: String, default: '' },
        ariaLabel: { type: String, default: '' },
        size: { type: String, default: 'sm' }
    },
    emits: ['update:modelValue'],
    methods: {
        onInput(event) {
            const raw = event.target.value;
            if (raw === '') {
                this.$emit('update:modelValue', '');
                return;
            }
            const value = Number(raw);
            if (Number.isFinite(value)) this.$emit('update:modelValue', value);
        },
        nudge(direction) {
            const current = Number(this.modelValue);
            let next = roundStep((Number.isFinite(current) ? current : 0) + direction * this.step);
            if (this.min !== undefined) next = Math.max(this.min, next);
            if (this.max !== undefined) next = Math.min(this.max, next);
            this.$emit('update:modelValue', next);
        }
    },
    template: `
        <div class="num-field" :class="size === 'md' ? 'num-field-md' : ''">
            <span v-if="prefix" class="num-field-prefix">{{ prefix }}</span>
            <input type="number" :value="modelValue" :min="min" :max="max" step="any"
                :aria-label="ariaLabel || null" @input="onInput">
            <span v-if="unit" class="num-field-unit">{{ unit }}</span>
            <div class="num-field-steppers">
                <button type="button" tabindex="-1" :aria-label="'+ ' + step" @mousedown.prevent @click="nudge(1)"><i class="ph-bold ph-caret-up"></i></button>
                <button type="button" tabindex="-1" :aria-label="'- ' + step" @mousedown.prevent @click="nudge(-1)"><i class="ph-bold ph-caret-down"></i></button>
            </div>
        </div>
    `
};
