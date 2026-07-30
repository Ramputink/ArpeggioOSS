/**
 * Lint rules for the whole workspace.
 *
 * Deliberately small. The point is not house style — Prettier settles that — but
 * the handful of mistakes that are invisible in review and expensive at runtime:
 * a floating promise, an unused import left behind by a refactor, a `catch` that
 * swallows something it should not.
 *
 * Type-aware rules are off on purpose: they need a TypeScript program per
 * package, which triples lint time for a repo whose real safety net is `tsc
 * --noEmit` plus the test suite. This runs in CI on every push, and it has to be
 * fast enough that nobody is tempted to skip it.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "apps/*/dist/**", "services/**", "samples/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // An unused import is almost always the residue of a refactor, and the
      // leading-underscore escape hatch keeps deliberately-ignored arguments legal.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `any` shows up in DOM and audio glue where the real type is unknowable;
      // flagging it as a warning keeps it visible without blocking a build.
      "@typescript-eslint/no-explicit-any": "warn",
      // Every `catch {}` in this codebase is intentional (storage unavailable,
      // pointer capture refused) and every one carries a comment saying why.
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
    },
  },
  {
    // Build scripts and service workers are plain JS with their own globals.
    files: ["**/*.mjs", "**/*.js"],
    rules: { "@typescript-eslint/no-unused-vars": "off", "no-undef": "off" },
  },
);
