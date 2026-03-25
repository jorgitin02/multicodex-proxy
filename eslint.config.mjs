import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const baseRules = {
  complexity: ["warn", 60],
  "max-lines": [
    "warn",
    { max: 1400, skipBlankLines: true, skipComments: true },
  ],
  "no-warning-comments": [
    "error",
    { terms: ["todo", "fixme"], location: "anywhere" },
  ],
  "prefer-const": "warn",
};

export default [
  {
    ignores: [
      "dist/**",
      "web-dist/**",
      "node_modules/**",
      "web/node_modules/**",
      "data/**",
      ".worktrees/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...baseRules,
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...baseRules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
          leadingUnderscore: "allowDouble",
          trailingUnderscore: "allowDouble",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "property",
          modifiers: ["requiresQuotes"],
          format: null,
        },
      ],
    },
  },
];
