import type { Metadata } from 'next';
import Link from 'next/link';
import { Dado, PaginaLegal } from '@/components/legal/PaginaLegal';
import { PLATAFORMA, VERSAO_POLITICA, VIGENCIA } from '@/lib/legal';

export const metadata: Metadata = { title: 'Política de Privacidade · Cachet', description: 'Como o Cachet trata dados pessoais, com finalidades, bases legais, prazos e direitos dos titulares (LGPD).' };

const FINALIDADES: [string, string, string][] = [
  ['Avaliar a inscrição de Casting e convidar para trabalhos', 'Dados da inscrição, características físicas e fotos',
    'Consentimento (art. 7º, I). Para fotos e características que possam revelar origem racial ou étnica, como o tom de pele, consentimento específico e destacado (art. 11, I).'],
  ['Cadastrar o profissional, montar escalas e enviar convocações', 'Cadastro, funções, disponibilidade, escalas',
    'Execução de contrato e procedimentos preliminares a pedido do titular (art. 7º, V).'],
  ['Registrar e conferir a presença no evento', 'Horário do registro, código do QR, localização no momento do check-in',
    'Execução de contrato (art. 7º, V) e legítimo interesse na prevenção a fraudes (art. 7º, IX).'],
  ['Pagar os profissionais e faturar os clientes', 'CPF, chave PIX e dados bancários, valores, custos',
    'Execução de contrato (art. 7º, V) e cumprimento de obrigação legal (art. 7º, II).'],
  ['Guardar registros financeiros, de escala e de ponto', 'Pagamentos, escalas, apontamentos',
    'Cumprimento de obrigação legal (art. 7º, II) e exercício regular de direitos (art. 7º, VI).'],
  ['Avaliar o desempenho e sugerir profissionais para os próximos eventos', 'Avaliações, histórico de trabalhos',
    'Legítimo interesse (art. 7º, IX), com o profissional podendo se opor.'],
  ['Dar acesso ao sistema e proteger as contas', 'Nome, e-mail, perfil, senha (guardada só como resumo criptográfico), tentativas de login',
    'Execução de contrato (art. 7º, V) e legítimo interesse na segurança (art. 7º, IX).'],
  ['Manter o histórico de alterações', 'Quem alterou o quê e quando (sem valores de CPF, RG e dados bancários)',
    'Legítimo interesse (art. 7º, IX) e exercício regular de direitos (art. 7º, VI).'],
  ['Atender os pedidos dos titulares', 'Dados informados no pedido', 'Cumprimento de obrigação legal (art. 7º, II).'],
];

const PRAZOS: [string, string][] = [
  ['Inscrição de Casting pendente', 'Até a análise pela empresa.'],
  ['Inscrição de Casting reprovada', 'As fotos são apagadas na reprovação. Os demais dados são apagados automaticamente 180 dias depois da análise.'],
  ['Inscrição de Casting aprovada', 'Os dados passam para o cadastro do profissional.'],
  ['Cadastro do profissional', 'Enquanto durar a relação com a empresa. A pedido do titular, é excluído por anonimização, guardado apenas o que a lei obriga.'],
  ['Escalas, ponto e pagamentos', 'Pelo prazo exigido pela legislação fiscal e trabalhista, sem identificar a pessoa depois de uma exclusão.'],
  ['Contas de usuários das empresas', 'Enquanto a empresa usar o Cachet.'],
  ['Pedidos dos titulares', 'Pelo tempo necessário para comprovar o atendimento.'],
];

