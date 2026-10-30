// Na Vercel o endereço da API é obrigatório: sem ele o site cairia em
// http://localhost:3001 e o login falharia sem explicação.
if (process.env.VERCEL && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    'Defina NEXT_PUBLIC_API_URL nas variáveis de ambiente do projeto na Vercel ' +
    '(ex.: https://sisevent-api.onrender.com/api) e faça o deploy de novo.',
  );
}

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
