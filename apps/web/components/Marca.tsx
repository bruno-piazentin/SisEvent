/** Símbolo do SisEvent (o mesmo desenho de public/icone.svg) */
export function IconeSisEvent({ tamanho = 32 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 512 512" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect width="512" height="512" rx="116" fill="#5b2a86" />
      <path d="M336 168H214a44 44 0 0 0 0 88h84a44 44 0 0 1 0 88H176" fill="none" stroke="#fff"
            strokeWidth="56" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="388" cy="126" r="34" fill="#ef6f4c" />
    </svg>
  );
}

/** Símbolo + nome do produto (login e rodapé do menu) */
export function MarcaSisEvent({ tamanho = 36 }: { tamanho?: number }) {
  return (
    <span className="marca-sisevent" style={{ fontSize: tamanho * 0.62 }}>
      <IconeSisEvent tamanho={tamanho} />
      <span>Sis<b>Event</b></span>
    </span>
  );
}

/** Logo da empresa cliente; sem logo cadastrado, mostra as iniciais do nome */
export function LogoEmpresa({ nome, logo, tamanho = 28 }: { nome: string; logo?: string | null; tamanho?: number }) {
  if (logo) return <img className="logo-empresa" src={logo} alt={nome} style={{ height: tamanho, maxWidth: tamanho * 4 }} />;
  const iniciais = nome.split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || nome.slice(0, 2).toUpperCase();
  return <span className="iniciais-empresa" style={{ width: tamanho, height: tamanho }}>{iniciais}</span>;
}
