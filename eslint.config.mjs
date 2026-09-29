import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
export default defineConfig([
  ...nextVitals,
  // The client dashboard starts API subscriptions in effects; the QR image is a generated data URL.
  { rules: { "react-hooks/set-state-in-effect": "off", "react/no-unescaped-entities": "off", "@next/next/no-img-element": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"])
]);
