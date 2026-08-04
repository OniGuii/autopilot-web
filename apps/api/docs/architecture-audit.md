# Auditoria Arquitetural — AutoPilot API

**Status:** Auditoria somente-leitura (sem código / schema / features)  
**Data:** 2026-08-04  
**Base:** `main` pós Production Readiness Sprint + P0 Hardening + AI Assist MVP  
**Escopo:** `apps/api`  
**Objetivo:** Avaliar arquitetura, maturidade, riscos, escala e roadmap técnico.

---

## VEREDITO FINAL

### **Produção controlada** (com restrições de piloto)

| Classificação | Aplicável? | Condição |
|---|---|---|
| Não pronto | Não | MVP funcional + hardening P0 + CI/e2e existem |
| Piloto fechado | Sim (mínimo seguro) | Poucas companies, 1 réplica API, checklist env |
| **Produção controlada** | **Sim — veredito** | Secrets/Evolution reais, Swagger off, monitoramento Ops, volume moderado |
| Produção aberta | Não | Falta revalidação membership, filas, timeouts Evolution, índices, throttle multi-réplica |
| Enterprise Ready | Não | Sem RLS, sem filas, sem multi-região, sem billing, cobertura de testes incompleta |

**Resumo:** o sistema está apto a operar em **produção controlada / piloto ampliado** (N companies limitadas, tráfego previsível, 1–2 réplicas com cautela). Não classificar como produção aberta até o backlog P0/P1 desta auditoria.

---

## 1. Visão geral da arquitetura atual

### 1.1 Stack

```text
NestJS 11 + Prisma 6 + PostgreSQL 16 + Redis 7
Auth: JWT access + refresh opaco (argon2)
WhatsApp: Evolution API (adapter HTTP)
AI: OpenAI Chat Completions (adapter HTTP)
CI: GitHub Actions (lint · unit · migrate · seed · e2e · build)
```

### 1.2 Módulos existentes

| Módulo | Responsabilidade | Estado |
|---|---|---|
| `auth` | Login, select-company, refresh/logout, JWT, guards | Produto |
| `leads` | CRUD/assign de leads multi-tenant | Produto |
| `conversations` | Conversas + mensagens in-app | Produto |
| `whatsapp` | Connect/QR, webhook, inbound, outbound, delivery | Produto |
| `follow-up` | Sugestão → approve → execute/retry via WhatsApp | Produto |
| `ai` | Suggest-reply on-demand → FollowUp `AI_REPLY` | Produto |
| `dashboard` | KPIs agregados por company | Produto |
| `ops` | Metrics, alerts, health, audit/webhooks, reconcile | Produto |
| `health` | `/health`, `/live`, `/ready` (Postgres+Redis) | Infra |
| `audit` | `AuditService.write` (controller scaffold) | Shared |
| `companies` / `users` / `events` | Scaffolds sem endpoints de produto | Scaffold |
| `core/tenancy` | ALS + TenantInterceptor + helpers | Infra |
| `shared/redis` | Cliente ioredis + locks | Infra |
| `prisma` | Client + soft-delete + tenant extensions | Infra |

### 1.3 Dependências entre módulos (Nest)

```text
AppModule
├── AppConfigModule, ThrottlerModule, CoreModule (TenantInterceptor)
├── SharedModule → RedisModule
├── PrismaModule
├── AuthModule
├── LeadsModule ─────────── Auth, Audit
├── ConversationsModule ─── Auth, Audit
├── WhatsappModule ──────── Auth, Audit
├── AiModule ────────────── Auth, Audit  (persiste FollowUp via Prisma)
├── FollowUpModule ──────── Auth, Audit, WhatsappModule  ← único edge de domínio Nest
├── DashboardModule ─────── Auth
├── OpsModule ───────────── Auth, Audit
└── Health / Companies / Users / Events / Audit (scaffold)
```

**Única dependência Nest de domínio cruzada:** `FollowUpModule → WhatsappModule` (`WhatsappSendService`).

**Acoplamento por dados (não Nest):** `AiModule` cria `FollowUp` diretamente via Prisma (não importa `FollowUpModule`).

