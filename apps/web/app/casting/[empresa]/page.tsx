'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiPublica, ErroApi } from '@/lib/api';
import { prepararFoto } from '@/lib/imagem';
import { LogoEmpresa, MarcaCachet } from '@/components/Marca';

/**
 * Inscrição de Casting da empresa (link público /casting/<código da empresa>).
 * A inscrição vai para a fila de triagem da empresa (módulo Captação); não entra direto no banco de talentos.
 */
const MEIOS: [string, string][] = [['carro_proprio', 'Carro próprio'], ['moto_propria', 'Moto própria'], ['transporte_publico', 'Transporte público'],
  ['aplicativo', 'Aplicativo'], ['bicicleta', 'Bicicleta'], ['a_pe', 'A pé'], ['carona', 'Carona']];
const TAMANHOS = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'];
const TIPOS_CABELO: [string, string][] = [['liso', 'Liso'], ['ondulado', 'Ondulado'], ['cacheado', 'Cacheado'], ['crespo', 'Crespo'], ['raspado', 'Raspado']];
const CORES_CABELO: [string, string][] = [['preto', 'Preto'], ['castanho', 'Castanho'], ['loiro', 'Loiro'], ['ruivo', 'Ruivo'], ['grisalho', 'Grisalho'], ['colorido', 'Colorido']];
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const MAX_FOTOS = 4;

type Foto = Awaited<ReturnType<typeof prepararFoto>> & { previa: string };

