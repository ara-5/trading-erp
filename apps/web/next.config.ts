import type { NextConfig } from 'next';
import path from 'path';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for Docker; trace from the monorepo root so workspace deps are included.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Serve the API under the same origin so the httpOnly refresh cookie is first-party and no CORS is needed.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiTarget}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
