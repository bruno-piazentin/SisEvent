// Na Vercel o site e a API são serviços do mesmo projeto, no mesmo domínio: a API responde em /api
// (rewrite no vercel.json da raiz). Sem NEXT_PUBLIC_API_URL definida, o site usa esse caminho relativo
// em vez de cair em http://localhost:3001. Fora da Vercel (Docker, dev) vale o padrão de lib/api.ts.
const apiUrl = process.env.NEXT_PUBLIC_API_URL || (process.env.VERCEL ? '/api' : undefined);

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(apiUrl ? { env: { NEXT_PUBLIC_API_URL: apiUrl } } : {}),
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
