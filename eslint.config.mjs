import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Playwright's isolated Next build (`NEXT_DIST_DIR=.next-pdf-editor-e2e`)
    // and any other alternate dist directory. Without this, lint walks the
    // generated bundle and reports thousands of errors in compiled output.
    ".next-*/**",
    "out/**",
    "build/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
