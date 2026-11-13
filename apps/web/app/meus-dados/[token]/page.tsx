'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { apiPublica, fmt } from '@/lib/api';
import { PaginaLegal } from '@/components/legal/PaginaLegal';

/**
 * Cópia dos dados do titular (LGPD: acesso e portabilidade). O link chega pelo WhatsApp do celular
 * cadastrado na empresa e vale 72 horas; só baixa quando a pessoa clica.
 */
export default function MeusDados({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [estado, setEstado] = useState<'inicio' | 'baixando' | 'pronto'>('inicio');
  const [erro, setErro] = useState('');
  const [resumo, setResumo] = useState<{ empresa: string; nome: string; trabalhos: number; gerado_em: string } | null>(null);

  async function baixar() {
    setErro(''); setEstado('baixando');
    try {
      const dados = await apiPublica(`/meus-dados/${encodeURIComponent(token)}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `meus-dados-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);   // revogar na hora pode cancelar o download em alguns navegadores
      setResumo({ empresa: dados.controladora, nome: dados.dados_cadastrais?.nome, trabalhos: dados.trabalhos?.length ?? 0, gerado_em: dados.gerado_em });
      setEstado('pronto');
    } catch (e: any) {
      setErro(e.message); setEstado('inicio');
    }
  }

  return (
    <PaginaLegal titulo="Cópia dos seus dados"
      resumo={<>Aqui você baixa todos os dados que a empresa guarda sobre você, como pediu: cadastro, funções, trabalhos, documentos e pagamentos.
        O arquivo vem no formato JSON, que pode ser aberto em qualquer editor de texto ou enviado a outro serviço.</>}>
      <p><b>Atenção:</b> o arquivo traz CPF, RG e chave Pix. Guarde-o em lugar seguro e não repasse este link: ele é pessoal e vale por 72 horas.</p>
      {estado !== 'pronto' && (
        <button className="btn primario" onClick={baixar} disabled={estado === 'baixando'}>
          {estado === 'baixando' ? 'Preparando…' : 'Baixar meus dados'}
        </button>
      )}
      {erro && <div className="aviso erro" style={{ marginTop: 12 }}>{erro}</div>}
      {resumo && (
        <div className="aviso ok" style={{ marginTop: 12 }}>
          Arquivo baixado. Dados de <b>{resumo.nome}</b> na <b>{resumo.empresa}</b>, gerados em {fmt.data(resumo.gerado_em)}, com {resumo.trabalhos} trabalho(s) registrado(s).
          Se o download não começou, <button className="btn pequeno" onClick={baixar}>baixe de novo</button>.
        </div>
      )}
      <p className="suave pequeno" style={{ marginTop: 20 }}>
        Quer corrigir algo ou excluir seus dados? Faça um novo pedido em <Link href="/privacidade/solicitacao">Seus direitos</Link>.
      </p>
    </PaginaLegal>
  );
}
