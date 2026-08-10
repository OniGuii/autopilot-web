# Executive Report — Outbound V1.2 Lead Import

**Data:** 2026-08-10  
**Status:** Pronto para uso operacional (sem disparo)

---

## Em uma frase

O Autopilot agora importa listas de leads (CSV/XLSX/colar) com preview, mapeamento e validação — gravando apenas no CRM existente, sem enviar WhatsApp.

---

## Valor de negócio

| Antes | Depois |
|-------|--------|
| Lead a lead (manual/API) | Lote até 500 linhas |
| Sem rastreio de qualidade da lista | Relatório: válidos / inválidos / duplicados / suppress |
| Risco de reimportar opt-out | Bloqueio via Suppress V1.1 |

---

## O que o operador faz

1. Sobe arquivo ou cola tabela em `/outbound/import`  
2. Confere preview e mapeia Telefone (obrigatório) + campos opcionais  
3. Valida (dry-run)  
4. Importa só os válidos → leads `NEW` no funil  

---

## O que deliberadamente não faz

- Não cria campanha  
- Não dispara first-touch  
- Não envia WhatsApp  

Próximo passo de produto (quando aprovado): V1.3 First Touch — ainda bloqueado por esta entrega.

---

## Riscos controlados

- Lista fria continua sendo risco de canal — import ≠ permissão para blast  
- Cap 500 linhas força lotes pequenos e revisáveis  
- Duplicados e suppress são ignorados (import parcial), não derrubam o lote  

---

## Métricas para acompanhar

- Importados / válidos / criados (dashboard 7d)  
- Taxa de inválidos e duplicados por lote  
- Prometheus `outbound_import_*`
