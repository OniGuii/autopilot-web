# Pilot Readiness Final — Autopilot

**Tipo:** auditoria de produto (somente documentação — sem implementação)  
**Data:** 2026-08-07  
**Base auditada:** `main` após Sprint 1–3, Product Polish, Lead Workspace (PR #54)  
**Superfície:** `apps/web` + `apps/api` (contratos existentes)  
**Fontes:** código atual, `docs/ui-showcase.md`, reviews de sprint/polish/workspace, `docs/first-pilot-playbook.md`, `docs/pilot-deployment-plan.md`, `apps/api/docs/go-live-checklist.md`

---

## Veredito executivo

O Autopilot é um **MVP operacional para piloto assistido**.

| Destino | Status |
|---------|--------|
| Piloto assistido (ops Autopilot acompanha) | **GO com ressalvas** — depende de WhatsApp real + provisioning offline |
| Piloto pago (1ª empresa pagante, ainda acompanhada) | **CONDICIONAL** — falta estabilidade de canal, SOP de convite e (se vendido) superfície de IA |
| SaaS aberto (self-serve) | **NO-GO** — sem signup, sem e-mail de convite, sessão em `localStorage`, sem billing |

**Legenda de fluxo**

| Classe | Significado |
|--------|-------------|
| **PRONTO** | Fluxo utilizável no produto com UX aceitável para piloto |
| **PRONTO COM RESSALVAS** | Fluxo existe e opera, mas com gaps de UX, ops ou infra |
| **BLOQUEADO** | Fluxo de negócio não completável pelo usuário final no produto |

---

## Escopo entregue (consolidado)

| Entrega | O que mudou no produto |
|---------|------------------------|
| Sprint 1 | Shell, auth, dashboard, leads básicos |
| Sprint 2 | Conversas, mensagens, WhatsApp UI, follow-ups |
| Sprint 3 | Pipeline, Team, Users, Settings, Exports, Diagnostics, Setup, RBAC visual |
| Product Polish | Copy PT, empty/loading/error, branding, drawer, breadcrumbs, confirmações |
| Lead Workspace | Notes, Activities, Timeline, assign, histórico de status, conversas e follow-ups no lead |

---

## Matriz de fluxos

| # | Fluxo | Classificação |
|---|-------|---------------|
| 1 | OWNER | **PRONTO COM RESSALVAS** |
| 2 | ADMIN | **PRONTO COM RESSALVAS** |
| 3 | AGENT | **PRONTO COM RESSALVAS** |
| 4 | Empresa Nova | **PRONTO COM RESSALVAS** |
| 5 | WhatsApp | **PRONTO COM RESSALVAS** |
| 6 | IA | **BLOQUEADO** |
| 7 | CRM | **PRONTO COM RESSALVAS** |
| 8 | FollowUp | **PRONTO COM RESSALVAS** |
| 9 | Exportação | **PRONTO** |
| 10 | Diagnóstico | **PRONTO COM RESSALVAS** |

> WhatsApp vira **BLOQUEADO operacionalmente** se Evolution / webhook HTTPS não estiverem UP — a UI existe, o canal real não.

---

## 1. Fluxo OWNER — PRONTO COM RESSALVAS

### O que funciona
- Login → select-company (ou auto) → Painel
- Operação completa: Leads (workspace), Conversas, Follow-ups, Funil, WhatsApp
- Administração: Equipe, Usuários, Configurações (inclui slug), Exportações, Diagnósticos, Primeiros passos
- Conectar/desconectar WhatsApp
- Convidar qualquer role (OWNER/ADMIN/AGENT)
- Assign / unassign de lead no workspace

### Evidência
- Menu + RBAC: `apps/web/src/lib/auth/rbac.ts`, `app-shell.tsx`
- Páginas admin com `RequireRole` OWNER|ADMIN
- Setup: `/setup` + `POST /api/setup/company`

### Ressalvas
- OWNER ainda é **provisionado pela ops** (sem signup)
- Convite cria membership `INVITED` com `invite.delivery: NONE` — ativação offline
- Soft delete e bulk-assign existem na API, sem UI
- Ops avançado (audit/reconcile) só na API

---

## 2. Fluxo ADMIN — PRONTO COM RESSALVAS

### O que funciona
- Mesma superfície operacional e admin do OWNER, com limites corretos:
  - **Não** edita slug (`canEditCriticalSettings`)
  - **Não** convida role OWNER (`canInviteRole`)
- Pode gerir equipe, usuários, exports, diagnostics full, WhatsApp connect

### Ressalvas
- Mesmas do OWNER quanto a convite offline e dependência de canal
- Diferença de papel está clara no produto; não há gap de “ADMIN incompleto”

---

## 3. Fluxo AGENT — PRONTO COM RESSALVAS

### O que funciona
- Menu restrito: Painel, Leads, Conversas, Follow-ups, WhatsApp, Funil, Diagnósticos
- Páginas admin bloqueadas por `RequireRole` + filtro de nav
- WhatsApp: vê status; **não** conecta/desconecta
- Diagnósticos em escopo **limited** (API)
- Unassign de lead restrito a OWNER/ADMIN (espelha API)

### Ressalvas
- Ativação do AGENT ainda é processo manual (senha offline)
- Sem exports / settings / team — intencional e alinhado à API

---

## 4. Fluxo Empresa Nova — PRONTO COM RESSALVAS

### Caminho atual
```text
Ops cria User ACTIVE (sem membership)
 → Login
 → 0 memberships → /setup
 → Criar empresa (limite 1) → select-company automático
 → Convidar equipe (opcional) → Conectar WhatsApp → Dashboard
```

### O que funciona
- Wizard web `/setup` (empresa → equipe → WhatsApp → conclusão)
- `GET /api/setup/status` guia os passos
- Multi-empresa: `/select-company` quando N > 1

### Ressalvas / bloqueios parciais
- **Não há signup público** — empresa nova não começa sozinha
- Convite no wizard não envia e-mail
- `SETUP_COMPANY_LIMIT = 1` company por user
- Playbook antigo ainda descreve Setup via API; o código já tem wizard (preferir código)

---

## 5. Fluxo WhatsApp — PRONTO COM RESSALVAS

### O que funciona (quando infra ok)
- UI `/whatsapp`: status, conectar (QR), desconectar — OWNER/ADMIN
- Envio no composer da conversa (modo WhatsApp)
- Inbound via webhook Evolution → Conversas
- Execute de follow-up exige CONNECTED (409 se não)

### Dependências externas
- Evolution API real (stub proibido em produção)
- `API_PUBLIC_URL` HTTPS público para webhook
- Telefone Business do cliente para QR

### Ressalvas
- Sem WebSocket — polling de status
- Ambiente local histórico: QR quebrado / NOT_CONNECTED (infra, não mock de UI)
- Sem canal estável, **todo o ciclo comercial outbound fica inviável**

---

## 6. Fluxo IA — BLOQUEADO

### Estado
| Peça | Status |
|------|--------|
| `POST /api/ai/conversations/:id/suggest` | Existe (OWNER\|ADMIN\|AGENT) |
| Worker / flags async | Existem na API |
| Botão “Sugerir resposta” na conversa | **Ausente** |
| Endpoint AI em `apps/web` `endpoints.ts` | **Ausente** |

### Por que BLOQUEADO
O usuário final **não completa** o fluxo de IA no produto. Sugestão só via API/Swagger/ops. Follow-ups manuais na conversa existem, mas não substituem “IA no produto”.

### Condição para sair de BLOQUEADO
- Botão na conversa + tratamento de loading/erro + revisão humana (aprovar follow-up)
- `OPENAI_API_KEY` no ambiente do piloto

---

## 7. Fluxo CRM — PRONTO COM RESSALVAS

### O que funciona
- Lista de leads: busca, filtro, paginação, criar
- **Lead Workspace** (`/leads/[id]`):
  - Visão geral (edição + conversas + follow-ups)
  - Timeline
  - Notas (criar/excluir)
  - Atividades (criar/concluir/cancelar)
  - Assign owner
  - Histórico de status
- Funil `/pipeline` (KPI por status — não Kanban)
- Conversas + mensagens CRM/WhatsApp

### Ressalvas
- Soft delete de lead: API sim, UI não
- Bulk-assign: API sim, UI não
- Criar conversa ainda pede identificação crua do lead (UX frágil)
- Pipeline não é board arrastável

---

## 8. Fluxo FollowUp — PRONTO COM RESSALVAS

### O que funciona
- Lista filtrável `/follow-ups`
- Detalhe: aprovar → agendar, rejeitar, reagendar, executar, retry
- Criação manual de sugestão a partir da conversa
- Painel de próximos follow-ups no Lead Workspace

### Ressalvas
- `cancelFollowUp` existe no client API, **sem botão** na página de detalhe
- Origem por IA não é acionável na UI (ver fluxo 6)
- Execute depende de WhatsApp CONNECTED

---

## 9. Fluxo Exportação — PRONTO

### O que funciona
- `/exports` (OWNER\|ADMIN): CSV de leads, activities, follow-ups
- Intervalo opcional de datas
- API com cap (413 acima do limite) — comportamento claro

### Ressalvas menores (não rebaixam a classe)
- Sem export “a partir dos filtros da lista”
- Sem export assíncrono para volumes grandes  
Aceitável para piloto.

---

## 10. Fluxo Diagnóstico — PRONTO COM RESSALVAS

### O que funciona
- `/diagnostics`: postgres, redis, openai, whatsapp, workers
- Refresh periódico; badge de escopo (full vs limited)
- AGENT vê visão limitada (alinhado à API)

### Ressalvas
- Audit / webhooks monitor / reconcile **não** estão na UI (só API)
- É ferramenta de ops embutida, não status page pública
- Suficiente para piloto assistido; insuficiente sozinho para suporte L2 em escala

---

## RBAC — resumo

| Capacidade | OWNER | ADMIN | AGENT |
|------------|:-----:|:-----:|:-----:|
| Operação (leads, conversas, FU, funil) | ✓ | ✓ | ✓ |
| Lead workspace (notes/activities/assign) | ✓ | ✓ | ✓ (unassign não) |
| WhatsApp connect/disconnect | ✓ | ✓ | status/send |
| Equipe / Usuários / Settings / Exports / Setup | ✓ | ✓ | ✗ |
| Editar slug | ✓ | ✗ | ✗ |
| Convidar OWNER | ✓ | ✗ | ✗ |
| Diagnostics | full | full | limited |

---

## Auth & sessão (transversal)

| Item | Estado |
|------|--------|
| Login / logout / refresh | OK |
| Middleware cookie-gate | Removido (passthrough); gate no client |
| Bootstrap hung `/auth/me` | Timeout 6s + clear session |
| Tokens | `localStorage` — ok piloto fechado; frágil para SaaS aberto |
| Signup / reset de senha | **Não existem** |

---

## Blockers — piloto assistido

Itens que **impedem ou travam** um piloto real com acompanhamento da ops:

1. **WhatsApp ponta a ponta** — Evolution UP + webhook HTTPS + QR → CONNECTED + ≥1 inbound/outbound reais  
2. **Provisioning do OWNER** — processo ops documentado (user ACTIVE + senha) antes do Setup  
3. **Ativação de convidados** — SOP offline para `INVITED`/`PENDING` → ACTIVE (senha + membership)  
4. **Ambiente go-live** — Postgres/Redis, secrets, backups, runbooks (`go-live-checklist.md`)  
5. **Não usar seed de demo** na base do cliente real  

Não-blockers neste estágio (aceitáveis com acompanhamento):
- Ausência de UI de IA (ops pode não vender IA no 1º piloto)
- Soft delete / bulk-assign na UI
- Cancel follow-up na UI
- Tokens em `localStorage`

**Condição de GO assistido:** blockers 1–4 verdes + champion treinado no playbook.

---

## Blockers — piloto pago

Além dos do piloto assistido, para cobrar a 1ª empresa com expectativa comercial:

1. **Canal WhatsApp estável** (não só “conectou uma vez”) — uptime e runbook de reconexão  
2. **Convite utilizável** — no mínimo SOP impecável + copy clara; idealmente e-mail real  
3. **IA na UI** — se IA fizer parte da proposta comercial; senão, remover da pitch  
4. **Lead operacional já entregue** (Workspace) — validar adoção com o time do cliente  
5. **Criar conversa sem UUID cru** — picker/busca de lead  
6. **Cancelar follow-up na UI** — higiene do funil de sugestões  
7. **Suporte L2 mínimo** — Diagnostics + runbooks; audit/reconcile acessível à ops  
8. **Percepção de produto** — polish já reduz copy técnica; manter checklist visual do Setup  

---

## Blockers — SaaS aberto

Impedem self-serve / escala pública:

1. Signup público + verificação de e-mail  
2. Aceite de convite (magic link / set password) com `delivery` real (SMTP)  
3. Sessão HttpOnly / BFF + recuperação de senha  
4. Billing, planos e limites por tenant  
5. Onboarding WhatsApp self-serve confiável  
6. Superfície de IA no produto  
7. LGPD: export/delete self-serve, retenção, consentimentos  
8. Soft delete / retenção operáveis na UI  
9. Observabilidade productizada (status page, alertas)  
10. Hardening multi-tenant + E2E de staging sob carga  

---

## Capacidade API sem UI (dívida conhecida)

| API | Impacto | Prioridade piloto |
|-----|---------|-------------------|
| AI suggest | Fluxo IA bloqueado no produto | Alta se IA for vendida |
| Soft delete lead | Limpeza de base | Média |
| Bulk-assign | Distribuição de carteira | Média |
| Follow-up cancel | Encerrar sugestão sem rejeitar | Média |
| Ops audit / reconcile / webhooks monitor | Suporte L2 | Alta para escala |
| Dashboard sub-rotas | Já cobertas pelo dashboard full | Baixa |

---

## O que já não é blocker (resolvido nas entregas recentes)

| Antes | Agora |
|-------|-------|
| Login bounce / “Carregando sessão…” | Middleware pass-through + bootstrap timeout |
| Setup só via API/SQL | Wizard `/setup` |
| Team/Users/Settings/Exports só API | Telas Sprint 3 |
| Lead só formulário | Lead Workspace |
| Copy de engenharia / Sprint N | Product Polish (PT + branding) |
| Empty/error cru | EmptyState / ErrorPanel / friendlyError |

---

## Recomendação

1. **Autorizar piloto assistido** assim que WhatsApp real + provisioning offline estiverem validados no ambiente do cliente.  
2. **Não abrir SaaS** até signup, convite por e-mail e sessão endurecida.  
3. **Piloto pago:** tratar WhatsApp estável + SOP de usuários como must; IA UI e picker de lead como should/must conforme o contrato comercial.  
4. Próximas entregas de maior alavancagem: **AI suggest na conversa**, **picker de lead**, **cancel follow-up**, **e-mail de convite** (exige API).

---

## Referências

- `docs/frontend-sprint1-review.md` … `docs/frontend-sprint3-review.md`
- `docs/product-polish-review.md`
- `docs/lead-workspace-review.md`
- `docs/ui-showcase.md`
- `docs/first-pilot-playbook.md`
- `docs/pilot-deployment-plan.md`
- `apps/api/docs/go-live-checklist.md`
- `apps/api/docs/production-readiness-review.md`
