# Performance Baseline — Pilot Stabilization (Fase 10.5)

**Status:** Baseline local capturado  
**Gerado em:** 2026-08-04T19:04:36Z  
**Script:** `npm run perf:baseline` (`scripts/perf-baseline.ts`)  
**Escopo:** readiness de piloto — **não** é load test de produção

---

## 1. Ambiente da medição

| Item | Valor |
|---|---|
| Runtime | Nest in-process (mesmo bootstrap dos e2e) |
| DB / Redis | localhost Postgres + Redis |
| Fixture | `SEED_PROFILE=test` (`test-fixture`) |
| `NODE_ENV` | `test` |
| Evolution | stub (`EVOLUTION_API_URL` vazio) |
| OpenAI | stub (sem `OPENAI_API_KEY`) |
| Workers in API | `ASYNC_WORKERS_IN_API=false` |
| Runs / endpoint | 5 (AI: 3) |

Reexecutar:

```bash
cd apps/api
npm run seed:test
npm run perf:baseline
```

---

## 2. Resultados (ms)

| Endpoint | p50 | p95 | max | errors |
|---|---:|---:|---:|---:|
| `POST /api/auth/login` | 90 | 145 | 145 | 0 |
| `POST /api/leads` | 10 | 15 | 15 | 0 |
| `POST /api/whatsapp/send` | 17 | 18 | 18 | 0 |
| `POST /api/ai/conversations/:id/suggest` | 16 | 25 | 25 | 0 |
| `GET /api/dashboard` | 12 | 25 | 25 | 0 |
| `GET /api/pipeline` | 8 | 9 | 9 | 0 |
| `GET /api/exports/leads` | 10 | 12 | 12 | 0 |

---

## 3. Interpretação / gargalos

| Achado | Detalhe |
|---|---|
| Login é o mais lento | Argon2 verify + criação de session/refresh (~90–145ms) — esperado |
| Mutações de domínio rápidas | Lead / send / suggest < 25ms p95 no stub local |
| Dashboard > pipeline | Dashboard agrega mais fontes; pipeline operacional é mais leve |
| Export depende do volume | Baseline com fixture pequena; com 10k rows o `COUNT(*)` + serialização CSV sobe |
| Stubs mascaram latência externa | Evolution/OpenAI reais adicionarão RTT + timeouts (ver runbooks) |
| Sessões concorrentes | Login repetido invalida sessions antigas (`AUTH_MAX_SESSIONS`) — medição re-autentica após churn |

---

## 4. Budgets sugeridos para piloto (local/staging stub)

| Operação | Budget p95 sugerido |
|---|---|
| login | < 300ms |
| create lead | < 100ms |
| send whatsapp (stub) | < 100ms |
| ai suggest (stub) | < 150ms |
| dashboard | < 200ms |
| pipeline | < 100ms |
| exports (≤1k rows) | < 500ms |

Com Evolution/OpenAI reais, budgets de send/suggest devem ser revisitados (ex. send < 2s, suggest < 5s).

---

## 5. Limitações

- Sem concorrência multi-usuário / soak  
- Sem cold start de container  
- Sem dataset piloto completo (`seed:pilot` 72 leads) nesta corrida — reexecutar apontando company piloto se desejado  
- Não altera APIs, schema ou engines  
