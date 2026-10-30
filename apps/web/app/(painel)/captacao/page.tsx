'use client';
import { EmBreve } from '@/components/EmBreve';
export default function Captacao() {
  return <EmBreve modulo="M2" titulo="Captação e triagem" itens={[
    'Formulário público de cadastro (link e QR para o Instagram)', 'Fila de triagem com aprovar/reprovar e motivo',
    'Convite em massa por perfil e praça', 'Funil inscrito → triado → aprovado → escalado']} />;
}
