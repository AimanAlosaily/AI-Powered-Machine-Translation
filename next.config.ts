import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isStaticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : undefined,
  basePath: isStaticExport ? basePath : undefined,
  assetPrefix: isStaticExport && basePath ? basePath : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
