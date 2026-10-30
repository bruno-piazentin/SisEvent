'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, DIAS } from '@/lib/api';
import { CORES_CABELO, TIPOS_CABELO } from '@/lib/ui';
import { CampoRedesSociais } from './RedesSociais';
import { GaleriaFotos } from './GaleriaFotos';
import { prepararFoto } from '@/lib/imagem';

const MEIOS: [string, string][] = [
  ['carro_proprio', 'Carro próprio'], ['moto_propria', 'Moto própria'], ['transporte_publico', 'Transporte público'],
  ['aplicativo', 'App (Uber/99)'], ['bicicleta', 'Bicicleta'], ['a_pe', 'A pé'], ['carona', 'Carona'],
];
const TAMANHOS = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'];

type Disp = { dia_semana: number; hora_inicio: string; hora_fim: string };

/** Ficha completa do profissional — criação e edição. */
export function FormProfissional({ inicial }: { inicial?: any }) {
  const router = useRouter();
  const [p, setP] = useState<any>(() => ({
    meios_locomocao: [], idiomas: ['português'], status: 'em_teste', ...inicial,
    data_nascimento: inicial?.data_nascimento?.slice(0, 10) ?? '',
    cnh_validade: inicial?.cnh_validade?.slice(0, 10) ?? '',
  }));
  const [funcoes, setFuncoes] = useState<{ funcao_id: string; nivel: number }[]>(
    inicial?.funcoes?.map((f: any) => ({ funcao_id: f.funcao_id, nivel: f.nivel })) ?? []);
  const [pracasAceitas, setPracasAceitas] = useState<string[]>(inicial?.pracas_aceitas?.map((x: any) => x.id) ?? []);
  const [disp, setDisp] = useState<Disp[]>(inicial?.disponibilidade ?? []);
  const [catalogo, setCatalogo] = useState<{ pracas: any[]; funcoes: any[] }>({ pracas: [], funcoes: [] });
  const [erro, setErro] = useState<string>('');
  const [salvando, setSalvando] = useState(false);
  const [fotos, setFotos] = useState<File[]>([]);

  useEffect(() => {
    Promise.all([api('/pracas'), api('/funcoes')]).then(([pracas, funcoes]) => setCatalogo({ pracas, funcoes }));
  }, []);

  const campo = (k: string, tipo: 'texto' | 'numero' = 'texto') => ({
    value: p[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setP((x: any) => ({ ...x, [k]: tipo === 'numero' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })),
  });

  const alternarMeio = (m: string) =>
    setP((x: any) => ({ ...x, meios_locomocao: x.meios_locomocao.includes(m) ? x.meios_locomocao.filter((y: string) => y !== m) : [...x.meios_locomocao, m] }));

  const alternarFuncao = (id: string) =>
    setFuncoes((fs) => (fs.some((f) => f.funcao_id === id) ? fs.filter((f) => f.funcao_id !== id) : [...fs, { funcao_id: id, nivel: 1 }]));

  const diaAtivo = (d: number) => disp.find((x) => x.dia_semana === d);
  const alternarDia = (d: number) =>
    setDisp((xs) => (diaAtivo(d) ? xs.filter((x) => x.dia_semana !== d) : [...xs, { dia_semana: d, hora_inicio: '08:00', hora_fim: '22:00' }]));
  const horaDia = (d: number, k: 'hora_inicio' | 'hora_fim', v: string) =>
    setDisp((xs) => xs.map((x) => (x.dia_semana === d ? { ...x, [k]: v } : x)));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(''); setSalvando(true);
    const limpo = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === '' ? null : v]));
    for (const k of ['id', 'tenant_id', 'criado_em', 'atualizado_em', 'consentimento_lgpd_em', 'origem', 'funcoes', 'pracas_aceitas',
      'disponibilidade', 'documentos', 'historico', 'avaliacoes', 'banco', 'agencia', 'conta']) delete limpo[k];
    // campos mascarados (sem permissão) não são reenviados
    for (const [k, v] of Object.entries(limpo)) if (typeof v === 'string' && v.includes('***')) delete limpo[k];
    if (limpo.peso_kg !== null && limpo.peso_kg !== undefined) limpo.peso_kg = Number(limpo.peso_kg); // numeric vem como texto
    const corpo = { ...limpo, funcoes, pracas_aceitas: pracasAceitas, disponibilidade: disp };
    try {
      const r = inicial?.id
        ? await api(`/profissionais/${inicial.id}`, { method: 'PATCH', json: corpo })
        : await api('/profissionais', { method: 'POST', json: corpo });
      const id = r.id ?? inicial.id;
      // fotos escolhidas no cadastro novo sobem depois que a ficha existe
      const falhas: string[] = [];
      for (const f of fotos) {
        try { await api(`/profissionais/${id}/fotos`, { method: 'POST', json: await prepararFoto(f) }); } catch { falhas.push(f.name); }
      }
      if (falhas.length) alert(`Ficha salva, mas estas fotos não foram enviadas: ${falhas.join(', ')}. Envie de novo na ficha.`);
      if (inicial?.id) window.location.href = `/profissionais/${id}`;   // a ficha estava aberta em modo edição na mesma rota
      else router.push(`/profissionais/${id}`);
    } catch (e: any) {
      setErro(e.dados?.campos ? e.dados.campos.map((c: any) => `${c.campo}: ${c.mensagem}`).join(' · ') : e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="grade" onSubmit={salvar}>
      <section className="cartao form">
        <h2>Dados pessoais</h2>
        <div className="linha">
          <label>Nome completo *<input required {...campo('nome')} /></label>
          <label>Nome artístico<input {...campo('nome_artistico')} /></label>
          <label>Nascimento<input type="date" {...campo('data_nascimento')} /></label>
          <label>Gênero
            <select {...campo('genero')}><option value="">—</option><option value="feminino">Feminino</option><option value="masculino">Masculino</option><option value="nao_binario">Não binário</option></select>
          </label>
        </div>
        <div className="linha">
          <label>CPF (só números)<input inputMode="numeric" maxLength={14} {...campo('cpf')} /></label>
          <label>RG<input {...campo('rg')} /></label>
          <label>Status
            <select {...campo('status')}><option value="em_teste">Em teste</option><option value="ativo">Ativo</option><option value="inativo">Inativo</option><option value="bloqueado">Bloqueado</option></select>
          </label>
        </div>
      </section>

      <section className="cartao form">
        <h2>Contato e base</h2>
        <div className="linha">
          <label>Celular (WhatsApp) *<input required placeholder="+5543999990000" {...campo('celular')} /></label>
          <label>E-mail<input type="email" {...campo('email')} /></label>
        </div>
        <div className="suave pequeno" style={{ fontWeight: 600 }}>Redes sociais</div>
        <CampoRedesSociais valor={p.redes_sociais} onChange={(v) => setP((x: any) => ({ ...x, redes_sociais: v }))} />
        <div className="linha">
          <label>Cidade<input {...campo('cidade')} /></label>
          <label>UF<input maxLength={2} {...campo('uf')} /></label>
          <label>Bairro<input {...campo('bairro')} /></label>
          <label>Praça base
            <select {...campo('praca_base_id')}><option value="">—</option>{catalogo.pracas.map((x) => <option key={x.id} value={x.id}>{x.nome}/{x.uf}</option>)}</select>
          </label>
        </div>
        <div>
          <div className="suave pequeno" style={{ fontWeight: 600, marginBottom: 6 }}>Também aceita trabalhar em</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {catalogo.pracas.filter((x) => x.id !== p.praca_base_id).map((x) => (
              <button type="button" key={x.id} className={`btn pequeno ${pracasAceitas.includes(x.id) ? 'primario' : ''}`}
                      onClick={() => setPracasAceitas((a) => (a.includes(x.id) ? a.filter((y) => y !== x.id) : [...a, x.id]))}>{x.nome}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="cartao form">
        <h2>Medidas e aparência</h2>
        <div className="linha">
          <label>Altura (cm)<input type="number" {...campo('altura_cm', 'numero')} /></label>
          <label>Peso (kg)<input type="number" step="0.1" {...campo('peso_kg', 'numero')} /></label>
          <label>Manequim<input type="number" {...campo('manequim', 'numero')} /></label>
          <label>Camiseta<select {...campo('tamanho_camiseta')}><option value="">—</option>{TAMANHOS.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Calçado<input type="number" {...campo('calcado', 'numero')} /></label>
        </div>
        <div className="linha">
          <label>Busto (cm)<input type="number" {...campo('busto_cm', 'numero')} /></label>
          <label>Cintura (cm)<input type="number" {...campo('cintura_cm', 'numero')} /></label>
          <label>Quadril (cm)<input type="number" {...campo('quadril_cm', 'numero')} /></label>
          <label>Olhos<input {...campo('cor_olhos')} /></label>
        </div>
        <div className="linha">
          <label>Tipo de cabelo
            <select {...campo('tipo_cabelo')}><option value="">—</option>
              {Object.entries(TIPOS_CABELO).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
          </label>
          <label>Cor do cabelo
            <select {...campo('cor_cabelo')}><option value="">—</option>
              {Object.entries(CORES_CABELO).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
          </label>
        </div>
      </section>

      <section className="cartao form">
        <h2>Funções</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {catalogo.funcoes.map((f) => {
            const sel = funcoes.find((x) => x.funcao_id === f.id);
            return (
              <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" className={`btn pequeno ${sel ? 'primario' : ''}`} onClick={() => alternarFuncao(f.id)}>{f.nome}</button>
                {sel && (
                  <select style={{ width: 'auto' }} value={sel.nivel}
                          onChange={(e) => setFuncoes((fs) => fs.map((x) => (x.funcao_id === f.id ? { ...x, nivel: Number(e.target.value) } : x)))}>
                    <option value={1}>Iniciante</option><option value={2}>Experiente</option><option value={3}>Líder</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="cartao form">
        <h2>Disponibilidade semanal</h2>
        <p className="suave pequeno" style={{ margin: 0 }}>Usada no cruzamento com os turnos. Para virar a madrugada, use fim menor que início (ex.: 18:00 → 02:00).</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {DIAS.map((nome, d) => {
            const a = diaAtivo(d);
            return (
              <div key={d} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 8, alignItems: 'center' }}>
                <button type="button" className={`btn pequeno ${a ? 'primario' : ''}`} onClick={() => alternarDia(d)}>{nome}</button>
                <input type="time" disabled={!a} value={a?.hora_inicio ?? ''} onChange={(e) => horaDia(d, 'hora_inicio', e.target.value)} />
                <input type="time" disabled={!a} value={a?.hora_fim ?? ''} onChange={(e) => horaDia(d, 'hora_fim', e.target.value)} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="cartao form">
        <h2>Locomoção</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {MEIOS.map(([k, rot]) => (
            <button type="button" key={k} className={`btn pequeno ${p.meios_locomocao.includes(k) ? 'primario' : ''}`} onClick={() => alternarMeio(k)}>{rot}</button>
          ))}
        </div>
        <div className="linha">
          <label>CNH (categoria)<input placeholder="B, AB…" {...campo('cnh_categoria')} /></label>
          <label>Validade da CNH<input type="date" {...campo('cnh_validade')} /></label>
          <label>Raio de deslocamento (km)<input type="number" {...campo('raio_km', 'numero')} /></label>
        </div>
      </section>

      <section className="cartao form">
        <h2>Outras informações</h2>
        <div className="linha">
          <label>Restrições alimentares<input {...campo('restricoes_alimentares')} /></label>
          <label>Idiomas (separados por vírgula)
            <input value={(p.idiomas ?? []).join(', ')} onChange={(e) => setP((x: any) => ({ ...x, idiomas: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
          </label>
        </div>
        <label>Experiência<textarea rows={3} {...campo('experiencia')} /></label>
        <label>Observações internas (não aparecem para o profissional)<textarea rows={2} {...campo('observacoes_internas')} /></label>
      </section>

      <section className="cartao form">
        <h2>Pagamento</h2>
        <div className="linha">
          <label>Forma de contratação
            <select {...campo('forma_contratacao')}><option value="">—</option><option value="autonomo">Autônomo (RPA)</option><option value="mei">MEI</option><option value="clt">CLT</option></select>
          </label>
          <label>Chave PIX<input {...campo('chave_pix')} /></label>
          <label>CNPJ MEI<input {...campo('cnpj_mei')} /></label>
        </div>
      </section>

      <section className="cartao form">
        <h2>Fotos</h2>
        {inicial?.id ? (
          <GaleriaFotos lista={`/profissionais/${inicial.id}/fotos`} arquivo={(f) => `/profissionais/${inicial.id}/fotos/${f}`}
                        principal={(f) => `/profissionais/${inicial.id}/fotos/${f}/principal`} podeEditar
                        vazio="Nenhuma foto enviada." exemploLegenda="Ex.: rosto, corpo inteiro, uniforme…" />
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="btn" style={{ display: 'inline-flex', color: 'var(--texto)', fontSize: 'inherit' }}>
              Escolher fotos
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { setFotos((f) => [...f, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
            </label>
            {fotos.map((f, i) => (
              <span key={i} className="etiqueta neutra">{i === 0 && '★ '}{f.name}{' '}
                <button type="button" aria-label={`Tirar ${f.name}`} onClick={() => setFotos((x) => x.filter((_, j) => j !== i))}
                        style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}>×</button></span>
            ))}
            <span className="suave pequeno">{fotos.length ? 'A primeira (★) será a foto principal. As fotos sobem ao salvar a ficha.' : 'Opcional. Também dá para enviar depois, na ficha.'}</span>
          </div>
        )}
      </section>

      {erro && <div className="aviso erro">{erro}</div>}
      <div><button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar ficha'}</button></div>
    </form>
  );
}
