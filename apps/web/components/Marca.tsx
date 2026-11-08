/** Símbolo do Cachet (o mesmo desenho de public/icone.svg): um "C" com a moeda do cachê na abertura */
export function IconeCachet({ tamanho = 32 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 512 512" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect width="512" height="512" rx="116" fill="#5b2a86" />
      <path d="M338 172a118 118 0 1 0 0 168" fill="none" stroke="#fff" strokeWidth="56" strokeLinecap="round" />
      <circle cx="364" cy="256" r="36" fill="#ef6f4c" />
    </svg>
  );
}

/** Símbolo + nome do produto (login e rodapé do menu) */
export function MarcaCachet({ tamanho = 36 }: { tamanho?: number }) {
  return (
    <span className="marca-sisevent" style={{ fontSize: tamanho * 0.62 }}>
      <IconeCachet tamanho={tamanho} />
      <span>Cachet</span>
    </span>
  );
}

/** Logo da empresa cliente; sem logo cadastrado, mostra as iniciais do nome */
export function LogoEmpresa({ nome, logo, tamanho = 28 }: { nome: string; logo?: string | null; tamanho?: number }) {
  if (logo) return <img className="logo-empresa" src={logo} alt={nome} style={{ height: tamanho, maxWidth: tamanho * 4 }} />;
  const iniciais = nome.split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || nome.slice(0, 2).toUpperCase();
  return <span className="iniciais-empresa" style={{ width: tamanho, height: tamanho }}>{iniciais}</span>;
}
