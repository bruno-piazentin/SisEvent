'use client';
import { ExigeModulo } from '@/components/Painel';
import { FormProfissional } from '@/components/FormProfissional';

export default function NovoProfissional() {
  return (
    <ExigeModulo modulo="M1" acao="criar">
      <div className="topo"><h1>Novo profissional</h1></div>
      <FormProfissional />
    </ExigeModulo>
  );
}
