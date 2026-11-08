import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { RegistrarServiceWorker } from '@/components/RegistrarServiceWorker';
import { AvisoCookies } from '@/components/AvisoCookies';
import { SCRIPT_TEMA } from '@/lib/tema';

export const metadata: Metadata = {
  title: 'Cachet',
  description: 'Gestão de casting, escala, check-in e financeiro de eventos',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icone.svg', apple: '/icone.svg' },
  appleWebApp: { capable: true, title: 'Cachet', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5b2a86',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // nonce sorteado pelo middleware (CSP): sem ele o navegador bloqueia o script do tema
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // o script do tema muda o <html> antes da hidratação: por isso o suppressHydrationWarning
    <html lang="pt-BR" suppressHydrationWarning>
      {/* o navegador esconde o nonce depois de usar (fica vazio no DOM): daí o suppressHydrationWarning */}
      <head><script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} /></head>
      <body>
        {children}
        <RegistrarServiceWorker />
        <AvisoCookies />
      </body>
    </html>
  );
}
