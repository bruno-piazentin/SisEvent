'use client';
import { use, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, sessao } from '@/lib/api';

/**
 * Tela do supervisor: QR rotativo em tela cheia (celular ou tablet no local do evento).
 * O profissional aponta a câmera do celular → abre /c/<evento>/<codigo> → check-in.
 * O código troca a cada 30 s; também aparece em números para digitar se a câmera falhar.
 */
export default function TelaQr({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [qr, setQr] = useState<{ evento: string; codigo: string; url: string; expira_em_segundos: number } | null>(null);
  const [img, setImg] = useState('');
  const [restante, setRestante] = useState(30);
  const [erro, setErro] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!sessao()) { window.location.href = '/login'; return; }
    let ativo = true;
    async function buscar() {
      try {
        const r = await api(`/eventos/${id}/qr`);
        if (!ativo) return;
        setQr(r); setErro('');
        setImg(await QRCode.toDataURL(r.url, { margin: 1, width: 600, errorCorrectionLevel: 'M' }));
        setRestante(r.expira_em_segundos);
        // busca o próximo código logo depois da virada
        timer.current = setTimeout(buscar, (r.expira_em_segundos + 1) * 1000);
      } catch (e: any) {
        setErro(e.message);
        timer.current = setTimeout(buscar, 5000);
      }
    }
    buscar();
    const relogio = setInterval(() => setRestante((s) => Math.max(0, s - 1)), 1000);
    // mantém a tela acesa onde o navegador permitir
    (navigator as any).wakeLock?.request?.('screen').catch(() => undefined);
    return () => { ativo = false; clearTimeout(timer.current); clearInterval(relogio); };
  }, [id]);

  return (
    <div className="qr-tela">
      <div>
        <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: 6 }}>{qr?.evento ?? 'Carregando…'}</div>
        <div style={{ color: '#666', marginBottom: 14 }}>Aponte a câmera do celular para registrar entrada ou saída</div>
        {img && <img src={img} alt="QR code de check-in" />}
        <div className="qr-contador"><div style={{ width: `${(restante / 30) * 100}%` }} /></div>
        <div style={{ color: '#666' }}>ou digite o código</div>
        <div className="qr-codigo">{qr?.codigo ?? '——————'}</div>
        {erro && <div className="aviso erro" style={{ marginTop: 12 }}>{erro}</div>}
      </div>
    </div>
  );
}
