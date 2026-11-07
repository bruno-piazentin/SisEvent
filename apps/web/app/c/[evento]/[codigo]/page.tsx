'use client';
import { use, useEffect, useState } from 'react';
import { apiPublica, fmt } from '@/lib/api';
import { lerToken } from '@/lib/token-profissional';
import { registrarPonto, ResultadoPonto } from '@/lib/ponto';
import { AvaliarEvento } from '@/components/Avaliacao';

/**
 * Página aberta quando o profissional aponta a câmera nativa do celular para o QR do supervisor.
 * Usa o link de acesso salvo no aparelho; pede só um toque para confirmar entrada ou saída.
 */
export default function CheckinPorQr({ params }: { params: Promise<{ evento: string; codigo: string }> }) {
  const { evento, codigo } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [conv, setConv] = useState<any>(null);
  const [res, setRes] = useState<ResultadoPonto | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [avaliado, setAvaliado] = useState('');
  const [nome, setNome] = useState('');

  useEffect(() => {
    const t = lerToken();
    setToken(t);
    if (!t) { setCarregado(true); return; }
    apiPublica(`/p/${t}`)
      .then((r) => {
        if (r.ok) setNome(r.profissional?.nome ?? '');
        setConv(r.ok ? r.convocacoes.find((c: any) => c.evento_id === evento && c.status === 'confirmado') : null);
      })
      .catch(() => setConv(undefined))   // sem internet: deixa registrar mesmo assim (vai para a fila)
      .finally(() => setCarregado(true));
  }, [evento]);

  async function registrar() {
    if (!token) return;
    setEnviando(true);
    const tipo = conv?.checkin_em ? 'checkout' : 'checkin';
    setRes(await registrarPonto({ token, evento_id: evento, tipo, codigo_qr: codigo, pedirLocalizacao: conv?.exige_geolocalizacao }));
    setEnviando(false);
  }

  if (!carregado) return <div className="mobile suave" style={{ paddingTop: 40 }}>Carregando…</div>;

  if (!token) return (
    <div className="mobile" style={{ paddingTop: 40 }}>
      <h2>Primeiro acesso neste celular</h2>
      <p>Abra o link de acesso que você recebeu pelo WhatsApp e depois escaneie o QR de novo.</p>
    </div>
  );

  if (res) return (
    <div className="mobile" style={{ paddingTop: 40, textAlign: 'center' }}>
      <div style={{ fontSize: '4rem' }}>{res.ok ? (res.offline ? '⏳' : '✓') : '!'}</div>
      <div className={`aviso ${res.ok ? (res.offline ? '' : 'ok') : 'erro'}`}>{res.mensagem}</div>
      {res.ok && !res.offline && res.em && <p className="suave">Registrado às {fmt.hora(res.em)}</p>}
      {/* saída registrada: a avaliação do evento é obrigatória (se sair daqui, fica pendente na página dele) */}
      {res.ok && !res.offline && res.tipo === 'checkout' && !conv?.nota_evento && (
        avaliado ? <div className="aviso ok" style={{ marginTop: 16 }}>{avaliado}</div>
          : <div className="convocacao" style={{ marginTop: 16, textAlign: 'left' }}>
              <AvaliarEvento token={token} eventoId={evento} evento={conv?.evento} onAvaliado={setAvaliado} />
            </div>
      )}
      <a className="btn grande" style={{ marginTop: 20 }} href={`/p/${token}`}>Ver meus eventos</a>
    </div>
  );

  if (conv === null) return (
    <div className="mobile" style={{ paddingTop: 40 }}>
      <div className="aviso erro">Não encontramos uma escala confirmada sua neste evento. Fale com o supervisor.</div>
      <a className="btn grande" style={{ marginTop: 20 }} href={`/p/${token}`}>Ver meus eventos</a>
    </div>
  );

  const tipo = conv?.checkin_em ? 'checkout' : 'checkin';
  return (
    <div className="mobile" style={{ paddingTop: 30 }}>
      {/* o ponto vai para o acesso salvo neste celular: mostrar de quem é evita registrar no nome de outra pessoa */}
      {nome && (
        <p className="pequeno">Registrando como <strong>{nome}</strong>. Não é você? Abra o seu link de acesso e toque em "Este celular é meu".</p>
      )}
      {conv && (
        <div className="convocacao">
          <div className="quando">{conv.evento}</div>
          <div>{conv.turno} · {fmt.hora(conv.inicio)} às {fmt.hora(conv.fim)} · {conv.funcao}</div>
          {conv.checkin_em && <div className="status-ponto" style={{ color: 'var(--ok)' }}>✓ Entrada às {fmt.hora(conv.checkin_em)}</div>}
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <button className={`btn grande ${tipo === 'checkin' ? 'campo' : 'primario'}`} disabled={enviando} onClick={registrar}>
          {enviando ? 'Enviando…' : tipo === 'checkin' ? 'Registrar minha entrada' : 'Registrar minha saída'}
        </button>
      </div>
      <p className="suave pequeno" style={{ textAlign: 'center' }}>O QR vale por 30 segundos. Se expirar, escaneie de novo.</p>
    </div>
  );
}
