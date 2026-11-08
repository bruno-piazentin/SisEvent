'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, salvarSessao } from '@/lib/api';
import { Rodape } from '@/components/Rodape';
import { MarcaCachet } from '@/components/Marca';

export default function Login() {
  const router = useRouter();
  const [empresa, setEmpresa] = useState('');
  // lembra a última empresa usada neste navegador (o sistema atende várias)
  useEffect(() => { try { setEmpresa(localStorage.getItem('sisevent_empresa') ?? ''); } catch { /* sem armazenamento */ } }, []);
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
      try { localStorage.setItem('sisevent_empresa', empresa.trim().toLowerCase()); } catch { /* sem armazenamento */ }
      router.replace('/inicio');
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', gridTemplateRows: '1fr auto', padding: 16 }}>
      <form className="cartao form" style={{ width: '100%', maxWidth: 380 }} onSubmit={entrar}>
        <MarcaCachet tamanho={40} />
        <p className="suave" style={{ margin: 0 }}>Acesso da equipe interna. Profissionais entram pelo link recebido no WhatsApp.</p>
        <label>Empresa<input value={empresa} onChange={(e) => setEmpresa(e.target.value)} autoComplete="organization" placeholder="código da empresa, ex.: rafadutra" required /></label>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required /></label>
        {erro && <div className="aviso erro">{erro}</div>}
        <button className="btn primario" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <Rodape />
    </div>
  );
}
