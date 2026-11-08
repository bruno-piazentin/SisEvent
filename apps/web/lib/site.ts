// Contato comercial da página de apresentação (/). O número vem de NEXT_PUBLIC_WHATSAPP
// (só dígitos, com DDI e DDD, ex.: 5543999998888). Sem ele, o WhatsApp abre para escolher o contato.
const NUMERO = (process.env.NEXT_PUBLIC_WHATSAPP ?? '').replace(/\D/g, '');

export function linkWhatsApp(mensagem = 'Olá! Quero conhecer o Cachet e agendar uma demonstração.') {
  return `https://wa.me/${NUMERO}?text=${encodeURIComponent(mensagem)}`;
}
