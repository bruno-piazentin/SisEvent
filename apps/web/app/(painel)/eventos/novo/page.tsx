'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ExigeModulo, usePainel, Voltar } from '@/components/Painel';
import { Geolocalizacao } from '@/components/Geolocalizacao';
import { prepararFoto } from '@/lib/imagem';
import { CORES_CABELO, mascara, soDigitos, TIPOS_CABELO } from '@/lib/ui';

type Posto = { funcao_id: string; quantidade: number; diaria_custo: number; diaria_venda: number; uniforme: string;
               requisitos: { altura_min?: number; idade_min?: number; generos?: string[]; exige_cnh?: boolean;
                             cabelo_cores?: string[]; cabelo_tipos?: string[] } };
type Turno = { nome: string; inicio: string; fim: string; postos: Posto[] };

const postoVazio = (): Posto => ({ funcao_id: '', quantidade: 1, diaria_custo: 0, diaria_venda: 0, uniforme: '', requisitos: { idade_min: 18 } });

export default function NovoEvento() {
  return <ExigeModulo modulo="M4" acao="criar"><Form /></ExigeModulo>;
}

function Form() {
  const router = useRouter();
  const { voltar } = usePainel();
  const [cat, setCat] = useState<{ clientes: any[]; pracas: any[]; funcoes: any[] }>({ clientes: [], pracas: [], funcoes: [] });
  const [ev, setEv] = useState<any>({ status: 'planejamento', exige_qr: true, exige_geolocalizacao: false, tolerancia_atraso_min: 10 });
  const [turnos, setTurnos] = useState<Turno[]>([{ nome: 'Turno 1', inicio: '', fim: '', postos: [postoVazio()] }]);
  const [erro, setErro] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [cepMsg, setCepMsg] = useState('');
  const [cepErro, setCepErro] = useState(false);

  // atalho do calendário da tela inicial (?data=AAAA-MM-DD): o 1º turno já vem nesse dia, das 08:00 às 18:00
  useEffect(() => {
    const data = new URLSearchParams(window.location.search).get('data');
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
    setTurnos((ts) => ts.map((t, i) => (i === 0 && !t.inicio && !t.fim ? { ...t, inicio: `${data}T08:00`, fim: `${data}T18:00` } : t)));
  }, []);
  const campoEndereco = useRef<HTMLInputElement>(null);

  /** CEP preenche o endereço e, se a cidade for uma praça cadastrada, já seleciona a praça */
  async function buscarCep(cep: string) {
    setBuscandoCep(true); setCepMsg(''); setCepErro(false);
    try {
      const r = await api(`/cep/${cep}`);
      const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const praca = cat.pracas.find((p) => sem(p.nome) === sem(r.cidade) && p.uf === r.uf);
      setEv((x: any) => ({
        ...x,
        endereco: [r.logradouro, r.bairro].filter(Boolean).join(', ') || x.endereco,
        praca_id: x.praca_id || praca?.id || '',
      }));
      setCepMsg(`${r.cidade}/${r.uf}${praca ? ` · praça ${praca.nome} selecionada` : ' · essa cidade não é uma praça cadastrada, escolha a praça'}. Complete o número no endereço.`);
      // leva o cursor para o fim do endereço, onde entra o número
      setTimeout(() => { const el = campoEndereco.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0);
    } catch (e: any) {
      setCepMsg(e.message); setCepErro(true);
    } finally { setBuscandoCep(false); }
  }

  useEffect(() => {
    Promise.all([api('/clientes').catch(() => []), api('/pracas'), api('/funcoes')])
      .then(([clientes, pracas, funcoes]) => setCat({ clientes, pracas, funcoes }));
  }, []);

  const campo = (k: string) => ({ value: ev[k] ?? '', onChange: (e: any) => setEv((x: any) => ({ ...x, [k]: e.target.value })) });
  const mudaTurno = (i: number, k: keyof Turno, v: any) => setTurnos((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const mudaPosto = (i: number, j: number, k: keyof Posto, v: any) =>
    setTurnos((ts) => ts.map((t, a) => (a !== i ? t : { ...t, postos: t.postos.map((p, b) => (b === j ? { ...p, [k]: v } : p)) })));

  const praca = cat.pracas.find((p) => p.id === ev.praca_id);
  const enderecoBusca = [ev.endereco, praca && `${praca.nome} ${praca.uf}`].filter(Boolean).join(', ');

  const custo = turnos.flatMap((t) => t.postos).reduce((s, p) => s + p.quantidade * p.diaria_custo, 0);
  const venda = turnos.flatMap((t) => t.postos).reduce((s, p) => s + p.quantidade * p.diaria_venda, 0);

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    try {
      const r = await api('/eventos', {
        method: 'POST',
        json: {
          ...ev,
          tolerancia_atraso_min: Number(ev.tolerancia_atraso_min),
          latitude: ev.latitude ?? null, longitude: ev.longitude ?? null,
          cep: ev.cep?.length === 8 ? ev.cep : null,
          observacoes: ev.observacoes?.trim() || null,
          contato_local_nome: ev.contato_local_nome?.trim() || null,
          contato_local_telefone: ev.contato_local_telefone?.trim() || null,
          contato_local_email: ev.contato_local_email?.trim() || null,
          turnos: turnos.map((t) => ({ ...t, inicio: new Date(t.inicio).toISOString(), fim: new Date(t.fim).toISOString(),
            postos: t.postos.map((p) => ({ ...p, quantidade: Number(p.quantidade), diaria_custo: Number(p.diaria_custo), diaria_venda: Number(p.diaria_venda) })) })),
        },
      });
      // fotos vão depois que o evento existe; se alguma falhar, o evento já está salvo e dá para reenviar na página dele
      const falhas: string[] = [];
      for (const f of fotos) {
        try { await api(`/eventos/${r.id}/fotos`, { method: 'POST', json: await prepararFoto(f) }); } catch { falhas.push(f.name); }
      }
      router.push(`/eventos/${r.id}${falhas.length ? `?fotos_falharam=${encodeURIComponent(falhas.join(', '))}` : ''}`);
    } catch (e: any) {
      setErro(e.dados?.campos ? e.dados.campos.map((c: any) => `${c.campo}: ${c.mensagem}`).join(' · ') : e.message);
    }
  }

  return (
    <form className="grade" onSubmit={salvar}>
      <Voltar para="/eventos" />
      <div className="topo"><h1>Novo evento</h1></div>
      <section className="cartao form">
        <h2>Evento</h2>
        <div className="linha">
          <label>Nome *<input required {...campo('nome')} /></label>
          <label>Cliente *<select required {...campo('cliente_id')}><option value="">—</option>{cat.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia ?? c.razao_social}</option>)}</select></label>
          <label>Marca<input {...campo('marca')} /></label>
          <label>Praça *<select required {...campo('praca_id')}><option value="">—</option>{cat.pracas.map((p) => <option key={p.id} value={p.id}>{p.nome}/{p.uf}</option>)}</select></label>
        </div>
        <div className="linha">
          <label>Local<input placeholder="Ex.: Shopping Catuaí" {...campo('local_nome')} /></label>
          <label>CEP{buscandoCep && <span className="suave"> · buscando…</span>}
            <input inputMode="numeric" placeholder="00000-000" value={mascara.cep(ev.cep)}
                   onChange={(e) => { const v = soDigitos(e.target.value); setEv((x: any) => ({ ...x, cep: v })); if (v.length === 8) buscarCep(v); }} /></label>
          <label style={{ gridColumn: 'span 2' }}>Endereço<input ref={campoEndereco} placeholder="Rua, número, bairro" {...campo('endereco')} /></label>
        </div>
        {cepMsg && <div className="pequeno" style={{ color: cepErro ? 'var(--erro)' : 'var(--suave)' }}>{cepMsg}</div>}
        <Geolocalizacao endereco={enderecoBusca} valor={{ latitude: ev.latitude ?? null, longitude: ev.longitude ?? null }}
                        onChange={(g) => setEv((x: any) => ({ ...x, ...g }))} />

        <div className="suave pequeno" style={{ fontWeight: 600 }}>Contato do local</div>
        <div className="linha">
          <label>Nome<input placeholder="Quem recebe a equipe no local" {...campo('contato_local_nome')} /></label>
          <label>Telefone<input inputMode="tel" placeholder="(00) 00000-0000" value={ev.contato_local_telefone ?? ''}
            onChange={(e) => setEv((x: any) => ({ ...x, contato_local_telefone: mascara.telefone(e.target.value) }))} /></label>
          <label>E-mail<input type="email" {...campo('contato_local_email')} /></label>
        </div>

        <div className="suave pequeno" style={{ fontWeight: 600 }}>Fotos do local</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="btn" style={{ display: 'inline-flex', color: 'var(--texto)', fontSize: 'inherit' }}>
            Escolher fotos
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { setFotos((f) => [...f, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
          {fotos.map((f, i) => (
            <span key={i} className="etiqueta neutra">{f.name}{' '}
              <button type="button" aria-label={`Tirar ${f.name}`} onClick={() => setFotos((x) => x.filter((_, j) => j !== i))}
                      style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}>×</button></span>
          ))}
          {fotos.length === 0 && <span className="suave pequeno">Opcional. Você também pode enviar depois, na página do evento.</span>}
        </div>
        <div className="linha">
          <label>Status<select {...campo('status')}><option value="planejamento">Planejamento</option><option value="confirmado">Confirmado</option></select></label>
          <label>Tolerância de atraso (min)<input type="number" {...campo('tolerancia_atraso_min')} /></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={ev.exige_qr}
            onChange={(e) => setEv((x: any) => ({ ...x, exige_qr: e.target.checked }))} />Check-in exige QR do supervisor</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={ev.exige_geolocalizacao}
            onChange={(e) => setEv((x: any) => ({ ...x, exige_geolocalizacao: e.target.checked }))} />Exigir localização (opcional)</label>
        </div>
        <label>Observações
          <textarea rows={3} maxLength={5000} placeholder="Ex.: Pausa para almoço das 12h às 14h. Entrada da equipe pela doca 3." {...campo('observacoes')} />
        </label>
      </section>

      {turnos.map((t, i) => (
        <section className="cartao form" key={i}>
          <div className="topo" style={{ marginBottom: 0 }}>
            <h2>Turno {i + 1}</h2>
            {turnos.length > 1 && <button type="button" className="btn pequeno perigo" onClick={() => setTurnos((ts) => ts.filter((_, j) => j !== i))}>Remover turno</button>}
          </div>
          <div className="linha">
            <label>Nome<input value={t.nome} onChange={(e) => mudaTurno(i, 'nome', e.target.value)} /></label>
            <label>Início *<input required type="datetime-local" value={t.inicio} onChange={(e) => mudaTurno(i, 'inicio', e.target.value)} /></label>
            <label>Fim *<input required type="datetime-local" value={t.fim} onChange={(e) => mudaTurno(i, 'fim', e.target.value)} /></label>
          </div>
          <div className="tabela">
            <table>
              <thead><tr><th>Função</th><th>Qtd</th><th>Diária paga</th><th>Diária cobrada</th><th>Altura mín. (cm)</th><th>Cabelo (opcional)</th><th>Uniforme</th><th></th></tr></thead>
              <tbody>
                {t.postos.map((p, j) => (
                  <tr key={j}>
                    <td><select required value={p.funcao_id} onChange={(e) => mudaPosto(i, j, 'funcao_id', e.target.value)}><option value="">—</option>{cat.funcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></td>
                    <td style={{ width: 80 }}><input type="number" min={1} value={p.quantidade} onChange={(e) => mudaPosto(i, j, 'quantidade', e.target.value)} /></td>
                    <td><input type="number" step="0.01" value={p.diaria_custo} onChange={(e) => mudaPosto(i, j, 'diaria_custo', e.target.value)} /></td>
                    <td><input type="number" step="0.01" value={p.diaria_venda} onChange={(e) => mudaPosto(i, j, 'diaria_venda', e.target.value)} /></td>
                    <td style={{ width: 100 }}><input type="number" step="any" placeholder="170" value={p.requisitos.altura_min ?? ''}
                      onChange={(e) => mudaPosto(i, j, 'requisitos', { ...p.requisitos, altura_min: e.target.value ? Number(e.target.value) : undefined })} /></td>
                    <td style={{ minWidth: 150 }}>
                      <select aria-label="Cor do cabelo" value={p.requisitos.cabelo_cores?.[0] ?? ''}
                              onChange={(e) => mudaPosto(i, j, 'requisitos', { ...p.requisitos, cabelo_cores: e.target.value ? [e.target.value] : undefined })}>
                        <option value="">Qualquer cor</option>{Object.entries(CORES_CABELO).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                      <select aria-label="Tipo de cabelo" style={{ marginTop: 4 }} value={p.requisitos.cabelo_tipos?.[0] ?? ''}
                              onChange={(e) => mudaPosto(i, j, 'requisitos', { ...p.requisitos, cabelo_tipos: e.target.value ? [e.target.value] : undefined })}>
                        <option value="">Qualquer tipo</option>{Object.entries(TIPOS_CABELO).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                    </td>
                    <td><input value={p.uniforme} onChange={(e) => mudaPosto(i, j, 'uniforme', e.target.value)} /></td>
                    <td>{t.postos.length > 1 && <button type="button" className="btn pequeno perigo"
                      onClick={() => mudaTurno(i, 'postos', t.postos.filter((_, b) => b !== j))}>×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button type="button" className="btn pequeno" onClick={() => mudaTurno(i, 'postos', [...t.postos, postoVazio()])}>+ Posto</button></div>
        </section>
      ))}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn" onClick={() => setTurnos((ts) => [...ts, { nome: `Turno ${ts.length + 1}`, inicio: '', fim: '', postos: [postoVazio()] }])}>+ Turno</button>
        <span className="suave">Custo previsto {custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · Venda {venda.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          {venda > 0 && ` · margem ${(100 * (venda - custo) / venda).toFixed(1)}%`}</span>
      </div>
      {erro && <div className="aviso erro">{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primario">Criar evento</button>
        <button type="button" className="btn" onClick={() => voltar('/eventos')}>Cancelar</button>
      </div>
    </form>
  );
}
