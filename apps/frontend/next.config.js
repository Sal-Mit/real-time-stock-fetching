/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@crypto-app/proto'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8081/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
