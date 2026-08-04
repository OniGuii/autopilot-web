# Fase 10.5 — Pilot Stabilization (Review)

**Status:** Implemented (docs + seed + e2e + baseline)  
**Branch:** `cursor/pilot-stabilization-dd93`  
**Constraints:** sem novas entidades, módulos, integrações, automações, features de IA; **sem** schema/migrations; **sem** mudança de APIs públicas

---

## Entregues

| Item | Artefato |
|---|---|
| E2E críticos | `test/pilot-stabilization.e2e-spec.ts` (+ helper `test/helpers/auth.ts`) |
| Seed piloto | `prisma/seeds/pilot.ts`, profile `SEED_PROFILE=pilot`, `npm run seed:pilot` |
| Performance baseline | `docs/performance-baseline.md` + `scripts/perf-baseline.ts` (`npm run perf:baseline`) |
| Runbooks | `docs/runbooks/runbook-{auth,whatsapp,workers,redis,ai}.md` |
| Incident response | seções em cada runbook (Evolution/Redis/OpenAI/Worker/Queue) |
| Go-live checklist | `docs/go-live-checklist.md` |

---

## Seed piloto

| Campo | Valor |
|---|---|
| Company | **Autopilot Demo** / slug `autopilot-demo` |
| Users | `owner@pilot.autopilot.dev`, `admin@…`, `agent@…` (senha seed `Demo@12345`) |
| Volume | 72 leads, ~60 conversations, messages, follow-ups (+ AI_REPLY), notes, activities |
| WhatsApp | Instance CONNECTED com secret conhecido **somente non-prod** |

Counts típicos (idempotente):

```json
{
  "companies": 1,
  "users": 3,
  "memberships": 3,
  "leads": 72,
  "conversations": 60,
  "messages": 264,
  "followUps": 144,
  "leadNotes": 60,
  "leadActivities": 60
}
```

---

## Testes adicionados

| Spec | Cobertura |
|---|---|
| `pilot-stabilization.e2e-spec.ts` | onboarding/setup status, login, select-company, create lead, inbound WA, outbound send, AI suggest + follow-up approve/execute, memberships, diagnostics, export, dashboard, pipeline, setup max-1 company |

Helper e2e: `NODE_ENV=test` forçado em `createE2eApp` para stub OpenAI estável.

### Cobertura (suíte e2e API)

- Suites e2e: **6**  
- Testes e2e: **22** (5 novos na estabilização)  
- Unit suite existente: inalterada em intenção (sem novos módulos de produto)

---

## Performance (baseline local)

Ver `performance-baseline.md`. Destaques p95: login 145ms; create lead 15ms; send 18ms; AI stub 25ms; dashboard 25ms; pipeline 9ms; export 12ms.

### Gargalos encontrados

1. **Login/argon2** — maior custo local  
2. **Stubs** — mascaram latência Evolution/OpenAI reais  
3. **Export + COUNT** — pode degradar com volume perto do hard cap 10k  
4. **Max sessions** — logins repetidos invalidam tokens (documentado no script de perf)  
5. **Seed counts + pool RLS** — counts agora usam TX + `SET LOCAL rls_bypass` (pool-safe)

---

## Riscos para o piloto

| Risco | Severidade | Mitigação |
|---|---|---|
| Evolution real instável | Alta | Runbook WhatsApp; circuit; comunicação de degradação |
| Redis down derruba filas + cache auth | Alta | Runbook Redis; ready probe; restore drill |
| OpenAI down | Média | Operar follow-up manual; runbook AI |
| Workers parados com async ON | Alta | Runbook workers; preferir sync flags se piloto mínimo |
| Senha seed default | Alta | Rotacionar antes de usuários reais |
| Invite INVITED sem e-mail | Média | Criar users ACTIVE só via processo controlado até Fase invite |
| Expectativa de frontend | — | Fora de escopo; API-only |

---

## Explicitamente não feito

- Migrations / schema / novas APIs  
- Novos módulos Nest de produto  
- Mudanças WhatsApp/AI/Workers engines  
- Frontend  
- Fase 11  

---

**Aguardando aprovação antes de qualquer Fase 11.**
