/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
