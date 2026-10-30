import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegistrarServiceWorker } from '@/components/RegistrarServiceWorker';

export const metadata: Metadata = {
  title: 'SisEvent — Rafa Dutra Eventos',
  description: 'Gestão de casting, escala, check-in e financeiro de eventos',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'SisEvent', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5b2a86',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <RegistrarServiceWorker />
      </body>
    </html>
  );
}
