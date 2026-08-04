import type { NextConfig } from "next";

const apiOrigin =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_ORIGIN ??
  "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    // Same-origin proxy avoids CORS without changing apps/api.
    return [
      {
        source: "/backend/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
