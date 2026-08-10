import {
  FIRST_TOUCH_MAX_BODY_CHARS,
  FIRST_TOUCH_PLAYBOOKS,
  type FirstTouchPlaybook,
} from '../outbound-first-touch.constants';

export type FirstTouchCopyContext = {
  companyName: string;
  leadName: string | null;
  product: string | null;
  city: string | null;
  value: string | null;
  notes: string | null;
  kbSnippet: string | null;
  playbook: string;
};

function greet(name: string | null): string {
  const n = name?.trim();
  return n ? `Oi, ${n.split(/\s+/)[0]}!` : 'Oi!';
}

function truncate(body: string): string {
  const t = body.replace(/\s+/g, ' ').trim();
  if (t.length <= FIRST_TOUCH_MAX_BODY_CHARS) return t;
  return `${t.slice(0, FIRST_TOUCH_MAX_BODY_CHARS - 1).trimEnd()}…`;
}

export function buildFirstTouchBody(ctx: FirstTouchCopyContext): string {
  const playbook = (ctx.playbook || FIRST_TOUCH_PLAYBOOKS.GENERIC) as FirstTouchPlaybook;
  const empresa = ctx.companyName.trim() || 'nossa equipe';
  const produto = ctx.product?.trim() || null;
  const cidade = ctx.city?.trim() || null;
  const valor = ctx.value?.trim() || null;
  const hi = greet(ctx.leadName);

  let core: string;
  switch (playbook) {
    case FIRST_TOUCH_PLAYBOOKS.FINANCEIRA:
      core = produto
        ? `${hi} Aqui é da ${empresa}. Vi que você pediu informações sobre ${produto}. Posso te explicar as opções — sem compromisso.${valor ? ` Ainda está pensando em algo perto de ${valor}?` : ' Qual valor você tem em mente?'}`
        : `${hi} Aqui é da ${empresa}. Vi que você pediu informações sobre crédito/consórcio. Posso te explicar as opções — sem compromisso. Qual valor você tem em mente?`;
      break;
    case FIRST_TOUCH_PLAYBOOKS.IMOBILIARIA:
      core = cidade
        ? `${hi} Vi seu interesse em imóveis em ${cidade}. Prefere 2 ou 3 quartos para eu filtrar opções?`
        : `${hi} Vi seu interesse em imóveis. Prefere 2 ou 3 quartos para eu filtrar opções na sua região?`;
      break;
    case FIRST_TOUCH_PLAYBOOKS.SOLAR:
      core = cidade
        ? `${hi} Aqui é da ${empresa}. Posso te mostrar uma estimativa de economia em ${cidade} — quer que eu te explique o próximo passo?`
        : `${hi} Aqui é da ${empresa}. Posso te mostrar uma estimativa de economia com energia solar — quer que eu te explique o próximo passo?`;
      break;
    case FIRST_TOUCH_PLAYBOOKS.ECOMMERCE:
      core = produto
        ? `${hi} Notei seu interesse em ${produto}. Ainda está disponível — quer que eu te passe as condições de pagamento de hoje?`
        : `${hi} Notei seu interesse em um dos nossos produtos. Ainda está disponível — quer que eu te passe as condições de hoje?`;
      break;
    default:
      core = produto
        ? `${hi} Aqui é da ${empresa}. Vi seu interesse em ${produto}${cidade ? ` (${cidade})` : ''}. Posso te ajudar com mais detalhes?`
        : `${hi} Aqui é da ${empresa}. Vi seu interesse e posso te ajudar com mais detalhes. Qual o melhor horário para conversarmos?`;
  }

  if (ctx.kbSnippet?.trim()) {
    const snip = ctx.kbSnippet.trim().slice(0, 160);
    core = `${core} ${snip}`;
  }

  return truncate(core);
}
