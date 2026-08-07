import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/verify-cpsbc": [
      "./node_modules/playwright-core/browsers.json",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/download-cpsbc-pdf": [
      "./node_modules/playwright-core/browsers.json",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
};

export default nextConfig;
