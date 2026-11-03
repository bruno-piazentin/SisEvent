'use client';
import { use, useEffect, useState } from 'react';
import { api, fmt, DIAS } from '@/lib/api';
import { ExigeModulo, usePainel, Voltar } from '@/components/Painel';
import { FormProfissional } from '@/components/FormProfissional';
import { Ocorrencias } from '@/components/Ocorrencias';
import { LinksRedesSociais } from '@/components/RedesSociais';
import { GaleriaFotos } from '@/components/GaleriaFotos';
import { CORES_CABELO, TIPOS_CABELO } from '@/lib/ui';

export default function FichaProfissional({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ExigeModulo modulo="M1"><Ficha id={id} /></ExigeModulo>;
}

function Ficha({ id }: { id: string }) {
  const { pode } = usePainel();
  const [p, setP] = useState<any>(null);
  const [editando, setEditando] = useState(false);
  const [link, setLink] = useState<any>(null);
  const [erro, setErro] = useState('');

  useEffect(() => { api(`/profissionais/${id}`).then(setP).catch((e) => setErro(e.message)); }, [id]);

  async function gerarLink() {
    setErro('');
    try { setLink(await api(`/profissionais/${id}/link-acesso`, { method: 'POST' })); }
    catch (e: any) { setErro(e.message); }
  }

  if (erro && !p) return <div className="aviso erro">{erro}</div>;
  if (!p) return <div className="suave">Carregando…</div>;
  if (editando) return (<><div className="topo"><h1>Editar {p.nome}</h1>
    <button className="btn" onClick={() => setEditando(false)}>Cancelar</button></div><FormProfissional inicial={p} onCancelar={() => setEditando(false)} /></>);

  const h = p.historico ?? {};
  return (
    <>
      <Voltar para="/profissionais" />
      <div className="topo">
        <div>
          <h1>{p.nome_artistico ?? p.nome}</h1>
          <div className="suave">{p.funcoes.map((f: any) => f.nome).join(' · ')} — {p.cidade}/{p.uf}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Ocorrencias caminho={`/profissionais/${id}`} nome={p.nome_artistico ?? p.nome} podeRegistrar={pode('M1', 'editar')} />
          {pode('M5', 'criar') && <button className="btn campo" onClick={gerarLink}>Gerar link de acesso</button>}
          {pode('M1', 'editar') && <button className="btn" onClick={() => setEditando(true)}>Editar ficha</button>}
        </div>
      </div>

      {erro && <div className="aviso erro" style={{ marginBottom: 12 }}>{erro}</div>}
      {link && (
        <div className="cartao" style={{ marginBottom: 16, borderColor: 'var(--destaque)' }}>
          <h3>Link de acesso gerado (válido por {link.expira_em_dias} dias)</h3>
          <p className="suave pequeno">O link só aparece agora. Envie ao profissional; por ele ele confirma convocações e faz check-in, sem senha.</p>
          <input readOnly value={link.link} onFocus={(e) => e.target.select()} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <a className="btn primario" href={link.whatsapp} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>
            <button className="btn" onClick={() => navigator.clipboard.writeText(link.link)}>Copiar</button>
          </div>
        </div>
      )}

      <div className="grade g4" style={{ marginBottom: 16 }}>
        <div className="cartao kpi"><div className="rotulo">Jobs</div><div className="valor">{h.jobs_finalizados ?? 0}</div></div>
        <div className="cartao kpi"><div className="rotulo">Faltas</div><div className="valor">{h.faltas ?? 0}</div></div>
        <div className="cartao kpi"><div className="rotulo">Atrasos</div><div className="valor">{h.atrasos ?? 0}</div></div>
        <div className="cartao kpi"><div className="rotulo">Nota média</div><div className="valor">{h.nota_media ?? '—'}</div></div>
      </div>

      <div className="grade g2">
        <section className="cartao">
          <h2>Perfil</h2>
          <table><tbody>
            <tr><td className="suave">Status</td><td><span className="etiqueta">{p.status}</span></td></tr>
            <tr><td className="suave">Contato</td><td>{p.celular}<br />{p.email}</td></tr>
            <tr><td className="suave">Redes sociais</td><td><LinksRedesSociais valor={p.redes_sociais} /></td></tr>
            <tr><td className="suave">Cabelo</td><td>{[p.tipo_cabelo && TIPOS_CABELO[p.tipo_cabelo], p.cor_cabelo && CORES_CABELO[p.cor_cabelo]].filter(Boolean).join(' · ') || '—'}</td></tr>
            {!p.ocultos && <tr><td className="suave">Nascimento</td><td>{fmt.data(p.data_nascimento)}</td></tr>}
            <tr><td className="suave">Medidas</td><td>{[p.altura_cm && `${p.altura_cm} cm`, p.peso_kg && `${p.peso_kg} kg`, p.manequim && `manequim ${p.manequim}`,
              p.tamanho_camiseta && `camiseta ${p.tamanho_camiseta}`, p.calcado && `calçado ${p.calcado}`].filter(Boolean).join(' · ') || '—'}</td></tr>
            <tr><td className="suave">Locomoção</td><td>{p.meios_locomocao.join(', ').replaceAll('_', ' ') || '—'}{p.cnh_categoria && ` · CNH ${p.cnh_categoria}`}</td></tr>
            <tr><td className="suave">Praças</td><td>{[p.pracas_aceitas.map((x: any) => x.nome)].flat().join(', ') || 'só a base'}</td></tr>
            <tr><td className="suave">Idiomas</td><td>{p.idiomas.join(', ')}</td></tr>
            {!p.ocultos && <tr><td className="suave">CPF</td><td>{p.cpf ?? '—'}</td></tr>}
            {!p.ocultos && <tr><td className="suave">PIX</td><td>{p.chave_pix ?? '—'}</td></tr>}
          </tbody></table>
        </section>

        <section className="cartao">
          <h2>Disponibilidade</h2>
          {p.disponibilidade.length === 0 && <p className="suave">Não declarada.</p>}
          <table><tbody>
            {p.disponibilidade.map((d: any, i: number) => (
              <tr key={i}><td style={{ width: 70 }}><strong>{DIAS[d.dia_semana]}</strong></td><td>{d.hora_inicio} às {d.hora_fim}</td></tr>
            ))}
          </tbody></table>
          <h2 style={{ marginTop: 20 }}>Documentos</h2>
          {p.documentos.length === 0 && <p className="suave">Nenhum documento.</p>}
          {p.documentos.map((d: any) => {
            const venc = d.validade && new Date(d.validade) < new Date();
            return <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>{d.tipo.replaceAll('_', ' ')}</span>
              <span className={`etiqueta ${venc ? 'erro' : 'ok'}`}>{d.validade ? `${venc ? 'venceu' : 'vale até'} ${fmt.data(d.validade)}` : 'sem validade'}</span>
            </div>;
          })}

          <h2 style={{ marginTop: 20 }}>Fotos</h2>
          <GaleriaFotos lista={`/profissionais/${id}/fotos`} arquivo={(f) => `/profissionais/${id}/fotos/${f}`}
                        principal={(f) => `/profissionais/${id}/fotos/${f}/principal`} podeEditar={pode('M1', 'editar')}
                        vazio="Nenhuma foto enviada." exemploLegenda="Ex.: rosto, corpo inteiro, uniforme…" />
        </section>

        {p.avaliacoes.length > 0 && (
          <section className="cartao">
            <h2>Avaliações</h2>
            {p.avaliacoes.map((a: any, i: number) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--borda)' }}>
                <strong>{'★'.repeat(a.nota)}</strong> <span className="suave pequeno">{a.evento} · {fmt.data(a.inicio)}</span>
                {a.observacao && <div className="pequeno">{a.observacao}</div>}
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
