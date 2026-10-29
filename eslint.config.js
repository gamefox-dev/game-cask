import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'web/public/', 'reports/', 'original/', 'port/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', console: 'readonly', process: 'readonly',
        performance: 'readonly', fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Buffer: 'readonly',
        setTimeout: 'readonly', setInterval: 'readonly', crypto: 'readonly', btoa: 'readonly', atob: 'readonly',
        TextDecoder: 'readonly', WebAssembly: 'readonly', localStorage: 'readonly', location: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['tests/**/*.ts', 'web/src/bench.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['tools/**/*.mjs'],
    rules: { 'no-control-regex': 'off' },
  },
);
