'use client';
import { ExigeModulo, usePainel, Voltar } from '@/components/Painel';
import { FormProfissional } from '@/components/FormProfissional';

export default function NovoProfissional() {
  const { voltar } = usePainel();
  return (
    <ExigeModulo modulo="M1" acao="criar">
      <Voltar para="/profissionais" />
      <div className="topo"><h1>Novo profissional</h1></div>
      <FormProfissional onCancelar={() => voltar('/profissionais')} />
    </ExigeModulo>
  );
}
