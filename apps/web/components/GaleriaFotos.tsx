'use client';
import { useEffect, useRef, useState } from 'react';
import { api, apiArquivoUrl, fmt } from '@/lib/api';
import { prepararFoto } from '@/lib/imagem';
import { Confirmar } from './Confirmar';

/**
 * Galeria de fotos protegidas: enviar (inclusive pela câmera do celular), ampliar e remover.
 *  - lista:   rota que lista (GET) e recebe (POST) as fotos
 *  - arquivo: rota da imagem (GET) e da remoção (DELETE)
 *  - principal: se informado, permite escolher a foto principal (POST nessa rota)
 */
export function GaleriaFotos({ lista, arquivo, principal, podeEditar, vazio, exemploLegenda }: {
  lista: string; arquivo: (id: string) => string; principal?: (id: string) => string;
  podeEditar: boolean; vazio: string; exemploLegenda: string;
}) {
  const [fotos, setFotos] = useState<any[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [legenda, setLegenda] = useState('');
  const [ampliada, setAmpliada] = useState<any>(null);
  const [remover, setRemover] = useState<any>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const carregar = () => api(lista).then(setFotos).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, [lista]); // eslint-disable-line react-hooks/exhaustive-deps

  // miniaturas: busca cada imagem com o token e guarda a URL local
  useEffect(() => {
    for (const f of fotos) {
      if (!urls[f.id]) apiArquivoUrl(arquivo(f.id)).then((u) => setUrls((x) => ({ ...x, [f.id]: u }))).catch(() => undefined);
    }
  }, [fotos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErro(''); setEnviando(true);
    try {
      for (const a of Array.from(arquivos)) {
        const foto = await prepararFoto(a);
        await api(lista, { method: 'POST', json: { ...foto, legenda: legenda.trim() || null } });
      }
      setLegenda('');
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function tornarPrincipal(f: any) {
    setErro('');
    try { await api(principal!(f.id), { method: 'POST' }); await carregar(); } catch (e: any) { setErro(e.message); }
  }

  return (
    <div>
      {podeEditar && (
        <div className="filtros" style={{ marginBottom: 10 }}>
          <label style={{ flex: '2 1 220px' }}>Legenda (opcional)<input value={legenda} placeholder={exemploLegenda} onChange={(e) => setLegenda(e.target.value)} /></label>
          <button type="button" className="btn primario" disabled={enviando} style={{ flex: '0 0 auto' }} onClick={() => entrada.current?.click()}>
            {enviando ? 'Enviando…' : 'Adicionar foto'}
          </button>
          <input ref={entrada} type="file" accept="image/*" multiple hidden onChange={(e) => enviar(e.target.files)} />
        </div>
      )}
      {erro && <div className="aviso erro" style={{ marginBottom: 10 }}>{erro}</div>}
      {fotos.length === 0 && <p className="suave pequeno">{vazio}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {fotos.map((f) => (
          <figure key={f.id} style={{ margin: 0 }}>
            <button type="button" onClick={() => setAmpliada(f)} title="Ver em tamanho grande"
                    style={{ position: 'relative', display: 'block', width: '100%', aspectRatio: '4 / 3', padding: 0, borderRadius: 8, overflow: 'hidden', background: 'var(--bg)', cursor: 'zoom-in',
                             border: f.principal ? '2px solid var(--primaria)' : '1px solid var(--borda)' }}>
              {urls[f.id]
                ? <img src={urls[f.id]} alt={f.legenda ?? f.nome_arquivo} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <span className="suave pequeno">carregando…</span>}
              {f.principal && <span className="etiqueta" style={{ position: 'absolute', top: 6, left: 6 }}>principal</span>}
            </button>
            <figcaption className="pequeno" style={{ marginTop: 4 }}>
              {f.legenda && <div>{f.legenda}</div>}
              <div className="suave">{fmt.data(f.enviado_em)}{f.enviado_por && ` · ${f.enviado_por.split(' ')[0]}`}</div>
              {podeEditar && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {principal && !f.principal && <button type="button" className="btn pequeno" onClick={() => tornarPrincipal(f)}>Tornar principal</button>}
                  <button type="button" className="btn pequeno perigo" onClick={() => setRemover(f)}>Remover</button>
                </div>
              )}
            </figcaption>
          </figure>
        ))}
      </div>

      {ampliada && (
        <div role="dialog" aria-modal="true" aria-label={ampliada.legenda ?? 'Foto'} onClick={() => setAmpliada(null)}
             style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50, cursor: 'zoom-out' }}>
          {urls[ampliada.id] && <img src={urls[ampliada.id]} alt={ampliada.legenda ?? ampliada.nome_arquivo} style={{ maxWidth: '100%', maxHeight: '88vh', borderRadius: 8 }} />}
          {ampliada.legenda && <div style={{ color: '#fff', marginTop: 8 }}>{ampliada.legenda}</div>}
        </div>
      )}
      {remover && (
        <Confirmar titulo="Remover foto?" rotulo="Sim, remover" perigo onCancelar={() => setRemover(null)}
                   onConfirmar={async () => { await api(arquivo(remover.id), { method: 'DELETE' }); setRemover(null); await carregar(); }}>
          <p>A foto {remover.legenda ? <strong>“{remover.legenda}”</strong> : 'selecionada'} será apagada.
            {remover.principal && ' Ela é a principal: a foto mais antiga que sobrar passa a ser a principal.'}</p>
        </Confirmar>
      )}
    </div>
  );
}
