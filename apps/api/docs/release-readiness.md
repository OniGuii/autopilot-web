# Release Readiness — AutoPilot API

**Status:** Revisão somente-leitura (sem alteração de código / schema / features)  
**Data:** 2026-08-03  
**Escopo:** `apps/api` após merge das fases Auth → Leads → Conversations → WhatsApp 1–4 → FollowUp → Ops 4.5 → AI Assist MVP  
**Objetivo:** Avaliar prontidão para produção e registrar riscos, dívida técnica e recomendações operacionais.

---

## 1. Veredito executivo

O produto backend do MVP está **funcionalmente completo para piloto controlado** (auth multi-tenant, CRM básico, WhatsApp inbound/outbound, follow-ups com aprovação humana, ops e AI assist on-demand).

**Não está pronto para produção aberta / multi-instância sem hardening.**

| Dimensão | Nota | Resumo |
|---|---|---|
| Funcionalidade MVP | Alta | Fluxos principais implementados e documentados |
| Tenancy (app-layer) | Boa | `JWT.cid` consistente nos módulos de negócio; sem `companyId` de cliente |
| Tenancy (defense-in-depth) | Fraca | Extensions Prisma/TenantGuard inertes |
| Auth / sessão | Média | Argon2 + refresh rotation; claims JWT não revalidados a cada request |
| Auditoria de negócio | Boa | Mutations principais auditadas; auth lifecycle sem audit |
| Testes | Baixa–média | 12 suites unitárias concentradas em WhatsApp/Ops/AI/FollowUp; Auth/Leads/Conversations sem unit tests; e2e só `/health`; sem CI |
| Performance | Média | Listas paginadas OK; Ops/Dashboard com count storms; reconcile sem limite |
| Segurança de borda | Baixa | Sem throttle global, sem helmet/CORS explícito, Swagger default on, JWT secret com fallback |
| Operação | Baixa–média | `/health/ready` não checa DB; Redis só ping; sem filas; Evolution sem timeout |

**Recomendação:** release como **piloto fechado (1–N companies)** após checklist de produção (§7). Produção multi-tenant em escala exige backlog técnico (§6) antes.

---

## 2. Estado do sistema (mapa)

```text
Auth (login → select-company → JWT.cid)
  → Leads / Conversations / Messages
  → WhatsApp (connect, webhook, send, delivery)
  → FollowUp (suggest → approve → execute → WhatsApp)
  → AI Assist (suggest → FollowUp AI_REPLY)
  → Dashboard KPIs
  → Ops (metrics, alerts, audit, webhooks, reconcile, health)
```

| Módulo | Produção? | Testes unitários | Notas |
|---|---|---|---|
| auth | Sim | **Não** | Crítico sem cobertura |
| leads | Sim | **Não** | CRUD tenant-scoped |
| conversations | Sim | **Não** | Inclui messages |
| whatsapp | Sim | Sim (forte) | Webhook + inbound + outbound |
| follow-up | Sim | Parcial (Phase 4) | Execute manual; sem scheduler |
| ai | Sim | Parcial | On-demand; lock in-memory |
| ops | Sim | Sim | Count storms / reconcile |
| dashboard | Sim | **Não** | Aggregates pesados |
| health | Scaffold | Mínimo | ready sem DB/Redis |
| users / companies / events / audit ctrl | Scaffold | Não | Sem endpoints de produto |

Docs de design/review existentes em `apps/api/docs/` para cada fase.

---

## 3. Achados por área

### 3.1 Dívida técnica

| ID | Item | Impacto |
|---|---|---|
| D1 | Prisma `tenant.extension` / `soft-delete.extension` scaffolds (não ativados) | Isolamento só na aplicação |
| D2 | `TenantGuard` / interceptors core sempre permitem | Sem enforcement transversal |
| D3 | Modules `users` / `companies` / `events` / `audit` controller vazios | Superfície incompleta / confusão operacional |
| D4 | `/health/ready` stub | Orquestração pode marcar pod healthy sem Postgres |
| D5 | AI lock em memória (`Set`) | Multi-instância não coordena |
| D6 | Sem BullMQ / cron para FollowUp SCHEDULED | Execute é manual/lazy; fila real ausente |
| D7 | Redis provisionado mas só usado em ping de ops | Custo/ops sem benefício (cache/fila/rate-limit) |
| D8 | Evolution stub se `EVOLUTION_API_URL` vazio | Risco de “sucesso falso” em misconfig |
| D9 | OpenAI stub só em `NODE_ENV=test` (OK); sem key → 503 fora de test | Comportamento correto, mas prod depende de env |
| D10 | Uniques parciais só em SQL migrations, não no schema Prisma | Drift se schema regenerado sem SQL custom |
| D11 | README/Swagger ainda descrevem “fundação” | Documentação desalinhada do produto |
| D12 | Sem CI workflows no repositório | Regressões sem rede de segurança |

