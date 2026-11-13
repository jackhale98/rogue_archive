import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/web/public/runtime/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tools/**', '*.config.{js,ts}', 'apps/web/vite.config.ts', 'e2e/**', 'games/*/tests/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Pages that host an upstream game client (loaded with that client's AMD loader).
    files: ['games/*/client-host/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, require: 'readonly', define: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Emscripten --pre-js code for Node test harnesses.
    files: ['games/*/tests/**/*-hooks.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.node, Module: 'writable', FS: 'readonly', NODEFS: 'readonly', ENV: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
);
