'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { api, apiArquivoUrl, fmt } from '@/lib/api';
import { ExigeModulo, usePainel } from '@/components/Painel';
import { Confirmar } from '@/components/Confirmar';

/** Captação (M2): link público de Casting da empresa e fila de triagem das inscrições */
export default function Captacao() {
  return <ExigeModulo modulo="M2"><Triagem /></ExigeModulo>;
}

type Status = 'pendente' | 'aprovada' | 'reprovada';
const ROTULO: Record<Status, string> = { pendente: 'Pendentes', aprovada: 'Aprovadas', reprovada: 'Reprovadas' };
const MEIOS: Record<string, string> = { carro_proprio: 'Carro próprio', moto_propria: 'Moto própria', transporte_publico: 'Transporte público',
  aplicativo: 'Aplicativo', bicicleta: 'Bicicleta', a_pe: 'A pé', carona: 'Carona' };

/** Foto protegida (precisa do token): baixa e mostra */
function FotoProtegida({ caminho, alt }: { caminho: string; alt: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    apiArquivoUrl(caminho).then((x) => { u = x; setUrl(x); }).catch(() => undefined);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [caminho]);
  return url ? <img src={url} alt={alt} /> : <span aria-hidden="true">…</span>;
}

function Triagem() {
  const { me, pode } = usePainel();
  const [status, setStatus] = useState<Status>('pendente');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<any[] | null>(null);
  const [resumo, setResumo] = useState<Record<Status, number>>({ pendente: 0, aprovada: 0, reprovada: 0 });
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api(`/captacao/inscricoes?status=${status}${busca.trim() ? `&busca=${encodeURIComponent(busca.trim())}` : ''}`).then(setLista);
    api('/captacao/resumo').then(setResumo);
  }, [status, busca]);
  useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [carregar]);

  if (aberta) return <Ficha id={aberta} podeAprovar={pode('M2', 'aprovar')} podeExcluir={pode('M2', 'excluir')}
                            onVoltar={() => { setAberta(null); carregar(); }} />;

  return (
    <>
      <div className="topo"><div><h1>Captação</h1><p className="suave" style={{ margin: 0 }}>Inscrições de Casting recebidas pelo link da empresa</p></div></div>
      <LinkCasting slug={me.empresa.slug} />

      <div className="abas-status" role="tablist">
        {(Object.keys(ROTULO) as Status[]).map((s) => (
          <button key={s} role="tab" aria-selected={status === s} className={`btn${status === s ? ' primario' : ''}`} onClick={() => setStatus(s)}>
            {ROTULO[s]} <span className="etiqueta neutra">{resumo[s]}</span>
          </button>
        ))}
        <input style={{ flex: '1 1 200px', maxWidth: 320 }} placeholder="Buscar por nome ou cidade" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {!lista ? <p className="suave">Carregando…</p>
        : lista.length === 0 ? (
          <div className="cartao suave">
            {status === 'pendente' ? 'Nenhuma inscrição esperando análise. Divulgue o link de Casting acima.' : `Nenhuma inscrição ${ROTULO[status].toLowerCase()}.`}
          </div>
        ) : (
          <div className="inscricoes">
            {lista.map((i) => (
              <button key={i.id} className="cartao inscricao" onClick={() => setAberta(i.id)}>
                <div className="inscricao-foto">
                  {i.foto_id ? <FotoProtegida caminho={`/captacao/inscricoes/${i.id}/fotos/${i.foto_id}`} alt={i.nome} /> : <span aria-hidden="true">👤</span>}
                </div>
                <div className="inscricao-dados">
                  <strong>{i.nome_artistico || i.nome}</strong>
                  <span className="suave pequeno">{[i.idade && `${i.idade} anos`, i.altura_cm && `${i.altura_cm} cm`, i.cidade && `${i.cidade}/${i.uf}`].filter(Boolean).join(' · ')}</span>
                  {i.funcoes?.length > 0 && <span className="pequeno">{i.funcoes.join(', ')}</span>}
                  <span className="suave pequeno">{status === 'pendente' ? `Recebida em ${fmt.data(i.criado_em)}` : `Analisada em ${fmt.data(i.analisada_em)}`}</span>
                </div>
              </button>
            ))}
          </div>
        )}
    </>
  );
}

