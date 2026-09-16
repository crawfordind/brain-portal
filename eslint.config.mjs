import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Lint policy.
 *
 * CI fails on errors and tolerates warnings, so the split between the two is
 * the thing that matters: an error must mean "this is broken", or contributors
 * learn to ignore a red build.
 *
 * `no-unused-vars` and `no-explicit-any` are warnings. They are worth seeing
 * and worth cleaning up, but neither breaks anything at runtime, and gating
 * every pull request on a backlog of several hundred of them would mean the
 * first contribution anyone makes is an unrelated type sweep. Rules that catch
 * actual defects — the React hooks rules above all — stay errors.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated at build time by @serwist/next.
    "public/sw.js",
    "public/swe-worker-*.js",
  ]),

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          // A leading underscore is the conventional way to say "required by
          // the signature, deliberately unused".
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",

      // Next 16's React Compiler lint flags ~19 existing effects that set state
      // synchronously. Most are the standard "have I mounted yet" hydration
      // guard, and unwinding them means changing render behaviour in voice,
      // offline and theme components — a real refactor with real regression
      // risk, not a lint cleanup. It is a warning so it stays visible and does
      // not block contributions in the meantime. See CONTRIBUTING.md.
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  {
    // Playwright's fixture API takes a callback parameter named `use`, which
    // the React hooks rule reads as a hook called outside a component. It is
    // not React code at all.
    files: ["tests/audit/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },

  {
    // Test files lean on `any` for mock shapes and on triple-slash references
    // for ambient type augmentation. Neither is worth a rule fight here.
    files: ["tests/**/*.ts", "tests/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
]);

export default eslintConfig;