### 3.2 Cobertura de testes

| Camada | Estado |
|---|---|
| Unit (`*.spec.ts`) | **12 arquivos** — WhatsApp (6), Ops (2), AI (1), FollowUp (1), Health (1) |
| Unit ausente | **Auth, Leads, Conversations, Dashboard** (maior risco de regressão tenant/auth) |
| E2E | Apenas `GET /health` (`test/app.e2e-spec.ts`) |
| Integração DB/Redis/Evolution | **Inexistente** |
| CI | **Inexistente** no repo |

**Lacunas prioritárias de teste (sem implementar nesta etapa):**
1. Auth: login, refresh rotation, select-company, revoked session, role guard  
2. Tenancy: cross-company 404 em leads/conversations/follow-ups  
3. Webhook e2e: secret inválido / inbound → lead+conversation+message  
4. FollowUp approve → execute → Message SENT  
5. AI suggest → FollowUp AI_REPLY + rate limit 429  

### 3.3 Segurança

| Tema | Estado | Risco |
|---|---|---|
| Password / refresh hash | Argon2 | OK |
| Webhook secret | Header + argon2 verify; tenant via `instanceKey` | OK |
| `companyId` no body | Não exposto; ValidationPipe whitelist | OK |
| JWT secret | Fallback `dev-only-access-secret-change-me` se env ausente; Joi opcional | **Crítico se prod sem override** |
| Swagger | Default `SWAGGER_ENABLED=true` | Médio–alto em prod pública |
| Rate limit login/webhook/CRUD | Ausente (só AI 10/min 200/dia) | Médio–alto |
| Helmet / CORS / HSTS | Não configurados em `main.ts` | Médio |
| Membership revalidation | Claims JWT usados sem re-check ACTIVE a cada request | Médio (V6 tenant-safety) |
| Company switch | Access token antigo de outra company válido até TTL | Médio |
| Refresh reuse detection | Falha o token reusado; sem revoke da família | Baixo |
| Stack traces / exception filter | Default Nest | Baixo–médio |
| Evolution fetch timeout | Ausente | Médio (DoS de workers) |

### 3.4 Tenancy

**Pontos fortes**
- Tenant = `JWT.cid` após `select-company` (slug + membership ACTIVE).
- Módulos de negócio filtram create/list/get por `companyId`.
- Webhook define `companyId` pela instância, **não** pelo payload.
- DTOs não aceitam `companyId` do cliente.

**Pontos fracos**
- Sem filtro Prisma automático (extension inerte).
- Updates frequentemente `where: { id }` após fetch scoped — correto hoje, frágil a bugs futuros.
- Sem revalidação de membership/role no caminho quente do request.
- Consistência cross-entity (`conversation.companyId == lead.companyId`) é responsabilidade da app, não do DB.

### 3.5 Auth

Fluxo sólido para MVP: login → session sem company → select-company → access+refresh; logout revoga session + refresh tokens; strategy rejeita session revoked/expired.

Gaps para produção: throttle de login, auditoria de auth, revalidação de membership, exigir `JWT_ACCESS_SECRET` em `NODE_ENV=production`, política de CORS.

### 3.6 Auditoria

| Cobertura | Exemplos |
|---|---|
| Boa | Leads, Conversations/Messages, FollowUp lifecycle, WhatsApp connect/send/inbound, AI suggestion, Ops reconcile |
| Ausente | Login, logout, select-company, refresh, falhas de auth |
| Parcial | Entrada em `EXECUTING` (não-retry) sem audit dedicado antes do send |

Actor: `USER` se `actorUserId`; senão `SYSTEM` (webhook, delivery, timeout reconcile).

### 3.7 Performance & queries Prisma

| Padrão | Avaliação |
|---|---|
| Listagens leads/conversations/follow-ups/ops | Paginated — OK |
| Contexto AI (20 msgs) | Bounded — OK |
| Dashboard `getFull` | ~13 aggregates por request — médio |
| Ops overview → metrics + alerts(metrics again) | Count storm — alto |
| Ops reconcile messages/follow-ups | `findMany` sem `take` + update por linha em TX — alto sob backlog |
| AI rate limit | 2× `count` com JSON path `metadata.source` — médio sob abuso |
| Webhook inbound | Sync + TX completa no request — médio sob burst |

### 3.8 Índices

