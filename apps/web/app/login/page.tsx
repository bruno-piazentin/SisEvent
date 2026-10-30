'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, salvarSessao } from '@/lib/api';
import { Rodape } from '@/components/Rodape';

export default function Login() {
  const router = useRouter();
  const [empresa, setEmpresa] = useState('rafadutra');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(''); setEnviando(true);
    try {
      const r = await api('/auth/login', { method: 'POST', json: { empresa, email, senha } });
      salvarSessao(r);
      router.replace('/');
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', gridTemplateRows: '1fr auto', padding: 16 }}>
      <form className="cartao form" style={{ width: '100%', maxWidth: 380 }} onSubmit={entrar}>
        <div className="marca" style={{ padding: 0 }}><span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primaria)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>RD</span>SisEvent</div>
        <p className="suave" style={{ margin: 0 }}>Acesso da equipe interna. Profissionais entram pelo link recebido no WhatsApp.</p>
        <label>Empresa<input value={empresa} onChange={(e) => setEmpresa(e.target.value)} autoComplete="organization" /></label>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required /></label>
        {erro && <div className="aviso erro">{erro}</div>}
        <button className="btn primario" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <Rodape />
    </div>
  );
}
