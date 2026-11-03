import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegistrarServiceWorker } from '@/components/RegistrarServiceWorker';
import { SCRIPT_TEMA } from '@/lib/tema';

export const metadata: Metadata = {
  title: 'SisEvent',
  description: 'Gestão de casting, escala, check-in e financeiro de eventos',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icone.svg', apple: '/icone.svg' },
  appleWebApp: { capable: true, title: 'SisEvent', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5b2a86',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // o script do tema muda o <html> antes da hidratação: por isso o suppressHydrationWarning
    <html lang="pt-BR" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} /></head>
      <body>
        {children}
        <RegistrarServiceWorker />
      </body>
    </html>
  );
}
