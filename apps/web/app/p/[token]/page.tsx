'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { apiPublica, fmt } from '@/lib/api';
import { salvarToken } from '@/lib/token-profissional';
import { pendentes, sincronizar, ouvirConexao } from '@/lib/fila-offline';
import { interpretarQr, leitorDisponivel, lerQrDaCamera, registrarPonto } from '@/lib/ponto';

/**
 * Área do profissional — aberta pelo link recebido no WhatsApp. Sem senha, sem instalar nada.
 * Aqui ele aceita convocações, faz check-in/check-out e vê o histórico de pagamentos.
 */
export default function AreaProfissional({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [fila, setFila] = useState(0);

  const carregar = useCallback(async () => {
    try {
      const r = await apiPublica(`/p/${token}`);
      if (!r.ok) { setErro('Este link expirou ou não é mais válido. Peça um novo para a coordenação.'); return; }
      setDados(r); setErro('');
    } catch (e: any) {
      setErro(navigator.onLine ? e.message : 'Sem internet no momento. Seus registros de ponto ficam guardados no celular.');
    }
  }, [token]);

  const sync = useCallback(async () => {
    const r = await sincronizar();
    setFila(pendentes().length);
    if (r.enviados) { setAviso({ ok: true, texto: `${r.enviados} registro(s) enviados.` }); carregar(); }
  }, [carregar]);

  useEffect(() => {
    salvarToken(token);
    setFila(pendentes().length);
    carregar().then(sync);
    const parar = ouvirConexao(sync);
    const t = setInterval(sync, 30_000);
    return () => { parar(); clearInterval(t); };
  }, [token, carregar, sync]);

  async function responder(c: any, aceita: boolean) {
    const motivo = aceita ? undefined : prompt('Quer contar o motivo? (opcional)') ?? undefined;
    const r = await apiPublica(`/p/${token}/responder`, { alocacao_id: c.alocacao_id, aceita, motivo });
    setAviso({ ok: r.ok, texto: r.ok ? (aceita ? 'Presença confirmada. Obrigado!' : 'Recusa registrada.') : r.mensagem });
    carregar();
  }

  if (erro && !dados) return <div className="mobile"><div className="aviso erro" style={{ marginTop: 40 }}>{erro}</div></div>;
  if (!dados) return <div className="mobile suave" style={{ paddingTop: 40 }}>Carregando…</div>;

  const pendentesResposta = dados.convocacoes.filter((c: any) => c.status === 'convidado');
  const confirmadas = dados.convocacoes.filter((c: any) => c.status === 'confirmado');

  return (
    <div className="mobile">
      <div className="suave pequeno">Rafa Dutra Eventos</div>
      <div className="saudacao">Olá, {dados.profissional.nome.split(' ')[0]}!</div>

      {fila > 0 && <div className="aviso" style={{ marginTop: 10 }}>{fila} registro(s) aguardando internet para enviar.</div>}
      {aviso && <div className={`aviso ${aviso.ok ? 'ok' : 'erro'}`} style={{ marginTop: 10 }}>{aviso.texto}</div>}

      {pendentesResposta.length > 0 && <h2 style={{ marginTop: 20 }}>Novas convocações</h2>}
      {pendentesResposta.map((c: any) => (
        <div className="convocacao" key={c.alocacao_id}>
          <Cabecalho c={c} />
          <div className="acoes duas">
            <button className="btn grande primario" onClick={() => responder(c, true)}>Confirmo</button>
            <button className="btn grande" onClick={() => responder(c, false)}>Não posso</button>
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 20 }}>Meus próximos eventos</h2>
      {confirmadas.length === 0 && <p className="suave">Nenhum evento confirmado no momento.</p>}
      {confirmadas.map((c: any) => (
        <div className="convocacao" key={c.alocacao_id}>
          <Cabecalho c={c} />
          <Ponto token={token} c={c} aoRegistrar={(r) => { setAviso({ ok: r.ok, texto: r.mensagem }); setFila(pendentes().length); carregar(); }} />
        </div>
      ))}

      {dados.pagamentos.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Pagamentos</h2>
          <div className="convocacao">
            {dados.pagamentos.map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--borda)' }}>
                <span>{p.evento}</span>
                <span><strong>{fmt.moeda(p.valor)}</strong> <span className={`etiqueta ${p.status === 'pago' ? 'ok' : 'alerta'}`}>{p.status === 'pago' ? 'pago' : 'a receber'}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="suave pequeno" style={{ marginTop: 28, textAlign: 'center' }}>
        Dica: adicione esta página à tela inicial do celular para abrir mais rápido.
      </p>
    </div>
  );
}

function Cabecalho({ c }: { c: any }) {
  return (
    <>
      <div className="quando">{fmt.diaSemana(c.inicio)}</div>
      <div style={{ fontWeight: 600 }}>{fmt.hora(c.inicio)} às {fmt.hora(c.fim)} · {c.funcao}</div>
      <div style={{ marginTop: 6 }}>{c.evento}{c.marca && ` — ${c.marca}`}</div>
      <div className="suave pequeno">{c.local}{c.endereco && ` · ${c.endereco}`}</div>
      {c.uniforme && <div className="pequeno" style={{ marginTop: 4 }}>Uniforme: {c.uniforme}</div>}
      <div className="pequeno" style={{ marginTop: 4 }}>Diária: {fmt.moeda(c.diaria)}</div>
    </>
  );
}

function Ponto({ token, c, aoRegistrar }: { token: string; c: any; aoRegistrar: (r: any) => void }) {
  const [codigo, setCodigo] = useState('');
  const [lendo, setLendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const abortar = useRef<AbortController>(undefined);

  const inicio = new Date(c.inicio).getTime();
  const fim = new Date(c.fim).getTime();
  const agora = Date.now();
  const janelaAberta = agora >= inicio - 2 * 3600_000 && agora <= fim + 4 * 3600_000;
  const tipo: 'checkin' | 'checkout' = c.checkin_em ? 'checkout' : 'checkin';

  if (c.checkout_em) return <div className="status-ponto" style={{ color: 'var(--ok)' }}>✓ Entrada {fmt.hora(c.checkin_em)} · saída {fmt.hora(c.checkout_em)}</div>;
  if (!janelaAberta) return <div className="status-ponto suave">O check-in abre 2 h antes do início.</div>;

  async function enviar(cod?: string | null) {
    setEnviando(true);
    const r = await registrarPonto({ token, evento_id: c.evento_id, tipo, codigo_qr: cod ?? null, pedirLocalizacao: c.exige_geolocalizacao });
    setEnviando(false);
    setCodigo('');
    aoRegistrar(r);
  }

  async function lerCamera() {
    if (!video.current) return;
    setLendo(true);
    abortar.current = new AbortController();
    try {
      const texto = await lerQrDaCamera(video.current, abortar.current.signal);
      const q = texto && interpretarQr(texto);
      if (q) await enviar(q.codigo);
    } catch {
      aoRegistrar({ ok: false, mensagem: 'Não foi possível abrir a câmera. Digite o código mostrado pelo supervisor.' });
    } finally { setLendo(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      {c.checkin_em && <div className="status-ponto" style={{ color: 'var(--ok)' }}>✓ Entrada às {fmt.hora(c.checkin_em)}</div>}
      {c.exige_qr ? (
        <div className="acoes">
          <div className="suave pequeno">Para registrar a {tipo === 'checkin' ? 'entrada' : 'saída'}, aponte a câmera do celular para o QR do supervisor, ou digite o código:</div>
          <input className="codigo-digitado" inputMode="numeric" maxLength={6} placeholder="000000" value={codigo}
                 onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
          <button className={`btn grande ${tipo === 'checkin' ? 'campo' : 'primario'}`} disabled={codigo.length !== 6 || enviando} onClick={() => enviar(codigo)}>
            {enviando ? 'Enviando…' : tipo === 'checkin' ? 'Registrar entrada' : 'Registrar saída'}
          </button>
          {leitorDisponivel() && !lendo && <button className="btn grande" onClick={lerCamera}>Ler QR com a câmera</button>}
          <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 12, display: lendo ? 'block' : 'none' }} />
          {lendo && <button className="btn" onClick={() => abortar.current?.abort()}>Cancelar leitura</button>}
        </div>
      ) : (
        <div className="acoes">
          <button className={`btn grande ${tipo === 'checkin' ? 'campo' : 'primario'}`} disabled={enviando} onClick={() => enviar()}>
            {enviando ? 'Enviando…' : tipo === 'checkin' ? 'Registrar entrada' : 'Registrar saída'}
          </button>
        </div>
      )}
    </div>
  );
}