**Já existem (bons para MVP):** composites por `companyId` em leads, conversations, messages, follow_ups, audit_logs, webhook_events; uniques parciais SQL para idempotência (phone, external message/event, 1 WhatsApp instance/company).

**Gaps recomendados (futuro — sem migration nesta etapa):**

| Índice sugerido | Motivo |
|---|---|
| `follow_ups (company_id, type, created_at)` | Rate limit AI |
| Expressão/GIN `metadata->>'source'` ou coluna denormalizada | Filtro AI JSON |
| `follow_ups (company_id, status, scheduled_at)` | Overdue / fila |
| `follow_ups (company_id, status, updated_at)` | EXECUTING stale |
| `messages (company_id, status, created_at)` | PENDING stale |
| `conversations (company_id, lead_id, status)` | Reuso inbound OPEN/IDLE |
| `webhook_events (company_id, status, received_at)` | Alertas FAILED recentes |

### 3.9 Riscos para produção (visão consolidada)

Ver seções 4 e 5. Principais vetores: misconfig de secrets, Swagger aberto, health mentiroso, Evolution stub/timeout, ausência de filas, multi-instância com locks in-memory, falta de CI/testes em Auth/CRUD.

---

## 4. Riscos críticos

| ID | Risco | Por quê é crítico | Mitigação recomendada (ops / futuro) |
|---|---|---|---|
| C1 | `JWT_ACCESS_SECRET` com fallback de desenvolvimento | Token forjável se env esquecido | Exigir secret em production; falhar boot se default |
| C2 | Evolution stub ativo se URL vazia | Mensagens “enviadas” sem WhatsApp real | Fail-closed em production sem `EVOLUTION_API_URL` |
| C3 | Isolamento tenant só na aplicação | Um `findMany` sem `companyId` vaza dados | Ativar tenant extension / checklist + testes e2e tenant |
| C4 | Sem CI + Auth/Leads/Conversations sem testes | Regressão de segurança/tenancy silenciosa | CI mínimo + testes unitários dos módulos core |
| C5 | `/health/ready` sempre OK | Tráfego para processo sem DB | Ready real (Postgres; Redis se obrigatório) |

---

## 5. Riscos médios e baixos

### 5.1 Médios

| ID | Risco | Notas |
|---|---|---|
| M1 | Swagger habilitado por default | Desligar em prod (`SWAGGER_ENABLED=false`) |
| M2 | Sem rate limit em login / webhook / APIs gerais | Brute-force e flood |
| M3 | Membership/role/company não revalidados no JWT access | Acesso residual até TTL após revoke/switch |
| M4 | Access token antigo pós `select-company` | Cross-company até expirar access TTL |
| M5 | Ops/Dashboard count storms | Latência e carga DB em tenants grandes |
| M6 | Reconcile sem limite de lote | TX longas / locks |
| M7 | AI lock + rate limit fracos em multi-instância | Dupla geração / bypass parcial de burst |
| M8 | Evolution `fetch` sem timeout | Workers travados |
| M9 | Webhook/send/suggest síncronos | Latência acoplada a provedores externos |
| M10 | Sem CORS/helmet explícitos | Depende do gateway; risco se API exposta direto |
| M11 | `API_PUBLIC_URL` default localhost | Webhook Evolution aponta errado |
| M12 | Auth lifecycle sem auditoria | Forense incompleta |
| M13 | FollowUp SCHEDULED sem worker | Dependência de execute manual/API |

### 5.2 Baixos

| ID | Risco | Notas |
|---|---|---|
| B1 | Webhook 404 em `instanceKey` desconhecido | Oracle de existência |
| B2 | Refresh reuse sem revoke de família | Menor que logout total |
| B3 | Audit gap em transição EXECUTING | EXECUTE/FAILED ainda auditam |
| B4 | Soft-delete index lists incompletas nos scaffolds | Só relevante ao ativar extensions |
| B5 | Modules scaffold (users/companies/events) | Sem superfície pública hoje |
| B6 | Redis ocioso | Ruído operacional |
| B7 | Docs/README desalinhados | Onboarding |

---

## 6. Backlog técnico (priorizado)

Ordem sugerida **sem** abrir novas features de produto:

### P0 — Bloqueadores de produção aberta

1. Fail-closed: `JWT_ACCESS_SECRET` obrigatório em production  
2. Fail-closed: Evolution/OpenAI misconfig não stubar em production  
3. `SWAGGER_ENABLED=false` default em production  
4. `/health/ready` com Postgres (e política clara para Redis)  
5. CI: `lint` + `test` + `build` em PR  
6. Testes unitários Auth + smoke tenancy Leads/Conversations  

### P1 — Hardening

