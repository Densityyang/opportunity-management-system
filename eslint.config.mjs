import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "apps/api/src/generated/**",
      "work/**",
      "outputs/**",
    ],
  },
  // Use the TypeScript parser and syntax-safe base configuration in both
  // workspace applications. Type-level correctness is enforced by tsc.
  { ...tseslint.configs.base, files: ["**/*.{ts,tsx}"] },
];
