module.exports = {
  root: true,
  extends: ["eslint:recommended", "prettier"],
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  env: { node: true, es2022: true },
  ignorePatterns: [
    "node_modules", "dist", ".next", ".turbo",
    "coverage", "playwright-report", "test-results",
    "packages/db/src/generated"
  ],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint"],
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "prettier"
      ],
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
      },
      rules: {
        "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
      }
    }
  ]
};
