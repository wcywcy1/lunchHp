import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

const tsConfigs = ts.configs.recommended.map(cfg => {
    if (!cfg.rules) return cfg
    const rules = { ...cfg.rules }
    delete rules['@typescript-eslint/ban-types']
    return { ...cfg, rules }
})

export default ts.config(
    js.configs.recommended,
    ...tsConfigs,
    ...vue.configs['flat/recommended'],
    {
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: ts.parser,
                sourceType: 'module',
            },
            globals: {
                uni: 'readonly',
                wx: 'readonly',
                getCurrentPages: 'readonly',
                getApp: 'readonly',
                UniApp: 'readonly',
            },
        },
        rules: {
            'vue/multi-word-component-names': 'off',
            'vue/attribute-hyphenation': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/singleline-html-element-content-newline': 'off',
            'vue/no-unused-vars': 'warn',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-empty-object-type': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-undef': 'off',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', 'wxcloud/**'],
    },
)