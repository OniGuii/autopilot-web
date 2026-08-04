# Fase 8A — Observability Foundation Review

**Status:** Implementado  
**Escopo:** OpenTelemetry + correlation + structured logs + Prometheus  
**Fora de escopo:** RLS, Outbound Worker, frontend, mudanças de domínio/schema/APIs públicas

---

## 1. Resumo

Foundation de observabilidade para produção aberta, sem alterar contratos HTTP de produto (`/api/ops/*` permanece). Scrapes usam **`GET /metrics`** (Prometheus). Tracing OTEL atrás de `OTEL_ENABLED=false` (default).

---

## 2. Entregas

### OpenTelemetry
- Bootstrap em `otel.bootstrap.ts` (antes do Nest)
- Instrumentações: NestJS, HTTP, Express, Prisma (`@prisma/instrumentation`), Redis (ioredis)
- BullMQ: spans manuais via `withBullJobContext` nos processors
- Export OTLP HTTP opcional (`OTEL_EXPORTER_OTLP_ENDPOINT`)

### Correlation IDs
- Middleware `x-correlation-id` (mint ou propaga)
- ALS request context: `correlationId`, `companyId`, `userId`, `module`
- Queue payloads → worker ALS → audit `after.correlationId` → JSON logs

### Structured Logging
- `StructuredLogger` (JSON): `timestamp`, `level`, `service`, `correlationId`, `companyId`, `userId`, `module`, `message`
- `LOG_FORMAT=json|pretty` (default json em production)

### Prometheus `/metrics`
- Contadores/gauges/histograms (HTTP, BullMQ, AI, WhatsApp, Prisma)
- Fora do prefix `/api` (como `/health`)
- Gate: `METRICS_ENABLED=true`

### Métricas
| Área | Séries |
|---|---|
| BullMQ | waiting/active/completed/failed + job duration |
| IA | generated/failed/tokens/duration |
| WhatsApp | sends/failures/delivery latency |
| Prisma | query duration + slow queries |

### Alertas Ops (8A)
| Código | Sinal |
|---|---|
| `HIGH_ERROR_RATE` | HTTP 5xx rate (15m) |
| `HIGH_LATENCY` | p95 HTTP/webhook/queue |
| `QUEUE_BACKLOG` | max waiting ≥ threshold |
| `AI_FAILURE_RATE` | alias de failure rate IA |

(Alertas específicos anteriores, ex. `QUEUE_BACKLOG_HIGH`, permanecem.)

---

## 3. Flags

| Var | Default |
|---|---|
| `OTEL_ENABLED` | `false` |
| `METRICS_ENABLED` | `true` |
| `LOG_FORMAT` | (json em prod) |
| `OBS_PRISMA_SLOW_MS` | `500` |
| `OBS_HIGH_ERROR_RATE_THRESHOLD` | `0.05` |
| `OBS_HIGH_LATENCY_MS` | `2000` |
| `OBS_QUEUE_BACKLOG_HIGH` | `100` |

---

## 4. Rollback

- `OTEL_ENABLED=false` → sem SDK  
- `METRICS_ENABLED=false` → `/metrics` 404  
- `LOG_FORMAT=pretty` → logs legíveis  

---

## 5. Limitações

- Contadores in-process (por réplica)  
- OTEL sem endpoint → traces locais sem export  
- `/api/ops/metrics` continua JSON de produto (não Prometheus)

---

## 6. Veredito

**8A entregue** atrás de flags. Aguardando aprovação. RLS e Outbound Worker **não** iniciados.
