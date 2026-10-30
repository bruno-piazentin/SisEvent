import { Painel } from '@/components/Painel';

export default function LayoutPainel({ children }: { children: React.ReactNode }) {
  return <Painel>{children}</Painel>;
}
