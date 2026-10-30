'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

type Coordenadas = { latitude: number | null; longitude: number | null };

/**
 * Botão "Geolocalização": importa latitude/longitude pelo endereço (mapa) ou pela localização
 * atual do aparelho. Não há campo para digitar — as coordenadas só aparecem como resultado.
 * Elas alimentam o raio do check-in (exige_geolocalizacao).
 */
export function Geolocalizacao({ endereco, valor, onChange }: { endereco: string; valor: Coordenadas; onChange: (c: Coordenadas) => void }) {
  const [buscando, setBuscando] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState(false);
  const tem = valor.latitude != null && valor.longitude != null;

  async function peloEndereco() {
    setBuscando(true); setMsg(''); setErro(false);
    try {
      const r = await api(`/geolocalizacao?${new URLSearchParams({ endereco })}`);
      onChange({ latitude: r.latitude, longitude: r.longitude });
      setMsg(`Localizado: ${r.descricao}`);
    } catch (e: any) { setMsg(e.message); setErro(true); } finally { setBuscando(false); }
  }

  function peloAparelho() {
    if (!navigator.geolocation) { setMsg('Este navegador não informa a localização.'); setErro(true); return; }
    setBuscando(true); setMsg(''); setErro(false);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) });
        setMsg(`Localização atual do aparelho (precisão de ~${Math.round(p.coords.accuracy)} m).`); setBuscando(false);
      },
      () => { setMsg('Não foi possível obter a localização. Permita o acesso à localização no navegador.'); setErro(true); setBuscando(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn" disabled={buscando || endereco.trim().length < 5} onClick={peloEndereco}
                title={endereco.trim().length < 5 ? 'Preencha o endereço primeiro' : 'Buscar pelo endereço no mapa'}>
          {buscando ? 'Localizando…' : 'Geolocalização'}
        </button>
        <button type="button" className="btn pequeno" disabled={buscando} onClick={peloAparelho}>Minha localização atual</button>
        {tem && (
          <>
            <span className="etiqueta ok">📍 {valor.latitude!.toFixed(5)}, {valor.longitude!.toFixed(5)}</span>
            <a className="pequeno" target="_blank" rel="noopener noreferrer"
               href={`https://www.google.com/maps?q=${valor.latitude},${valor.longitude}`}>ver no mapa</a>
            <button type="button" className="btn pequeno perigo" onClick={() => { onChange({ latitude: null, longitude: null }); setMsg(''); }}>Limpar</button>
          </>
        )}
      </div>
      {msg && <div className="pequeno" style={{ color: erro ? 'var(--erro)' : 'var(--suave)' }}>{msg}</div>}
      {!tem && !msg && <div className="suave pequeno">Sem geolocalização, o check-in com localização registra onde a pessoa estava, mas não confere a distância até o local.</div>}
    </div>
  );
}
