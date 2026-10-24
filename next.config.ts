import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// One id per Vercel deployment, empty locally. Two jobs (2026-10-24, after
// tabs opened before a rollback kept calling the old upload API):
// - `deploymentId`: Next.js turns the next in-app navigation of a tab built by
//   another deployment into a full reload.
// - NEXT_PUBLIC_APP_VERSION is baked into BOTH bundles of a build, so a tab's
//   copy is the deployment it loaded and /api/app-version answers with the
//   deployment now serving; NewVersionBanner compares the two for tabs that
//   sit on one page and never navigate.
const appVersion = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "";

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  ...(appVersion ? { deploymentId: appVersion } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
};

export default nextConfig;
