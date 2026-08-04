# Pilot Feedback Log — Modo Manutenção

**Status:** Manutenção de piloto (ativa)  
**Regra:** nenhuma nova feature / nenhuma nova fase até feedback real suficiente  
**Escopo permitido:** corrigir bugs · medir uso · coletar feedback · documentar solicitações  
**Fora:** novas entidades, módulos, integrações, automações, features de IA, migrations de produto

**Referências:** `go-live-checklist.md`, `performance-baseline.md`, `pilot-stabilization-review.md`, `docs/runbooks/*`

---

## 1. Modo de operação

| Atividade | Permitido? | Onde registrar |
|---|---|---|
| Bugfix (regressão / bloqueio piloto) | Sim | §5 Bugs + entrada no log §4 |
| Medição de uso (métricas Ops/export/audit) | Sim | §6 Uso |
| Feedback de usuário / suporte | Sim | §4 Log |
| Solicitação de feature / ideia | Só documentar | §4 com P2/P3 — **não implementar** |
| Nova fase / roadmap grande | Não | Aguardar critério §7 |

---

## 2. Classificação

| Prioridade | Nome | Critério | Ação no piloto |
|---|---|---|---|
| **P0** | Bloqueador | Impede uso real (auth, WhatsApp down, perda de dados, RLS leak, 500 sistemático) | Corrigir imediatamente |
| **P1** | Alta prioridade | Uso diário degradado (send falha intermitente, export errado, RBAC incorreto, latência grave) | Corrigir nesta janela de manutenção |
| **P2** | Melhoria | Dói mas há workaround (UX API, filtros, textos, limites) | Documentar; implementar só se acumular evidência |
| **P3** | Ideia futura | Nice-to-have / roadmap (frontend, SSO, campanhas, SLA runtime…) | Backlog apenas — **não iniciar fase** |

**Regra de desempate:** impacto × frequência × existência de workaround. Sem evidência de uso → no máximo P3.

---

## 3. Template de entrada

Copiar para cada item novo:

```md
### FBxxx — <título curto>
- **Data:** YYYY-MM-DD
- **Fonte:** usuário | suporte | métrica | on-call | interno
- **Company / papel:** (slug ou id) · OWNER|ADMIN|AGENT
- **Área:** auth | whatsapp | ai | workers | crm | exports | setup | ops | outro
- **Prioridade:** P0 | P1 | P2 | P3
- **Tipo:** bug | uso | solicitação
- **Descrição:** …
- **Repro / evidência:** (requestId, audit action, screenshot, métrica)
- **Impacto:** …
- **Workaround:** …
- **Decisão:** corrigir agora | monitorar | backlog | rejeitar
- **Status:** aberto | em progresso | resolvido | adiado
- **PR / commit:** (se houver) —
```

---

## 4. Log de feedback

> Entradas reais abaixo. Não inventar feedback — só registrar o que ocorrer no piloto.

| ID | Data | Pri | Tipo | Área | Título | Status |
|---|---|---|---|---|---|---|
| — | — | — | — | — | *(nenhum feedback real ainda)* | — |

<!--
Exemplo (não contar como feedback real):
| FB001 | 2026-08-05 | P1 | bug | whatsapp | Send falha após reconnect | aberto |
-->

### Entradas detalhadas

_(vazio — aguardando piloto)_

---

## 5. Bugs corrigidos no piloto

| Data | Pri | Título | PR / commit | Notas |
|---|---|---|---|---|
| — | — | *(nenhuma correção ainda nesta janela)* | — | — |

---

## 6. Medição de uso (piloto)

Preencher periodicamente a partir de Ops / audit / DB (sem novo produto).

### 6.1 Snapshot

| Métrica | Valor | Data | Fonte |
|---|---|---|---|
| Companies ativas no piloto | | | |
| Usuários ACTIVE com login (7d) | | | |
| Leads criados (7d) | | | |
| Messages inbound / outbound (7d) | | | |
| Follow-ups executados (7d) | | | |
| AI suggests (7d) | | | |
| Exports (7d) | | | |
| Erros 5xx / DLQ depth | | | `/api/ops/*`, logs |

### 6.2 Comandos / superfícies úteis

- `GET /api/ops/metrics`, `/api/ops/diagnostics`, `/api/ops/audit`
- `GET /api/pipeline`, `/api/dashboard`
- Audit actions: `LEAD_*`, `WHATSAPP_*`, `EXPORT_*`, `MEMBERSHIP_*`
- Baseline: `npm run perf:baseline` (staging)

---

## 7. Critério para sair da manutenção / justificar roadmap

**Não iniciar Fase 11 (nem outra fase de feature)** até:

1. Haver **feedback real** de usuários do piloto (não só interno), **e**
2. Existirem pelo menos **3 itens P0/P1 resolvidos ou recorrentes documentados**, **ou**
3. Um tema P2 aparecer com **evidência repetida** (≥3 empresas/usuários ou métrica clara de fricção), **e**
4. Revisar este log + `go-live-checklist.md` em ceremony curta (GO roadmap / NO-GO continuar manutenção).

Até lá: só bugs, medições e documentação de solicitações.

---

## 8. Solicitações documentadas (não implementar)

Lista derivada do log com Pri P2/P3 — para roadmap futuro orientado por uso.

| ID | Pri | Solicitação | Frequência / evidência | Notas |
|---|---|---|---|---|
| — | — | — | — | — |

---

## 9. Histórico do modo manutenção

| Data | Evento |
|---|---|
| 2026-08-04 | Entrada em modo manutenção pós Fase 10.5; log criado |

---

**Próximo passo permitido:** registrar FB001+ com dados reais do piloto.  
**Próximo passo proibido:** abrir fase de feature sem critério §7.
