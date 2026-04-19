/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dev-server proxy default times out at 30s. Real scans on
  // 1000+ document corpora can take 60-120s (SHA-256 of every file).
  // Some convert calls on big scanned PDFs take 60s+ too. Push to 10 min.
  experimental: {
    proxyTimeout: 600_000,
  },
  // pdf.js ships workers — let Next handle them as static assets
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  async rewrites() {
    return [
      // Proxy API calls to the FastAPI backend during dev
      { source: "/api/:path*", destination: "http://localhost:8000/:path*" },
    ];
  },
};

export default nextConfig;