7. Rate limit global (login, webhook, APIs) — Redis ou gateway  
8. Revalidar membership ACTIVE + role no `CompanyContextGuard` / strategy  
9. Helmet + CORS allowlist  
10. Exception filter + logs estruturados (sem vazar stack em prod)  
11. Timeout/retry controlado no Evolution client  
12. Cap/`take` em reconcile + dry-run default operacional  
13. Reduzir count storm Ops (cache curto ou query única)  

### P2 — Escala / multi-instância

14. Ativar soft-delete + tenant Prisma extensions (com suite de regressão)  
15. Lock/rate-limit AI distribuído (Redis)  
16. Filas (webhook inbound / outbound / follow-up execute / AI opcional)  
17. Índices compostos listados em §3.8  
18. Auditoria de auth (login/logout/select-company/failures)  
19. Detecção de refresh-token reuse com revoke de família  
20. Métricas de tokens AI no Ops  

### P3 — Limpeza

21. Remover ou completar scaffolds users/companies/events  
22. Alinhar README/Swagger description ao produto real  
23. Documentar uniques parciais no schema/processo de migrate  
24. E2E críticos (auth → lead → webhook → suggest → approve → execute)  

---

## 7. Recomendações de produção (checklist operacional)

Usar **antes** de expor o piloto:

### 7.1 Secrets & env

- [ ] `NODE_ENV=production`  
- [ ] `JWT_ACCESS_SECRET` forte (≥32 bytes), **sem** fallback  
- [ ] `DATABASE_URL` com SSL adequado  
- [ ] `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` reais  
- [ ] `API_PUBLIC_URL` público HTTPS correto (webhooks)  
- [ ] `OPENAI_API_KEY` se AI habilitada; senão aceitar 503 consciente  
- [ ] `SWAGGER_ENABLED=false`  
- [ ] Redis password se Redis exposto  

### 7.2 Rede & borda

- [ ] API atrás de reverse proxy com TLS  
- [ ] Rate limit no gateway (login + webhook prioritários)  
- [ ] CORS allowlist do frontend  
- [ ] Restringir `/docs` se Swagger precisar em staging  

### 7.3 Dados & deploy

- [ ] `prisma migrate deploy` no pipeline de release (não no boot ad-hoc sem controle)  
- [ ] Backup Postgres + retenção  
- [ ] Confirmar uniques parciais presentes no banco alvo  
- [ ] Seed **não** rodar em produção  

### 7.4 Observabilidade

- [ ] Usar `GET /api/ops/health` (autenticado) além do health público  
- [ ] Alertas: WhatsApp não CONNECTED, PENDING stale, webhook FAILED, follow-ups overdue  
- [ ] Logs com `companyId` / `conversationId` sem secrets/PII excessivo  

### 7.5 Processo de piloto

- [ ] Começar com poucas companies e 1 instância API (locks AI in-memory)  
- [ ] Execute de FollowUp conscientemente (sem worker)  
- [ ] Monitorar custo OpenAI (10/min · 200/dia por company)  
- [ ] Runbook: reconnect WhatsApp, reconcile dry-run, revoke session  

### 7.6 Explicitamente fora do MVP (não bloquear piloto fechado)

- Auto-send / agentes / RAG / embeddings  
- Classificação automática / alteração automática de Lead pela IA  
- Billing por token  
- App mobile / frontend completo  

---

## 8. Matriz de prontidão por cenário

| Cenário | Pronto? | Condição |
|---|---|---|
| Demo local / staging | **Sim** | Env local + Evolution/OpenAI opcionais |
| Piloto fechado (poucas companies, 1 réplica API) | **Sim, com checklist §7** | Secrets, Swagger off, Evolution real, monitoramento ops |
| Produção multi-tenant aberta | **Não** | Exige P0+P1 do backlog |
| Multi-réplica / alta taxa webhook | **Não** | Exige filas, locks distribuídos, ready real, índices |

---

## 9. Conclusão

O MVP backend está **coerente arquiteturalmente** e o isolamento multi-tenant nos módulos vivos está **bem aplicado na camada de serviço**. Os maiores riscos de release não são features faltantes, e sim **hardening operacional**: secrets, health, Swagger, testes/CI dos caminhos Auth/CRUD, e limites sob carga (Ops/reconcile/Evolution/AI multi-instância).

**Próximo passo sugerido:** aprovar este readiness e priorizar backlog P0 — **sem nova fase de produto** até o piloto estar operacionalmente seguro.

---

*Documento gerado por revisão estática do código e docs existentes. Nenhuma migration, feature ou alteração de runtime foi feita nesta etapa.*
