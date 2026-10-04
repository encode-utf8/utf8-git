import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["apps/**", "**/dist/**", "**/coverage/**", "**/node_modules/**"] },
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
);
