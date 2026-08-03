export type SuggestPromptTone = 'professional' | 'friendly' | 'concise';

export type SuggestPromptMessage = {
  direction: 'INBOUND' | 'OUTBOUND' | string;
  body: string;
};

export type SuggestPromptLead = {
  name: string | null;
  phone: string;
  status: string;
  source: string;
};

export type BuildSuggestPromptInput = {
  lead: SuggestPromptLead;
  messages: SuggestPromptMessage[];
  tone: SuggestPromptTone;
  instruction?: string;
};

export const SUGGEST_REPLY_SYSTEM_PROMPT = `Você é um assistente de atendimento via WhatsApp para uma empresa brasileira.
Regras obrigatórias:
- Responda sempre em português do Brasil (pt-BR).
- Escreva UMA única mensagem pronta para envio ao cliente.
- Seja claro, educado e objetivo.
- NÃO invente preços, prazos, políticas, disponibilidade ou dados que não estejam no contexto.
- NÃO peça CPF, senha, cartão ou dados sensíveis desnecessários.
- NÃO mencione que você é uma IA, a menos que o cliente pergunte.
- NÃO use markdown, listas longas ou assinare com nome fictício.
- Se faltar informação para responder com segurança, faça UMA pergunta objetiva de esclarecimento.
- Não altere status de lead nem execute ações; apenas sugira o texto da resposta.`;

export function buildSuggestUserPrompt(input: BuildSuggestPromptInput): string {
  const toneLabel: Record<SuggestPromptTone, string> = {
    professional: 'profissional',
    friendly: 'amigável',
    concise: 'conciso',
  };

  const leadLines = [
    `Nome: ${input.lead.name ?? '(não informado)'}`,
    `Telefone: ${input.lead.phone}`,
    `Status: ${input.lead.status}`,
    `Origem: ${input.lead.source}`,
  ].join('\n');

  const history = input.messages
    .map((m, i) => {
      const role = m.direction === 'INBOUND' ? 'CLIENTE' : 'EMPRESA';
      return `${i + 1}. [${role}] ${m.body}`;
    })
    .join('\n');

  const parts = [
    '### Dados do lead',
    leadLines,
    '',
    '### Histórico recente da conversa',
    history || '(sem mensagens)',
    '',
    `### Tom desejado: ${toneLabel[input.tone]}`,
  ];

  if (input.instruction?.trim()) {
    parts.push('', '### Instrução adicional do agente', input.instruction.trim());
  }

  parts.push(
    '',
    'Gere apenas o texto da mensagem sugerida, sem aspas e sem prefixos.',
  );

  return parts.join('\n');
}