export default function Privacidade() {
  return (
    <PaginaLegal titulo="Política de Privacidade"
      resumo={<>Em poucas palavras: os dados servem para organizar o trabalho em eventos (casting, escala, presença e pagamento).
        Não vendemos dados, não usamos cookies de publicidade e você pode pedir acesso, correção ou exclusão a qualquer momento
        pela página <Link href="/privacidade/solicitacao">Seus direitos</Link>.</>}>
      <p className="suave">Versão {VERSAO_POLITICA}, vigente desde {VIGENCIA}. Esta política segue a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018, LGPD).</p>

      <h2>1. Quem trata os seus dados</h2>
      <p>O Cachet é um sistema usado por empresas de eventos para gerir casting, escalas, presença e financeiro. Cada empresa tem um espaço próprio e isolado.</p>
      <ul>
        <li><b>Dados de profissionais, candidatos de Casting, contatos de clientes e equipes de eventos:</b> a empresa de eventos que usa o Cachet é a <b>controladora</b>, quem decide como os dados são usados. O fornecedor do Cachet atua como <b>operador</b>, tratando os dados em nome dela e conforme as instruções dela.</li>
        <li><b>Dados de quem visita este site e dos usuários das empresas:</b> o fornecedor do Cachet é o controlador.</li>
      </ul>
      <p>Fornecedor do Cachet: <Dado valor={PLATAFORMA.razaoSocial} rotulo="razão social" />, CNPJ <Dado valor={PLATAFORMA.cnpj} rotulo="CNPJ" />, <Dado valor={PLATAFORMA.endereco} rotulo="endereço" />.</p>

      <h2>2. Quais dados tratamos</h2>
      <ul>
        <li><b>Candidatos de Casting:</b> nome, nome artístico, celular, e-mail, data de nascimento, gênero (opcional), redes sociais, cidade, UF, bairro, região de preferência, funções de interesse, medidas e características físicas (altura, manequim, camiseta, calçado, cabelo, olhos, tom de pele, tatuagem visível), locomoção, idiomas, experiência e fotos.</li>
        <li><b>Profissionais:</b> os dados acima e, quando necessários, CPF, RG, chave PIX e dados bancários (gravados com criptografia), documentos, disponibilidade, escalas, registros de entrada e saída (horário e localização no momento do registro), avaliações e pagamentos.</li>
        <li><b>Contatos de clientes:</b> nome, cargo, e-mail e telefone; CPF quando o cliente é pessoa física.</li>
        <li><b>Usuários das empresas:</b> nome, e-mail, perfil de acesso, senha (guardada apenas como resumo criptográfico), data do último acesso e histórico das ações no sistema.</li>
        <li><b>Visitantes do site:</b> não usamos cookies de publicidade nem ferramentas de análise de navegação. O endereço IP é usado no momento da requisição para limitar tentativas abusivas e não é guardado.</li>
      </ul>

      <h2>3. Para que usamos e com qual base legal</h2>
      <div className="tabela">
        <table className="legal-tabela">
          <thead><tr><th>Finalidade</th><th>Dados</th><th>Base legal (LGPD)</th></tr></thead>
          <tbody>{FINALIDADES.map(([f, d, b]) => <tr key={f}><td>{f}</td><td>{d}</td><td>{b}</td></tr>)}</tbody>
        </table>
      </div>
      <p>Os dados não são usados para finalidades diferentes destas sem uma nova base legal e, quando for o caso, um novo consentimento.</p>

      <h2>4. Dados sensíveis</h2>
      <p>Fotos e características como o tom de pele podem revelar origem racial ou étnica, que a LGPD trata como dado sensível. Por isso, na inscrição de Casting, o envio depende de consentimento específico e destacado, usado só para avaliar o perfil para trabalhos em eventos. Tom de pele e as demais características físicas são opcionais.</p>

      <h2>5. Com quem compartilhamos</h2>
      <ul>
        <li>Com a empresa de eventos à qual você se inscreveu ou para a qual trabalha.</li>
        <li>Com os clientes dos eventos, quando necessário para a operação (por exemplo, nome e função da equipe escalada).</li>
        <li>Com bancos e instituições de pagamento, no arquivo de pagamento por PIX.</li>
        <li>Com provedores de infraestrutura (hospedagem do sistema e do banco de dados), que atuam como operadores sob contrato.</li>
        <li>Com autoridades públicas, quando houver obrigação legal ou ordem judicial.</li>
      </ul>
      <p>Não vendemos nem alugamos dados pessoais.</p>

      <h2>6. Transferência internacional</h2>
      <p>Os provedores de nuvem que hospedam o Cachet podem armazenar ou processar dados fora do Brasil. Nesses casos, usamos provedores que oferecem garantias de proteção compatíveis com a LGPD, conforme o art. 33.</p>

      <h2>7. Por quanto tempo guardamos</h2>
      <div className="tabela">
        <table className="legal-tabela">
          <thead><tr><th>Dado</th><th>Prazo</th></tr></thead>
          <tbody>{PRAZOS.map(([d, p]) => <tr key={d}><td>{d}</td><td>{p}</td></tr>)}</tbody>
        </table>
      </div>

      <h2>8. Como protegemos</h2>
      <ul>
        <li>CPF, RG, chave PIX e dados bancários gravados com criptografia e visíveis só para quem tem a permissão de dados pessoais.</li>
        <li>Cada empresa enxerga apenas os próprios dados, com o isolamento feito no próprio banco de dados.</li>
        <li>Acesso por perfil: cada usuário vê só o que a função dele exige.</li>
        <li>Bloqueio de 15 minutos após 5 senhas erradas e conexão sempre criptografada (HTTPS).</li>
        <li>Histórico de alterações que registra que um dado pessoal mudou, sem guardar o valor.</li>
      </ul>

      <h2>9. Seus direitos</h2>
      <p>Pela LGPD (art. 18), você pode pedir, a qualquer momento:</p>
      <ul>
        <li>confirmação de que tratamos seus dados e acesso a eles;</li>
        <li>correção de dados incompletos, inexatos ou desatualizados;</li>
        <li>anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;</li>
        <li>portabilidade dos dados, em formato estruturado;</li>
        <li>eliminação dos dados tratados com base no seu consentimento;</li>
        <li>informação sobre com quem os dados são compartilhados;</li>
        <li>informação sobre a possibilidade de não consentir e as consequências disso;</li>
        <li>revogação do consentimento e oposição a tratamentos feitos com outras bases legais.</li>
      </ul>
      <p><b>Como pedir:</b> preencha a página <Link href="/privacidade/solicitacao">Seus direitos</Link>, escolhendo a empresa com quem você tem relação. Você recebe um número de protocolo, e a resposta sai em até 15 dias. Para sua segurança, a empresa pode pedir a confirmação da sua identidade antes de atender, e a cópia dos dados é enviada somente ao celular que consta no cadastro, por um link pessoal válido por 72 horas.</p>
      <p><b>Exclusão:</b> o cadastro é anonimizado. Fotos, documentos, contatos e características são apagados, e o histórico de alterações é limpo. Escalas e pagamentos já feitos continuam registrados sem identificar a pessoa, porque a lei obriga a guardá-los.</p>
      <p>Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>

      <h2>10. Consentimento</h2>
      <p>Quando o tratamento depende do seu consentimento (como na inscrição de Casting), registramos a data e a versão desta política que você aceitou. Você pode revogá-lo a qualquer momento pela página <Link href="/privacidade/solicitacao">Seus direitos</Link>. A revogação não invalida o que foi feito antes dela e, no Casting, leva à exclusão da inscrição.</p>

      <h2>11. Cookies e armazenamento no navegador</h2>
      <p>Usamos apenas o armazenamento necessário para o sistema funcionar (sessão, tema, link do profissional e registros de ponto sem internet). Veja os detalhes na <Link href="/cookies">Política de Cookies</Link>.</p>

      <h2>12. Crianças e adolescentes</h2>
      <p>A inscrição de Casting é exclusiva para maiores de 18 anos. O Cachet não é direcionado a menores de idade.</p>

      <h2>13. Encarregado pelo tratamento de dados</h2>
      <p>Para dados de profissionais, candidatos e contatos de uma empresa de eventos, fale primeiro com essa empresa, que é a controladora. Para dados do site e das contas de usuários, ou se não conseguir resposta: <Dado valor={PLATAFORMA.nomeEncarregado} rotulo="nome do encarregado" />, <Dado valor={PLATAFORMA.emailEncarregado} rotulo="e-mail do encarregado" />.</p>

      <h2>14. Alterações desta política</h2>
      <p>Quando esta política mudar, a versão e a data no topo são atualizadas. Mudanças que afetem tratamentos baseados em consentimento são informadas, e um novo consentimento é pedido quando necessário.</p>
    </PaginaLegal>
  );
}
