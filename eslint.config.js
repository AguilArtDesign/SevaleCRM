import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '.tmp/**',
      'Instruccion no subir a GIT/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@heroui/react',
              importNames: ['Chip', 'Input', 'Pagination', 'Select'],
              message: 'Usa los componentes compartidos de apps/web/src/components.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='input']",
          message: 'Usa el componente Input compartido basado en HeroUI.',
        },
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Usa el componente Select compartido basado en HeroUI.',
        },
      ],
    },
  },
  {
    files: [
      'apps/web/src/components/Chip.tsx',
      'apps/web/src/components/Input.tsx',
      'apps/web/src/components/Pagination.tsx',
      'apps/web/src/components/Select.tsx',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
