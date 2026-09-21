import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules/**', 'data/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Feed and API payloads are genuinely unknown shapes; narrowing every one
      // of them buys nothing here, so `any` is allowed where it is deliberate.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The flat config itself is plain JS and outside the tsconfig project, so
    // type-aware rules cannot run on it.
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // node:test's `test()` returns a promise by design and is never awaited.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  prettier,
);
