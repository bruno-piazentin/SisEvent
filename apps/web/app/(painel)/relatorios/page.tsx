'use client';
import { EmBreve } from '@/components/EmBreve';
export default function Relatorios() {
  return <EmBreve modulo="M8" titulo="Leads e relatórios" itens={[
    'Captura de leads na ativação com consentimento LGPD', 'Deduplicação e exportação para o cliente',
    'Relatório pós-evento em PDF com a identidade do cliente']} />;
}
