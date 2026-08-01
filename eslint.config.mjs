import tseslint from "typescript-eslint";
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  {
    ignores: ["node_modules/**", "dist/**", "__tests__/**", "*.test.ts"],
  }
);
