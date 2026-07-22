module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    // Enforces DESIGN.md §3's module contract at build time, not just by
    // convention: core must never import from a vertical, only the
    // reverse. Every vertical folder that exists as of this writing is
    // listed here (restaurant/pharmacy/salon plus the manufacturing and
    // service-jobs verticals added since) - a new vertical folder must be
    // added to this list, or this rule silently stops covering it.
    {
      files: [
        'src/catalog/**/*.ts',
        'src/inventory/**/*.ts',
        'src/sales/**/*.ts',
        'src/payments/**/*.ts',
        'src/shifts/**/*.ts',
        'src/customers/**/*.ts',
        'src/organizations/**/*.ts',
        'src/branches/**/*.ts',
        'src/terminals/**/*.ts',
        'src/reports/**/*.ts',
        'src/module-registry/**/*.ts',
        'src/recipes/**/*.ts',
        'src/repackaging/**/*.ts',
        'src/waste/**/*.ts',
        'src/purchasing/**/*.ts',
        'src/payroll/**/*.ts',
        'src/roster/**/*.ts',
        'src/auth/**/*.ts',
        'src/org-users/**/*.ts',
        'src/stock-transfers/**/*.ts',
        'src/stock-takes/**/*.ts',
        'src/layaways/**/*.ts',
        'src/notifications/**/*.ts',
        'src/common/**/*.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/restaurant/**', '**/restaurant'],
                message:
                  'Core must never import from the restaurant vertical (DESIGN.md §3) - communicate via IndustryModuleManifest/domain events instead.',
              },
              {
                group: ['**/pharmacy/**', '**/pharmacy'],
                message:
                  'Core must never import from the pharmacy vertical (DESIGN.md §3) - communicate via IndustryModuleManifest/domain events instead.',
              },
              {
                group: ['**/salon/**', '**/salon'],
                message:
                  'Core must never import from the salon vertical (DESIGN.md §3) - communicate via IndustryModuleManifest/domain events instead.',
              },
              {
                group: ['**/manufacturing/**', '**/manufacturing'],
                message:
                  'Core must never import from the manufacturing vertical (DESIGN.md §3) - communicate via IndustryModuleManifest/domain events instead.',
              },
              {
                group: ['**/service-jobs/**', '**/service-jobs'],
                message:
                  'Core must never import from the service-jobs vertical (DESIGN.md §3) - communicate via IndustryModuleManifest/domain events instead.',
              },
              {
                group: ['**/public-booking/**', '**/public-booking'],
                message:
                  'Core must never import from public-booking - it is a vertical-facing (salon) unauthenticated entry point, not core.',
              },
            ],
          },
        ],
      },
    },
  ],
};
