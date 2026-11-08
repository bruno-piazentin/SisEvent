import type { Metadata } from 'next';
import Link from 'next/link';
import { Dado, PaginaLegal } from '@/components/legal/PaginaLegal';
import { PLATAFORMA, VIGENCIA } from '@/lib/legal';

export const metadata: Metadata = { title: 'Termos de Uso · Cachet', description: 'Regras de uso do Cachet para empresas, usuários e profissionais.' };

export default function Termos() {
  return (
    <PaginaLegal titulo="Termos de Uso"
      resumo={<>Estes termos valem para quem usa o Cachet: empresas de eventos, seus usuários, profissionais que acessam pelo link pessoal e candidatos de Casting.
        Ao usar o sistema, você concorda com eles e com a <Link href="/privacidade">Política de Privacidade</Link>.</>}>
      <p className="suave">Vigentes desde {VIGENCIA}.</p>

      <h2>1. O serviço</h2>
      <p>O Cachet é um sistema on-line de gestão de eventos e equipes de campo: casting, escala, convocação, check-in, fechamento e financeiro.
        É fornecido por <Dado valor={PLATAFORMA.razaoSocial} rotulo="razão social" />, CNPJ <Dado valor={PLATAFORMA.cnpj} rotulo="CNPJ" />.</p>

      <h2>2. Contas e acesso</h2>
      <ul>
        <li>Cada empresa recebe um espaço próprio e cadastra os próprios usuários, que respondem pelo sigilo da senha.</li>
        <li>O acesso é pessoal: não compartilhe login nem senha. Após 5 senhas erradas, o acesso fica bloqueado por 15 minutos.</li>
        <li>Profissionais acessam por um link pessoal enviado pela empresa. O link é individual e não deve ser repassado.</li>
      </ul>

      <h2>3. Responsabilidades da empresa que usa o Cachet</h2>
      <ul>
        <li>A empresa é a controladora dos dados dos profissionais, candidatos, clientes e equipes que cadastra, e responde pelo uso desses dados conforme a LGPD.</li>
        <li>Deve cadastrar apenas dados necessários e verdadeiros, ter base legal para cada tratamento e atender os pedidos dos titulares recebidos pelo sistema.</li>
        <li>Define quem acessa o quê, pelos perfis e permissões, e mantém atualizada a lista de usuários ativos.</li>
      </ul>

      <h2>4. Uso permitido</h2>
      <p>Não é permitido usar o Cachet para fins ilegais, enviar conteúdo ofensivo ou que viole direitos de terceiros, tentar acessar dados de outras empresas,
        contornar mecanismos de segurança, sobrecarregar o sistema de propósito ou copiar e revender o serviço.</p>

      <h2>5. Profissionais e candidatos de Casting</h2>
      <ul>
        <li>As informações e fotos enviadas devem ser verdadeiras e da própria pessoa. A inscrição é para maiores de 18 anos.</li>
        <li>A inscrição não garante convite nem contratação: a análise e a escolha são da empresa de eventos.</li>
        <li>Registros de presença (check-in e check-out) devem ser feitos pelo próprio profissional, no local do evento.</li>
      </ul>

      <h2>6. Disponibilidade e suporte</h2>
      <p>Trabalhamos para manter o Cachet disponível e seguro, com cópias de segurança. Pode haver interrupções para manutenção ou por falhas de terceiros (internet, hospedagem).
        Recursos novos podem ser incluídos e outros alterados, com aviso quando afetarem o uso.</p>

      <h2>7. Propriedade intelectual</h2>
      <p>O sistema, a marca Cachet e o código pertencem ao fornecedor. Os dados cadastrados pertencem à empresa e aos titulares, e podem ser exportados a pedido.</p>

      <h2>8. Suspensão e encerramento</h2>
      <p>O acesso pode ser suspenso em caso de violação destes termos, risco à segurança ou falta de pagamento, conforme o contrato com a empresa.
        No encerramento, a empresa pode pedir a exportação dos dados. Depois disso, eles são eliminados, ressalvado o que a lei obriga a guardar.</p>

      <h2>9. Responsabilidade</h2>
      <p>O fornecedor responde pelo funcionamento do sistema nos limites da lei e do contrato com a empresa. Não responde por decisões de negócio da empresa
        (escalas, pagamentos, contratações) nem por dados inseridos de forma incorreta pelos usuários.</p>

      <h2>10. Alterações e foro</h2>
      <p>Estes termos podem ser atualizados, com a data de vigência acima. Fica eleito o foro de <Dado valor={PLATAFORMA.foro} rotulo="cidade/UF do foro" />,
        ressalvado o direito do consumidor de propor ação no próprio domicílio.</p>
    </PaginaLegal>
  );
}