### 1.4 Pontos de acoplamento críticos

| Acoplamento | Tipo | Risco |
|---|---|---|
| FollowUp.execute → WhatsappSendService | Runtime Nest | Correto (canal único de envio) |
| Ai.suggest → `follow_ups` table | Prisma direto | Duplica regras de criação se FollowUp evoluir |
| Ops → Message/FollowUp/Webhook/Audit | Leitura cross-context | Aceitável para ops; queries pesadas |
| TenantInterceptor → ALS → Prisma tenant ext | Infra transversal | Fail-open se ALS vazio (webhook/system) |
| Webhook → companyId da instance | Bypass JWT | Correto; depende de secret + instanceKey |
| Dashboard/Ops → muitos COUNTs | Performance | Gargalo de escala |

### 1.5 Bounded contexts (lógicos)

```text
┌──────────────── Identity & Access ────────────────┐
│ Auth, Membership, Session, Tenant ALS             │
└───────────────────────┬───────────────────────────┘
                        │ JWT.cid
┌───────────────────────▼───────────────────────────┐
│ CRM Core                                           │
│ Leads · Conversations · Messages (in-app)          │
└───────────┬───────────────────────────┬───────────┘
            │                           │
┌───────────▼───────────┐   ┌───────────▼───────────┐
│ Channel WhatsApp      │   │ Engagement            │
│ Connect · Webhook     │   │ FollowUp · AI Assist  │
│ Inbound · Outbound    │   │ (humano no loop)      │
└───────────────────────┘   └───────────────────────┘
            │                           │
┌───────────▼───────────────────────────▼───────────┐
│ Insight & Ops                                      │
│ Dashboard KPIs · Ops metrics/alerts/reconcile      │
└────────────────────────────────────────────────────┘
```

**Observação:** contexts estão claros na intenção, mas o deploy é **monólito Nest**; isolamento é por módulos + tenant filter, não por serviços separados.

### 1.6 Fluxos principais

```text
Auth:     login → select-company(slug) → JWT(cid) → guards
Inbound:  webhook(secret) → Lead/Conversation/Message → audits
Outbound: POST /whatsapp/send → PENDING→SENT→DELIVERED/READ/FAILED
FollowUp: SUGGESTED→approve→SCHEDULED→execute→WhatsAppSend
AI:       POST /ai/.../suggest → OpenAI → FollowUp AI_REPLY SUGGESTED
Ops:      metrics/alerts/ready product health/reconcile
```

---

## 2. Avaliação de maturidade

Critérios usados:

| Nível | Significado |
|---|---|
| Experimental | Scaffold / incompleto / não confiável |
| MVP | Funcional para valor de produto; limites conscientes |
| Produção | Hardening suficiente para operação controlada |
| Escalável | Pronto para multi-réplica / alto volume / filas |

| Módulo | Maturidade | Justificativa |
|---|---|---|
| **Auth** | **Produção** | Fluxo completo, argon2, refresh rotation, CI e2e; falta revalidação membership e audit de auth |
| **Leads** | **MVP → Produção** (borda) | CRUD tenant-scoped sólido; pouca cobertura unitária; e2e parcial |
| **Conversations** | **MVP → Produção** (borda) | Mensagens paginadas; sem unit tests dedicados |
| **FollowUps** | **MVP** | Ciclo approve/execute/retry ok; **sem worker/scheduler**; execute manual |
| **WhatsApp** | **Produção** (canal) | Fases 1–4 + testes fortes; sync webhook e fetch sem timeout limitam escala |
| **AI** | **MVP** | On-demand + lock Redis + rate limit; custo/JSON counts; sem auto-gen (correto) |
| **Dashboard** | **MVP** | Útil; count storm (~13 aggregates) |
| **Ops** | **MVP → Produção** (borda) | Bom para piloto; overview/reconcile pesados sob backlog |

**Infra transversal**

| Peça | Maturidade |
|---|---|
| Tenant + Soft-delete extensions | Produção (app-layer; sem RLS) |
| Health ready (Postgres+Redis) | Produção |
| CI/CD + e2e básicos | Produção (rede mínima) |
| Redis (locks/health only) | MVP (sem filas/cache/throttle store) |
| Scaffolds companies/users/events | Experimental |