function LinkCasting({ slug }: { slug: string }) {
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    const u = `${window.location.origin}/casting/${slug}`;
    setUrl(u);
    QRCode.toDataURL(u, { margin: 1, width: 600, errorCorrectionLevel: 'M' }).then(setQr);
  }, [slug]);
  async function copiar() {
    try { await navigator.clipboard.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sem permissão */ }
  }
  return (
    <div className="cartao" style={{ marginBottom: 16 }}>
      <h2>Link de Casting da empresa</h2>
      <p className="suave pequeno" style={{ marginTop: 0 }}>Divulgue no Instagram, no WhatsApp ou em cartaz. Quem se inscreve aparece aqui para análise.</p>
      <div className="link-casting">
        {qr && <img src={qr} alt="QR do link de Casting" width={96} height={96} />}
        <div style={{ display: 'grid', gap: 8, flex: '1 1 260px' }}>
          <code>{url}</code>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={copiar}>{copiado ? 'Link copiado' : 'Copiar link'}</button>
            {qr && <a className="btn" href={qr} download={`casting-${slug}.png`}>Baixar QR</a>}
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Abrir formulário</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ficha({ id, podeAprovar, podeExcluir, onVoltar }: { id: string; podeAprovar: boolean; podeExcluir: boolean; onVoltar: () => void }) {
  const [i, setI] = useState<any>(null);
  const [acao, setAcao] = useState<'aprovar' | 'reprovar' | 'excluir' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string; profissional?: string } | null>(null);
  const carregar = useCallback(() => { api(`/captacao/inscricoes/${id}`).then(setI); }, [id]);
  useEffect(carregar, [carregar]);
  if (!i) return <p className="suave">Carregando…</p>;

  const pendente = i.status === 'pendente';
  const dado = (rotulo: string, valor: React.ReactNode) => (valor === null || valor === undefined || valor === '' ? null : <div><dt>{rotulo}</dt><dd>{valor}</dd></div>);
  const redes = Object.entries(i.redes_sociais ?? {}) as [string, string][];

  return (
    <>
      <div className="topo">
        <div>
          <button className="btn pequeno" onClick={onVoltar} style={{ marginBottom: 8 }}>← Voltar para a fila</button>
          <h1>{i.nome_artistico ? `${i.nome_artistico} (${i.nome})` : i.nome}</h1>
          <span className={`etiqueta ${pendente ? 'alerta' : i.status === 'aprovada' ? 'ok' : 'erro'}`}>{i.status === 'pendente' ? 'Aguardando análise' : i.status === 'aprovada' ? 'Aprovada' : 'Reprovada'}</span>
        </div>
        {pendente && podeAprovar && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => { setMotivo(''); setAcao('reprovar'); }}>Reprovar</button>
            <button className="btn primario" onClick={() => setAcao('aprovar')}>Aprovar e levar ao Banco de talentos</button>
          </div>
        )}
        {!pendente && podeExcluir && <button className="btn perigo" onClick={() => setAcao('excluir')}>Excluir inscrição</button>}
      </div>

      {aviso && (
        <div className={`aviso ${aviso.ok ? 'ok' : 'erro'}`} style={{ marginBottom: 14 }}>
          {aviso.texto} {aviso.profissional && <Link href={`/profissionais/${aviso.profissional}`}><b>Abrir o cadastro</b></Link>}
        </div>
      )}

      <div className="grade">
        {i.fotos.length > 0 && (
          <div className="cartao"><h2>Fotos</h2>
            <div className="ficha-fotos">{i.fotos.map((f: string, n: number) => <FotoProtegida key={f} caminho={`/captacao/inscricoes/${id}/fotos/${f}`} alt={`Foto ${n + 1}`} />)}</div>
          </div>
        )}
        <div className="cartao"><h2>Dados</h2>
          <dl className="ficha-dados">
            {dado('Celular', i.celular)}
            {dado('E-mail', i.email)}
            {dado('Idade', i.idade && `${i.idade} anos`)}
            {dado('Nascimento', i.data_nascimento && fmt.data(i.data_nascimento))}
            {dado('Gênero', i.genero)}
            {dado('Cidade', i.cidade && `${i.cidade}/${i.uf}${i.bairro ? ` · ${i.bairro}` : ''}`)}
            {dado('Região preferida', i.praca && `${i.praca}/${i.praca_uf}`)}
            {dado('Funções', i.funcoes_nomes.map((f: any) => f.nome).join(', '))}
            {dado('Altura', i.altura_cm && `${i.altura_cm} cm`)}
            {dado('Manequim', i.manequim)}
            {dado('Camiseta', i.tamanho_camiseta)}
            {dado('Calçado', i.calcado)}
            {dado('Cabelo', [i.tipo_cabelo, i.cor_cabelo].filter(Boolean).join(', '))}
            {dado('Olhos', i.cor_olhos)}
            {dado('Tom de pele', i.tom_pele)}
            {dado('Tatuagem visível', i.tatuagem_visivel === null ? null : i.tatuagem_visivel ? 'Sim' : 'Não')}
            {dado('Locomoção', i.meios_locomocao.map((m: string) => MEIOS[m] ?? m).join(', '))}
            {dado('Idiomas', i.idiomas.join(', '))}
            {dado('Redes', redes.map(([k, v]) => `${k}: ${v}`).join(' · '))}
            {dado('Inscrição', fmt.dataHora(i.criado_em))}
            {dado('Consentimento LGPD', fmt.dataHora(i.consentimento_lgpd_em))}
            {dado('Analisada por', i.analisada_por_nome && `${i.analisada_por_nome} em ${fmt.dataHora(i.analisada_em)}`)}
            {dado('Motivo da reprovação', i.motivo_reprovacao)}
          </dl>
          {i.experiencia && <><h3 style={{ marginTop: 16 }}>Experiência</h3><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{i.experiencia}</p></>}
          {i.profissional_id && <p style={{ marginBottom: 0 }}><Link href={`/profissionais/${i.profissional_id}`}><b>Abrir no Banco de talentos →</b></Link></p>}
        </div>
      </div>

      {acao === 'aprovar' && (
        <Confirmar titulo="Aprovar inscrição" rotulo="Aprovar" onCancelar={() => setAcao(null)}
          onConfirmar={async () => {
            const r = await api(`/captacao/inscricoes/${id}/aprovar`, { method: 'POST' });
            setAcao(null); setAviso({ ok: true, texto: 'Aprovada: agora está no Banco de talentos como "em teste".', profissional: r.profissional_id }); carregar();
          }}>
          <p>{i.nome} entra no Banco de talentos como profissional <b>em teste</b>, com as funções e as fotos enviadas.
            CPF, RG e dados bancários são pedidos depois, no cadastro.</p>
        </Confirmar>
      )}
      {acao === 'reprovar' && (
        <Confirmar titulo="Reprovar inscrição" rotulo="Reprovar" perigo onCancelar={() => setAcao(null)}
          onConfirmar={async () => {
            await api(`/captacao/inscricoes/${id}/reprovar`, { method: 'POST', json: { motivo } });
            setAcao(null); setAviso({ ok: true, texto: 'Inscrição reprovada. As fotos foram apagadas.' }); carregar();
          }}>
          <label>Motivo (fica registrado para a equipe)
            <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="Ex.: perfil não atende às funções da empresa no momento" />
          </label>
        </Confirmar>
      )}
      {acao === 'excluir' && (
        <Confirmar titulo="Excluir inscrição" rotulo="Excluir" perigo onCancelar={() => setAcao(null)}
          onConfirmar={async () => { await api(`/captacao/inscricoes/${id}`, { method: 'DELETE' }); onVoltar(); }}>
          <p>Os dados desta inscrição são apagados de vez. Use quando a pessoa pedir a exclusão dos dados ou para limpar a fila.
            {i.profissional_id && ' O cadastro no Banco de talentos não é afetado.'}</p>
        </Confirmar>
      )}
    </>
  );
}
