# Executive Report — Outbound V1.3 First Touch

**Data:** 2026-08-10  
**Status:** Pronto para piloto controlado (HUMAN_APPROVE)

---

## Em uma frase

O Autopilot agora gera e (com aprovação) dispara a **primeira mensagem WhatsApp** para leads importados, ligando Import → CRM → Recovery/Sales Brain — sem campanha de massa.

---

## Valor de negócio

| Antes | Depois |
|-------|--------|
| Lead importado parado em NEW | D0 gera conversa + contato |
| Recovery sem âncora | Após D0, 11D pode recuperar |
| Copy manual lead a lead | Template por vertical + KB |
| Risco de blast | Caps Protection + HUMAN_APPROVE |

---

## O que o operador faz

1. Importa lista (`/outbound/import`)  
2. Em `/outbound/first-touch` escolhe modo **HUMAN_APPROVE** e playbook  
3. Gera D0 → revisa mensagem → **Aprovar** → **Enviar**  
4. Lead vira `CONTACTED`; quem responde entra no funil 11C/11E  

---

## O que deliberadamente não faz

- Não cria Campaign Engine  
- Não dispara sequências outbound próprias (usa Recovery 11D)  
- Não faz A/B nem blast  

---

## Riscos controlados

- **Ban:** Protection V1.1 + caps + opt-out/suppress  
- **Texto repetido:** personalização + playbook + KB  
- **Duplicidade:** um D0 por lead (idempotência FollowUp)  
- **Compliance financeira:** default sem AUTO_SEND agressivo  

---

## Métricas para acompanhar

- Elegíveis / gerados / aprovados / enviados / respondidos  
- Taxa de resposta (dashboard + `first_touch_reply_rate`)  
- Caps restantes em Outbound Protection  

---

## Próximo (só com aprovação)

V1.4 / Campaign leve — **não iniciado** nesta entrega.