---

## 3. Análise de riscos

### 3.1 P0 — Crítico

| ID | Risco | Área | Nota |
|---|---|---|---|
| — | *(nenhum blocker de boot/misconfig remanescente se checklist prod for seguido)* | — | JWT obrigatório, Evolution fail-closed, ready real, Swagger protegido, CI — endereçados no P0/PR sprints |

> Em ambiente **mal configurado** (JWT omitido em prod, Evolution URL vazia, Swagger aberto), o fail-closed atual mitiga — risco operacional torna-se de processo, não de código.

### 3.2 P1 — Alto

| ID | Risco | Área | Impacto |
|---|---|---|---|
| R1 | Membership/role **não revalidados** a cada request (JWT claims confiados) | Segurança / Tenancy | Acesso residual pós-revoke/demote até TTL do access token |
| R2 | Access token antigo válido após `select-company` para outra company | Tenancy | Cross-company até expirar access TTL |
| R3 | Evolution `fetch` **sem timeout** | Concorrência / Disponibilidade | Requests travados; saturação de workers |
| R4 | Webhook **100% síncrono** + `@SkipThrottle` | Escalabilidade | Burst Evolution → DB sob pressão; sem backpressure |
| R5 | Sem worker FollowUp (`SCHEDULED` depende de execute manual) | Consistência / Produto | Automações atrasam ou não disparam |
| R6 | Ops/Dashboard **count storms**; reconcile **sem `take`** | Performance Prisma | Latência e TXs longas |
| R7 | Throttler **in-memory** (não Redis) | Escalabilidade | Limites fracos com N réplicas |
| R8 | Sem Helmet/CORS/exception filter na API | Segurança de borda | Depende 100% do gateway |

### 3.3 P2 — Médio

| ID | Risco | Área |
|---|---|---|
| R9 | Índices compostos faltando (AI JSON, overdue, PENDING stale, webhooks FAILED) | Performance Prisma |
| R10 | AI rate limit via `COUNT` + JSON path (caro sob abuso) | Custos / Performance |
| R11 | Auth lifecycle sem auditoria (login/logout/select) | Observabilidade |
| R12 | Unit tests ausentes em Auth/Leads/Conversations/Dashboard | Qualidade |
| R13 | Sem filas (inbound/outbound/AI) | Escalabilidade |
| R14 | AiService cria FollowUp sem passar pelo FollowUpService | Acoplamento / Consistência |
| R15 | Tenant isolation só na app (sem RLS Postgres) | Segurança defense-in-depth |
| R16 | Custo OpenAI controlado só por rate limit (sem budget/alerta de tokens no Ops) | Custos OpenAI |

### 3.4 P3 — Baixo

| ID | Risco | Área |
|---|---|---|
| R17 | Modules scaffold (users/companies/events) | Manutenção |
| R18 | Webhook 404 em instanceKey (oracle de existência) | Segurança |
| R19 | Refresh reuse sem revoke de família inteira | Segurança |
| R20 | `THROTTLE_AUTH_LIMIT` env não usado (login hardcoded 20) | Config drift |
| R21 | Docs/README parcialmente desalinhados | DX |

### 3.5 Avaliação por dimensão

| Dimensão | Nota | Comentário |
|---|---|---|
| Segurança | Boa p/ piloto | Secrets/webhook/JWT ok; falta membership recheck + borda HTTP |
| Tenancy | Boa (app) | Extensions + JWT.cid; sem RLS; staleness de claims |
| Concorrência | Média | Lock AI em Redis; Evolution/webhook sync; FollowUp sem fila |
| Consistência de dados | Boa | Uniques parciais; audits; soft-delete em reads |
| Escalabilidade | Baixa–média | Sync I/O + count storms; 1 réplica confortável |
| Observabilidade | Média | Ops product health/alerts; sem APM/logs estruturados/auth audit |
| Custos OpenAI | Controlados (MVP) | 10/min · 200/dia; falta visibilidade Ops de tokens |
| Custos WhatsApp | Operacionais | Stub fail-closed; sem fila = pico = custo de infra API |
| Performance Prisma | Média | Listas paginadas ok; aggregates/reconcile/AI counts fracos |

