import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  experimental: {
    // CSV uploads (LinkedIn connections export, angel lists) go through server actions.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
