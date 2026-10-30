/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',          // imagem Docker enxuta
  reactStrictMode: true,
  async headers() {
    return [
      {
        // o service worker precisa ser servido sem cache para atualizar a fila offline
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }],
      },
    ];
  },
};
export default nextConfig;