---

## 4. Gargalos de escala

### 4.1 Por faixa de usuários*

\*“Usuários” ≈ agentes/operadores ativos + volume correlato de leads/msgs (ordem de grandeza).

| Escala | Capacidade atual | Gargalos dominantes |
|---|---|---|
| **~100 usuários** | **Adequada** para produção controlada | Config/ops; pouco stress técnico |
| **~1.000 usuários** | **Limítrofe** sem P1 | Dashboard/Ops counts; webhook bursts; Evolution hangs; multi-réplica throttle |
| **~10.000 usuários** | **Não suportada** sem re-arquitetura parcial | Filas obrigatórias; índices; workers FollowUp; cache/KPIs; multi-réplica Redis-aware |

### 4.2 Queries críticas

| Query / padrão | Onde | Problema |
|---|---|---|
| ~13 aggregates paralelos | `dashboard.service` `getFull` | CPU/IO por page load |
| metrics + alerts(metrics) | `ops.service` | Contagens duplicadas |
| reconcile `findMany` sem limite | `ops.service` | TX longa, locks |
| `followUp.count` + JSON `metadata.source` | `ai.service` rate limit | Seq scan / JSON filter |
| Inbound TX completa no request | `whatsapp-inbound` | Latência acoplada ao provider |
| Echo heal nested filters | delivery service | Plano de query sensível |

### 4.3 Endpoints críticos

| Endpoint | Criticidade | Motivo |
|---|---|---|
| `POST /whatsapp/webhook/:key` | Crítica | Ingresso; sync; sem throttle |
| `POST /whatsapp/send` | Alta | I/O Evolution sem timeout |
| `POST /follow-ups/:id/execute` | Alta | Envio + state machine |
| `POST /ai/.../suggest` | Alta | OpenAI + Redis lock + 2 counts |
| `GET /dashboard` | Média–alta | Count storm |
| `GET /ops` / reconcile | Média–alta | Aggregates / backlog |
| `POST /auth/login` | Média | Brute-force (mitigado 20/min) |

### 4.4 Contagens pesadas

- Dashboard full page  
- Ops overview/alerts  
- AI rate limit (2 counts/request)  
- Alertas PENDING/EXECUTING stale / webhooks FAILED  

### 4.5 Riscos de lock

| Lock | Escopo | Risco |
|---|---|---|
| AI generation (Redis SET NX) | Por conversation | OK multi-réplica; TTL 90s; Redis down → 503 suggest |
| FollowUp EXECUTING claim | updateMany status | OK; timeout lazy |
| Reconcile TX | Muitas rows | Contenção em `messages`/`follow_ups` |

### 4.6 Riscos de Redis

| Uso atual | Risco |
|---|---|
| Ready depende de Redis up | Deploy sem Redis = not ready (intencional) |
| AI lock | Indisponibilidade bloqueia AI (fail-closed) |
| Sem uso para throttle/filas/cache | Multi-réplica e picos sem coordenação |
| Dois mecanismos de ping (RedisService vs ops TCP) | Drift operacional menor |

### 4.7 Riscos de webhook

- Processamento síncrono (lead + conversation + message + audits)  
- Sem fila / retry assíncrono de negócio além de status FAILED no evento  
- Skip throttle → depende do secret e da capacidade do pod  
- Payload JSON retido (crescimento de `webhook_events`)  

---

## 5. Backlog técnico recomendado (ROI)

### P0 — Alto ROI / risco operacional

1. **Revalidar membership ACTIVE + role** no `JwtStrategy` ou `CompanyContextGuard` (e invalidar cid stale)  
2. **Timeout + AbortSignal no EvolutionClient** (paridade com OpenAI)  
3. **Cap/`take` + dry-run default no reconcile Ops**  
4. **Reduzir count storm Ops** (não recontar metrics dentro de alerts; cache curto opcional)  
5. **Helmet + CORS allowlist + exception filter** (ou documentar gateway obrigatório com checks)

