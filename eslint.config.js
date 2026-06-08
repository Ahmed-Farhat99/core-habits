import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  pluginJs.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "warn",
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "constructor-super": "error",
      "no-this-before-super": "error",
      "no-const-assign": "error"
    }
  }
];
