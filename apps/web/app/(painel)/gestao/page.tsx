'use client';
import { EmBreve } from '@/components/EmBreve';
export default function Gestao() {
  return <EmBreve modulo="M9" titulo="Painel de gestão" itens={[
    'Contas a receber e inadimplência', 'Cadastro de fornecedores', 'Eventos em risco e ocupação da base']} />;
}
