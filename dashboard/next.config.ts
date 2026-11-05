import type { NextConfig } from "next";
import path from "node:path";
const nextConfig:NextConfig={
  outputFileTracingRoot:path.resolve(process.cwd(),".."),
  serverExternalPackages:["@sparticuz/chromium-min","playwright-core","otplib"],
  outputFileTracingIncludes:{"/api/morning-sync":["./node_modules/playwright-core/browsers.json"],"/api/misa-sync/**/*":["./node_modules/playwright-core/browsers.json"],"/api/misa-sync":["./node_modules/playwright-core/browsers.json"]},
};
export default nextConfig;
