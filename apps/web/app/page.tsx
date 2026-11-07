import type { Metadata } from 'next';
import { MarcaSisEvent } from '@/components/Marca';
import { BotaoEntrar } from '@/components/site/BotaoEntrar';
import { linkWhatsApp } from '@/lib/site';
import s from './site.module.css';

export const metadata: Metadata = {
  title: 'SisEvent · Casting, escala, check-in e financeiro do seu evento em um só lugar',
  description: 'Seu evento com gestão de casting, escala, check-in e financeiro, tudo em um único lugar. Do banco de talentos ao pagamento da equipe, com a margem de cada evento.',
};

/** Ícones de traço simples (24×24), na cor do texto */
const ICONES: Record<string, React.ReactNode> = {
  casting: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.2c2.3.2 4 1.8 4.5 4.8" /></>,
  escala: <><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 3v3M16 3v3M7.5 13.5h3M13.5 13.5h3M7.5 17h3" /></>,
  checkin: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2.5v2.5H14zM18 18h2v2M14 19.5h1.5M20 14v1.5" /></>,
  financeiro: <><path d="M4 18.5h16M6.5 15V10M11 15V7M15.5 15v-5.5M20 15V5" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" /></>,
  presenca: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  offline: <><path d="M5 9.5a10 10 0 0 1 14 0M8 12.8a5.6 5.6 0 0 1 8 0" /><circle cx="12" cy="16.5" r="1.3" /><path d="M3.5 3.5l17 17" /></>,
  bi: <><path d="M4 19.5h16" /><path d="M5 15l4-4 3.5 3 6.5-7" /><path d="M15 7h4v4" /></>,
  cadeado: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><path d="M12 14.5v2.5" /></>,
  estrela: <path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 16.3l-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" />,
  camera: <><path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5L16 6.5h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="3.5" /></>,
  perfil: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" /></>,
  whatsapp: <path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5zm-3 4.6c.2 0 .5 0 .7.5l.8 1.8c.1.2.1.4 0 .6l-.5.7c-.1.2-.2.3 0 .6.6 1 1.4 1.8 2.5 2.4.3.2.4.1.6-.1l.7-.8c.2-.2.4-.2.6-.1l1.8.8c.3.1.4.3.4.5 0 .6-.3 1.4-1 1.8-.7.4-1.6.5-3.6-.4a9 9 0 0 1-3.8-3.6c-.8-1.4-.8-2.5-.4-3.3.3-.7.8-1 1.2-1z" />,
};
function Icone({ nome, cheio }: { nome: keyof typeof ICONES; cheio?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill={cheio ? 'currentColor' : 'none'}
         stroke={cheio ? 'none' : 'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {ICONES[nome]}
    </svg>
  );
}

const ETAPAS = [
  { icone: 'casting', nome: 'Casting', titulo: 'O profissional certo para cada posto',
    itens: ['Banco de talentos com fotos, medidas, funções e documentos', 'Sugestão de quem combina com o posto: disponibilidade, praça, experiência e requisitos', 'Histórico de eventos e nota média de cada pessoa'] },
  { icone: 'escala', nome: 'Escala', titulo: 'Convocação que se confirma sozinha',
    itens: ['Turnos e postos com vagas, diária e requisitos', 'Convite pelo WhatsApp: o profissional aceita ou recusa pelo link', 'O sistema não deixa escalar a mesma pessoa em dois eventos no mesmo horário'] },
  { icone: 'checkin', nome: 'Check-in', titulo: 'Presença comprovada no local',
    itens: ['QR que muda a cada 30 segundos: foto antiga do código não vale', 'Localização conferida e atrasos calculados na hora', 'Funciona sem internet e envia quando o sinal volta'] },
  { icone: 'financeiro', nome: 'Financeiro', titulo: 'Do fechamento ao PIX, com a margem do evento',
    itens: ['Custo por profissional com hora extra, adicional noturno e descontos', 'Lote de pagamento pronto para o banco e fatura do cliente', 'Receita, custo e margem por evento e por cliente'] },
] as const;

const RECURSOS = [
  { icone: 'link', titulo: 'Sem aplicativo para instalar', texto: 'O profissional recebe um link no WhatsApp e, por ele, confirma presença, faz o check-in e acompanha os pagamentos.' },
  { icone: 'presenca', titulo: 'Presença em tempo real', texto: 'Quem chegou, quem está atrasado e quem faltou, atualizado sozinho durante o evento, com substituição em campo.' },
  { icone: 'offline', titulo: 'Feito para o campo', texto: 'Sinal fraco no local não trava a operação: o ponto fica guardado no celular e sobe depois.' },
  { icone: 'bi', titulo: 'Relatórios e indicadores', texto: 'Painel com os prazos dos eventos, calendário, comparativo mensal e relatórios para imprimir ou exportar em planilha.' },
  { icone: 'perfil', titulo: 'Cada um vê o que precisa', texto: 'Perfis de acesso por função: a central não vê margem, o supervisor só vê os eventos dele, o financeiro vê os valores.' },
  { icone: 'cadeado', titulo: 'Dados pessoais protegidos', texto: 'CPF, RG e chave PIX gravados com criptografia e visíveis só para quem tem permissão. Cada empresa enxerga apenas os próprios dados.' },
  { icone: 'estrela', titulo: 'Avaliação nos dois sentidos', texto: 'A equipe avalia cada profissional e o profissional avalia o evento. A nota entra na sugestão dos próximos castings.' },
  { icone: 'camera', titulo: 'Ocorrências e fotos do local', texto: 'Registro do que aconteceu em campo e fotos do local guardadas no evento, para consultar antes do próximo.' },
] as const;

const PASSOS = [
  { titulo: 'Monte o evento', texto: 'Cliente, local, turnos e postos com a quantidade de vagas, a diária e os requisitos de cada função.' },
  { titulo: 'Escale e convoque', texto: 'Escolha entre os profissionais sugeridos e envie o convite. A confirmação chega pelo próprio link.' },
  { titulo: 'Acompanhe e feche', texto: 'Check-in por QR no dia, presença ao vivo e, no fim, o fechamento gera os pagamentos e a margem.' },
];

const DUVIDAS = [
  { p: 'O profissional precisa instalar algum aplicativo?', r: 'Não. Ele recebe um link pessoal pelo WhatsApp e faz tudo pelo navegador do celular: aceita a convocação, registra entrada e saída e vê os pagamentos.' },
  { p: 'Como o sistema evita check-in feito de longe?', r: 'O QR mostrado na entrada muda a cada 30 segundos, então uma foto do código não serve depois. O sistema também confere a localização e marca para conferência o que foge do esperado.' },
  { p: 'E se não tiver internet no local do evento?', r: 'O check-in fica guardado no celular e é enviado assim que o sinal volta. Esse registro entra marcado para o supervisor conferir antes do fechamento.' },
  { p: 'Dá para controlar quem vê valores e dados pessoais?', r: 'Sim. Cada perfil tem suas permissões: margem e faturamento só para quem pode ver valores, e CPF, RG e dados bancários só para quem tem a permissão de dados pessoais.' },
  { p: 'Como funciona o pagamento da equipe?', r: 'Ao fechar o evento, o sistema calcula o valor de cada profissional e monta o lote de pagamento em arquivo pronto para o banco. Depois é só marcar como pago.' },
  { p: 'Quanto custa?', r: 'O valor depende do tamanho da sua equipe e dos módulos que você usar. Chame no WhatsApp para uma demonstração e uma proposta.' },
];

export default function PaginaSite() {
  const whatsapp = linkWhatsApp();
  return (
    <div className={s.site}>
      <header className={s.topo}>
        <div className={s.faixaTopo}>
          <a href="#inicio" className={s.marca} aria-label="SisEvent, início da página"><MarcaSisEvent tamanho={34} /></a>
          <nav className={s.nav} aria-label="Seções">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#duvidas">Dúvidas</a>
          </nav>
          <div className={s.acoesTopo}>
            <BotaoEntrar className={s.entrar} />
            <a href={whatsapp} className={`${s.botao} ${s.primario} ${s.soDesktop}`} target="_blank" rel="noopener noreferrer">Pedir demonstração</a>
          </div>
        </div>
      </header>

      <main>
        <section id="inicio" className={s.hero}>
          <div className={s.heroTexto}>
            <span className={s.selo}>Gestão de eventos e equipes de campo</span>
            <h1>Seu evento com gestão de <em>casting, escala, check-in e financeiro</em>, tudo em um único lugar.</h1>
            <p className={s.lead}>
              Do banco de talentos ao pagamento da equipe: o SisEvent organiza cada etapa da operação e mostra
              quanto cada evento deu de margem.
            </p>
            <div className={s.ctas}>
              <a href={whatsapp} className={`${s.botao} ${s.primario} ${s.grande}`} target="_blank" rel="noopener noreferrer">
                <Icone nome="whatsapp" cheio /> Pedir uma demonstração
              </a>
              <a href="#recursos" className={`${s.botao} ${s.grande}`}>Ver os recursos</a>
            </div>
            <ul className={s.pilulas} aria-label="Etapas cobertas">
              {ETAPAS.map((e) => <li key={e.nome}><Icone nome={e.icone} /> {e.nome}</li>)}
            </ul>
          </div>

          {/* ilustração montada com as telas do produto (dados fictícios) */}
          <div className={s.ilustracao} aria-hidden="true">
            <div className={s.janela}>
              <div className={s.janelaBarra}><i /><i /><i /><span>Escala · Festival de Inverno</span></div>
              <div className={s.janelaCorpo}>
                <div className={s.linhaTitulo}><b>Sábado · 18h às 01h</b><span className={s.chip}>8 de 8 vagas</span></div>
                {[
                  ['AN', 'Ana Souza', 'Promotora', 'Check-in 17:52', 'ok'],
                  ['BL', 'Bruno Lima', 'Promotor', 'Check-in 18:04', 'alerta'],
                  ['CM', 'Carla Mendes', 'Recepcionista', 'Confirmada', 'roxo'],
                  ['DO', 'Diego Oliveira', 'Segurança', 'Convidado', 'neutro'],
                ].map(([ini, nome, funcao, st, cor]) => (
                  <div key={nome} className={s.linhaPessoa}>
                    <span className={s.avatar}>{ini}</span>
                    <span className={s.pessoa}><b>{nome}</b><small>{funcao}</small></span>
                    <span className={`${s.status} ${s[cor]}`}>{st}</span>
                  </div>
                ))}
                <div className={s.resumoFinanceiro}>
                  <div><small>Receita</small><b>R$ 4.800</b></div>
                  <div><small>Custo da equipe</small><b>R$ 2.960</b></div>
                  <div><small>Margem</small><b className={s.verde}>38%</b></div>
                </div>
              </div>
            </div>
            <div className={s.celular}>
              <div className={s.celularTela}>
                <small>Registrar entrada</small>
                <div className={s.qr}>{Array.from({ length: 49 }, (_, i) => <i key={i} className={((i * 7 + (i % 5) * 3) % 4) ? '' : s.qrVazio} />)}</div>
                <span className={s.qrCodigo}>482 913</span>
                <small className={s.qrTempo}>muda em 30 s</small>
              </div>
            </div>
          </div>
        </section>

        <section id="recursos" className={s.secao}>
          <div className={s.cabecalhoSecao}>
            <span className={s.sobretitulo}>As quatro etapas</span>
            <h2>Uma operação inteira, sem planilha nem grupo de WhatsApp</h2>
            <p>Cada etapa conversa com a próxima: quem foi escalado faz o check-in, e quem fez o check-in entra no fechamento.</p>
          </div>
          <ol className={s.etapas}>
            {ETAPAS.map((e, i) => (
              <li key={e.nome} className={s.etapa}>
                <div className={s.etapaTopo}>
                  <span className={s.etapaIcone}><Icone nome={e.icone} /></span>
                  <span className={s.etapaNumero}>0{i + 1}</span>
                </div>
                <h3><span>{e.nome}</span>{e.titulo}</h3>
                <ul>{e.itens.map((t) => <li key={t}>{t}</li>)}</ul>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${s.secao} ${s.comparativo}`}>
          <div className={s.lado}>
            <h3>Sem o SisEvent</h3>
            <ul className={s.listaContra}>
              <li>Escala montada em planilha e confirmada mensagem por mensagem</li>
              <li>Lista de presença no papel e horário de chegada no “confia”</li>
              <li>A mesma pessoa escalada em dois eventos sem ninguém perceber</li>
              <li>Fechamento no fim do mês, refazendo conta de hora extra</li>
              <li>Margem do evento descoberta só depois de pagar todo mundo</li>
            </ul>
          </div>
          <div className={`${s.lado} ${s.ladoSim}`}>
            <h3>Com o SisEvent</h3>
            <ul className={s.listaPro}>
              <li>Convite pelo link e confirmação registrada no sistema</li>
              <li>Check-in por QR com horário, localização e atraso calculado</li>
              <li>Conflito de horário barrado no momento da escala</li>
              <li>Fechamento com hora extra, adicional noturno e descontos calculados</li>
              <li>Receita, custo e margem de cada evento e de cada cliente</li>
            </ul>
          </div>
        </section>

        <section className={s.secao}>
          <div className={s.cabecalhoSecao}>
            <span className={s.sobretitulo}>E mais</span>
            <h2>Pensado para quem vive a operação de eventos</h2>
          </div>
          <div className={s.grade}>
            {RECURSOS.map((r) => (
              <article key={r.titulo} className={s.recurso}>
                <span className={s.recursoIcone}><Icone nome={r.icone} /></span>
                <h3>{r.titulo}</h3>
                <p>{r.texto}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="como-funciona" className={`${s.secao} ${s.faixaRoxa}`}>
          <div className={s.cabecalhoSecao}>
            <span className={s.sobretitulo}>Como funciona</span>
            <h2>Do pedido do cliente ao pagamento da equipe em três passos</h2>
          </div>
          <ol className={s.passos}>
            {PASSOS.map((p, i) => (
              <li key={p.titulo}>
                <span className={s.passoNumero}>{i + 1}</span>
                <h3>{p.titulo}</h3>
                <p>{p.texto}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="duvidas" className={s.secao}>
          <div className={s.cabecalhoSecao}>
            <span className={s.sobretitulo}>Dúvidas frequentes</span>
            <h2>Perguntas que sempre aparecem</h2>
          </div>
          <div className={s.duvidas}>
            {DUVIDAS.map((d) => (
              <details key={d.p} className={s.duvida}>
                <summary>{d.p}</summary>
                <p>{d.r}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={s.final}>
          <h2>Casting, escala, check-in e financeiro do seu evento em um só lugar.</h2>
          <p>Mostramos o SisEvent funcionando com a rotina da sua empresa. Chame no WhatsApp.</p>
          <a href={whatsapp} className={`${s.botao} ${s.claro} ${s.grande}`} target="_blank" rel="noopener noreferrer">
            <Icone nome="whatsapp" cheio /> Falar no WhatsApp
          </a>
        </section>
      </main>

      <footer className={s.rodape}>
        <div className={s.rodapeFaixa}>
          <MarcaSisEvent tamanho={28} />
          <nav aria-label="Rodapé">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#duvidas">Dúvidas</a>
            <a href="/login">Entrar</a>
          </nav>
        </div>
        <p>
          © {new Date().getFullYear()} SisEvent · Desenvolvido by{' '}
          <a href="https://www.unnacomunicacao.com.br" target="_blank" rel="noopener noreferrer">UNNA</a>
        </p>
      </footer>

      {/* atalho fixo no celular */}
      <a href={whatsapp} className={s.flutuante} target="_blank" rel="noopener noreferrer" aria-label="Pedir demonstração pelo WhatsApp">
        <Icone nome="whatsapp" cheio />
      </a>
    </div>
  );
}