### P1 — Escala e robustez

6. **Fila para webhook inbound** (ack rápido → worker)  
7. **Worker/scheduler FollowUp SCHEDULED** (BullMQ/Redis ou cron seguro)  
8. **Throttler storage Redis** (multi-réplica)  
9. **Índices compostos** (AI rate limit, overdue, PENDING stale, webhook FAILED)  
10. **Denormalizar `metadata.source` AI** ou contador Redis para rate limit  
11. **Unit tests Auth + Leads + Conversations** (além do e2e)  
12. **Auditoria auth** (login/logout/select-company/failures)  
13. **Métricas de tokens AI no Ops**  

### P2 — Evolução / enterprise

14. RLS Postgres (defense-in-depth)  
15. AiService → FollowUpService (único ponto de criação)  
16. Cache/materialização de KPIs Dashboard  
17. Filas outbound + retry/backoff Evolution  
18. Detecção refresh-token reuse com revoke de família  
19. Completar ou remover scaffolds users/companies/events  
20. Observabilidade estruturada (correlationId, APM)

---

## 6. Roadmap recomendado

### Fase 6 — Hardening de acesso e estabilidade de canal

**Justificativa:** fecha os P1 de segurança (membership) e disponibilidade (Evolution timeout, borda HTTP, Ops reconcile) sem mudar o domínio do produto. Maximiza confiança na **produção controlada**.

Entregas típicas: R1–R3, R6–R8 (parcial), testes Auth unitários, auth audit.

### Fase 7 — Assíncrono e automação confiável

**Justificativa:** remove o acoplamento sync do webhook e habilita FollowUp real em escala; Redis passa de “ping+lock” a **backplane** (filas + throttle). Necessário para sair de 100→1.000 usuários com segurança.

Entregas típicas: fila inbound, worker FollowUp, throttler Redis, índices P1, AI rate-limit eficiente.

### Fase 8 — Escala de leitura e profundidade enterprise

**Justificativa:** Dashboard/Ops e tenancy defense-in-depth tornam-se o gargalo depois que o canal é assíncrono. Prepara **produção aberta**.

Entregas típicas: KPI cache/rollups, RLS, outbound queue, observabilidade completa, possível split de bounded contexts só se métricas exigirem.

```text
Fase 6  Segurança + estabilidade do canal     →  reforça Produção controlada
Fase 7  Filas + workers + índices               →  habilita ~1k usuários
Fase 8  Leitura em escala + RLS + observab.  →  caminho p/ Produção aberta
```

---

## 7. Matriz resumida módulo × prontidão

| Módulo | Maturidade | Bloqueio principal p/ escala |
|---|---|---|
| Auth | Produção | Revalidação membership |
| Leads | MVP/Produção | Testes unitários |
| Conversations | MVP/Produção | Testes unitários |
| FollowUps | MVP | Worker/scheduler |
| WhatsApp | Produção | Webhook sync + timeout |
| AI | MVP | Contadores/índices; custo Ops |
| Dashboard | MVP | Count storm |
| Ops | MVP/Produção | Aggregates + reconcile |

---

## 8. O que NÃO fazer agora

- Novas features de produto (agentes, RAG, auto-send, classificação) antes da Fase 6  
- Multi-região / sharding prematuro  
- Trocar Evolution/OpenAI sem adapter estável + timeouts  
- Ativar Swagger em production sem Basic Auth (já bloqueado — manter)  
- Escalar horizontalmente sem Redis throttle + filas  

---

## 9. Conclusão

A arquitetura do AutoPilot é um **monólito modular bem delimitado**, com tenancy app-layer ativo, canal WhatsApp completo, AI assist com humano no loop, e base de CI/e2e/hardening suficiente para operar.

O teto atual não é “falta de features” — é **estabilidade sob carga e rigor de autorização contínua**. O veredito **Produção controlada** reflete isso: pronto para valor real com governança; não pronto para crescimento aberto sem as Fases 6–7.

---

*Documento gerado por auditoria estática pós Production Readiness. Nenhuma alteração de código, schema ou feature nesta etapa.*
