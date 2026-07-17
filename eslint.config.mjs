import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "lib/seadrop/**",
    "out/**",
    "broadcast/**",
    "artifacts/**",
    "cache/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
