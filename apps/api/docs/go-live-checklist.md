# Go-Live Checklist — Piloto Autopilot

**Fase:** 10.5 Pilot Stabilization  
**Objetivo:** checklist operacional antes de usuários reais no piloto  
**Não cobre:** frontend, billing, SSO, multi-region

---

## 1. Infra & config

- [ ] Postgres migrado (`prisma migrate deploy`) — **sem migrations novas nesta fase**
- [ ] Redis acessível; AOF/RDB conforme ambiente
- [ ] `JWT_ACCESS_SECRET` / refresh secrets fortes
- [ ] `DATABASE_URL`, Redis, `EVOLUTION_*`, `OPENAI_API_KEY` setados no piloto
- [ ] `NODE_ENV=production` (ou staging) com flags async revisadas
- [ ] `ALLOW_PROD_SEED` **não** habilitado em prod real
- [ ] Backups Postgres testados (restore drill)

## 2. Seed / dados iniciais

- [ ] Rodar `npm run seed:pilot` **apenas** em ambiente de demo/piloto controlado
- [ ] Company `Autopilot Demo` (`autopilot-demo`)
- [ ] Users OWNER / ADMIN / AGENT com senhas rotacionadas (sair de `Demo@12345` se exposto)
- [ ] WhatsApp instance CONNECTED (Evolution real, não stub)
- [ ] Validar counts: leads, conversations, messages, followups, notes, activities

## 3. Smoke funcional (crítico)

- [ ] Login → select-company → `/auth/me`
- [ ] Setup status coerente
- [ ] Criar lead
- [ ] Inbound WhatsApp (mensagem real ou webhook assinado)
- [ ] Outbound send
- [ ] AI suggest → approve → execute follow-up
- [ ] Export CSV leads
- [ ] Memberships list / invite INVITED
- [ ] Diagnostics OWNER full / AGENT limited
- [ ] Dashboard + pipeline 200

Automatizado: `npm run test:e2e -- --testPathPatterns=pilot-stabilization` (stubs).

## 4. Performance

- [ ] Executar `npm run perf:baseline` no ambiente alvo (ou staging equivalente)
- [ ] Comparar com budgets em `performance-baseline.md`
- [ ] Medir send/suggest **com** Evolution/OpenAI reais

## 5. Observabilidade & ops

- [ ] `/health`, `/health/live`, `/health/ready`, `/metrics`
- [ ] Alertas Ops (`/api/ops/alerts`) revisados
- [ ] Runbooks lidos pela equipe on-call:
  - `runbooks/runbook-auth.md`
  - `runbooks/runbook-whatsapp.md`
  - `runbooks/runbook-workers.md`
  - `runbooks/runbook-redis.md`
  - `runbooks/runbook-ai.md`
- [ ] Canal de incidente definido (Slack/Pager)

## 6. Segurança piloto

- [ ] RLS ativo (FORCE) — sem mudança de policies nesta fase
- [ ] Contas seed não reutilizam senha default em produção
- [ ] Webhook secrets rotacionados (não usar secret do seed)
- [ ] Exports restritos OWNER|ADMIN
- [ ] Rate limits / throttling OK

## 7. Go / No-Go

**GO** se: smoke crítico verde, dependências UP, runbooks claros, backups OK, senhas rotacionadas.  
**NO-GO** se: Evolution/Redis down, workers parados sem plano, AI obrigatória sem key, falhas e2e críticos.

---

**Após go-live piloto:** registrar lições; **não** iniciar Fase 11 sem aprovação.