export default function Casting({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = use(params);
  const [dados, setDados] = useState<{ empresa: { nome: string; logo: string | null }; funcoes: { id: string; nome: string }[]; pracas: { id: string; nome: string; uf: string }[] } | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [f, setF] = useState<Record<string, any>>({ funcoes: [], meios_locomocao: [], uf: '' });
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [consentimento, setConsentimento] = useState(false);
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    apiPublica(`/casting/${encodeURIComponent(empresa)}`).then(setDados).catch(() => setIndisponivel(true));
  }, [empresa]);

  const muda = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const alterna = (k: 'funcoes' | 'meios_locomocao', v: string) =>
    setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x: string) => x !== v) : [...f[k], v] });

  async function escolherFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? []).slice(0, MAX_FOTOS - fotos.length);
    e.target.value = '';
    try {
      const novas = await Promise.all(arquivos.map(async (a) => {
        const p = await prepararFoto(a);
        return { ...p, previa: `data:image/jpeg;base64,${p.base64}` };
      }));
      setFotos([...fotos, ...novas]);
    } catch (er: any) { setErro(er.message); }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(''); setCampos({});
    if (!fotos.length) { setErro('Envie pelo menos uma foto.'); return; }
    if (!consentimento) { setErro('Para enviar, aceite o uso dos seus dados para o casting.'); return; }
    const num = (v: any) => (v === '' || v === undefined ? null : Number(String(v).replace(',', '.')));
    const corpo = {
      ...f,
      altura_cm: num(f.altura_cm), manequim: num(f.manequim), calcado: num(f.calcado),
      tamanho_camiseta: f.tamanho_camiseta || null, tipo_cabelo: f.tipo_cabelo || null, cor_cabelo: f.cor_cabelo || null,
      praca_base_id: f.praca_base_id || null,
      tatuagem_visivel: f.tatuagem_visivel === '' || f.tatuagem_visivel === undefined ? null : f.tatuagem_visivel === 'sim',
      idiomas: String(f.idiomas ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      redes_sociais: f.instagram ? { instagram: f.instagram } : {},
      instagram: undefined,
      fotos: fotos.map(({ nome_arquivo, tipo_mime, base64 }) => ({ nome_arquivo, tipo_mime, base64 })),
      consentimento: true,
    };
    setEnviando(true);
    try {
      await apiPublica(`/casting/${encodeURIComponent(empresa)}`, corpo);
      setEnviado(true);
      window.scrollTo({ top: 0 });
    } catch (er) {
      const x = er as ErroApi;
      setErro(x.message);
      if (x.dados?.campos) setCampos(Object.fromEntries(x.dados.campos.map((c: any) => [c.campo, c.mensagem])));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setEnviando(false); }
  }

  if (indisponivel) return (
    <div className="mobile" style={{ paddingTop: 48 }}>
      <div className="aviso erro">Este link de casting não está disponível. Confira o endereço com quem enviou.</div>
    </div>
  );
  if (!dados) return <div className="mobile suave" style={{ paddingTop: 48 }}>Carregando…</div>;

  const erroDe = (k: string) => campos[k] && <small style={{ color: 'var(--erro)' }}>{campos[k]}</small>;

  return (
    <div className="casting">
      <header className="casting-topo">
        <LogoEmpresa nome={dados.empresa.nome} logo={dados.empresa.logo} tamanho={44} />
        <div>
          <div className="suave pequeno">Casting</div>
          <strong>{dados.empresa.nome}</strong>
        </div>
      </header>

      {enviado ? (
        <div className="cartao" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: '3rem' }}>✓</div>
          <h1>Inscrição enviada!</h1>
          <p className="suave">A equipe da {dados.empresa.nome} vai analisar o seu perfil. Se ele combinar com os próximos trabalhos,
            você recebe o contato pelo WhatsApp no número informado.</p>
        </div>
      ) : (
        <form className="form" onSubmit={enviar} noValidate>
          <div>
            <h1>Faça parte do nosso casting</h1>
            <p className="suave">Preencha seus dados e envie fotos recentes. Leva uns 5 minutos. Campos com * são obrigatórios.</p>
          </div>
          {erro && <div className="aviso erro" role="alert">{erro}</div>}

          {/* campo escondido para robôs: pessoas não veem nem preenchem */}
          <input type="text" name="site" tabIndex={-1} autoComplete="off" aria-hidden="true" className="casting-isca"
                 value={f.site ?? ''} onChange={muda('site')} />

          <fieldset className="cartao form">
            <legend>Quem é você</legend>
            <label>Nome completo *<input value={f.nome ?? ''} onChange={muda('nome')} autoComplete="name" required maxLength={120} />{erroDe('nome')}</label>
            <label>Nome artístico<input value={f.nome_artistico ?? ''} onChange={muda('nome_artistico')} maxLength={120} /></label>
            <div className="linha">
              <label>Celular com WhatsApp *<input value={f.celular ?? ''} onChange={muda('celular')} inputMode="tel" autoComplete="tel" placeholder="(43) 99999-0000" required />{erroDe('celular')}</label>
              <label>E-mail<input type="email" value={f.email ?? ''} onChange={muda('email')} autoComplete="email" />{erroDe('email')}</label>
            </div>
            <div className="linha">
              <label>Data de nascimento *<input type="date" value={f.data_nascimento ?? ''} onChange={muda('data_nascimento')} required />{erroDe('data_nascimento')}</label>
              <label>Gênero<select value={f.genero ?? ''} onChange={muda('genero')}>
                <option value="">Prefiro não informar</option><option>Feminino</option><option>Masculino</option><option>Não binário</option>
              </select></label>
            </div>
            <label>Instagram<input value={f.instagram ?? ''} onChange={muda('instagram')} placeholder="@seuperfil" maxLength={200} /></label>
          </fieldset>

          <fieldset className="cartao form">
            <legend>Onde você mora</legend>
            <div className="linha">
              <label>Cidade *<input value={f.cidade ?? ''} onChange={muda('cidade')} autoComplete="address-level2" required maxLength={80} />{erroDe('cidade')}</label>
              <label>UF *<select value={f.uf} onChange={muda('uf')} required><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select>{erroDe('uf')}</label>
            </div>
            <label>Bairro<input value={f.bairro ?? ''} onChange={muda('bairro')} maxLength={80} /></label>
            {dados.pracas.length > 0 && (
              <label>Região onde prefere trabalhar<select value={f.praca_base_id ?? ''} onChange={muda('praca_base_id')}>
                <option value="">—</option>{dados.pracas.map((p) => <option key={p.id} value={p.id}>{p.nome} / {p.uf}</option>)}
              </select></label>
            )}
          </fieldset>

          <fieldset className="cartao form">
            <legend>Seu perfil</legend>
            {dados.funcoes.length > 0 && (
              <div>
                <div className="rotulo">Em quais funções quer trabalhar?</div>
                <div className="casting-opcoes">
                  {dados.funcoes.map((fn) => (
                    <button type="button" key={fn.id} className={`casting-opcao${f.funcoes.includes(fn.id) ? ' marcada' : ''}`}
                            aria-pressed={f.funcoes.includes(fn.id)} onClick={() => alterna('funcoes', fn.id)}>{fn.nome}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="linha">
              <label>Altura (cm)<input value={f.altura_cm ?? ''} onChange={muda('altura_cm')} inputMode="numeric" placeholder="170" />{erroDe('altura_cm')}</label>
              <label>Manequim<input value={f.manequim ?? ''} onChange={muda('manequim')} inputMode="numeric" placeholder="38" />{erroDe('manequim')}</label>
              <label>Camiseta<select value={f.tamanho_camiseta ?? ''} onChange={muda('tamanho_camiseta')}><option value="">—</option>{TAMANHOS.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>Calçado<input value={f.calcado ?? ''} onChange={muda('calcado')} inputMode="numeric" placeholder="37" />{erroDe('calcado')}</label>
            </div>
            <div className="linha">
              <label>Tipo de cabelo<select value={f.tipo_cabelo ?? ''} onChange={muda('tipo_cabelo')}><option value="">—</option>{TIPOS_CABELO.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
              <label>Cor do cabelo<select value={f.cor_cabelo ?? ''} onChange={muda('cor_cabelo')}><option value="">—</option>{CORES_CABELO.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
              <label>Cor dos olhos<input value={f.cor_olhos ?? ''} onChange={muda('cor_olhos')} maxLength={40} /></label>
              <label>Tom de pele<input value={f.tom_pele ?? ''} onChange={muda('tom_pele')} maxLength={40} /></label>
            </div>
            <label>Tatuagem visível?<select value={f.tatuagem_visivel ?? ''} onChange={muda('tatuagem_visivel')}><option value="">—</option><option value="sim">Sim</option><option value="nao">Não</option></select></label>
            <div>
              <div className="rotulo">Como você se locomove?</div>
              <div className="casting-opcoes">
                {MEIOS.map(([v, r]) => (
                  <button type="button" key={v} className={`casting-opcao${f.meios_locomocao.includes(v) ? ' marcada' : ''}`}
                          aria-pressed={f.meios_locomocao.includes(v)} onClick={() => alterna('meios_locomocao', v)}>{r}</button>
                ))}
              </div>
            </div>
            <label>Idiomas (separe por vírgula)<input value={f.idiomas ?? ''} onChange={muda('idiomas')} placeholder="Inglês, Espanhol" /></label>
            <label>Experiência com eventos<textarea rows={4} value={f.experiencia ?? ''} onChange={muda('experiencia')} maxLength={2000}
                   placeholder="Conte onde já trabalhou, em quais funções e por quanto tempo." /></label>
          </fieldset>

          <fieldset className="cartao form">
            <legend>Fotos *</legend>
            <p className="suave pequeno" style={{ margin: 0 }}>De 1 a {MAX_FOTOS} fotos recentes: uma de rosto e uma de corpo inteiro, sem filtro.</p>
            <div className="casting-fotos">
              {fotos.map((ft, i) => (
                <div key={i} className="casting-foto">
                  <img src={ft.previa} alt={`Foto ${i + 1}`} />
                  <button type="button" onClick={() => setFotos(fotos.filter((_, j) => j !== i))} aria-label={`Remover foto ${i + 1}`}>×</button>
                </div>
              ))}
              {fotos.length < MAX_FOTOS && (
                <label className="casting-foto casting-foto-nova">
                  <span>+ Adicionar foto</span>
                  <input type="file" accept="image/*" multiple onChange={escolherFotos} />
                </label>
              )}
            </div>
          </fieldset>

          <label className="casting-consentimento">
            <input type="checkbox" checked={consentimento} onChange={(e) => setConsentimento(e.target.checked)} />
            <span>
              Tenho 18 anos ou mais e autorizo a {dados.empresa.nome} a usar estes dados, <b>inclusive minhas fotos e características físicas</b>,
              somente para avaliar meu perfil e me convidar para trabalhos em eventos, conforme a <Link href="/privacidade" target="_blank">Política de Privacidade</Link>.
              Posso retirar a autorização e pedir a exclusão a qualquer momento em <Link href={`/privacidade/solicitacao?empresa=${empresa}`} target="_blank">Seus direitos</Link>.
            </span>
          </label>

          <button className="btn primario grande" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar inscrição'}</button>
        </form>
      )}
      <footer className="casting-rodape" style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
        <nav className="links-legais"><Link href="/privacidade">Privacidade</Link><Link href="/termos">Termos de uso</Link><Link href="/cookies">Cookies</Link><Link href={`/privacidade/solicitacao?empresa=${empresa}`}>Seus direitos</Link></nav>
        <MarcaCachet tamanho={20} />
      </footer>
    </div>
  );
}
