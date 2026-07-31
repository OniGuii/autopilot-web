# Architecture — AutoPilot API

## Visão

AutoPilot é uma plataforma multi-tenant de recuperação e conversão de leads com IA.  
O backend é o dono das regras de negócio. Integrações (Evolution, n8n, OpenAI) são adapters.

## Camadas

```text
src/
├── config/     # Configuração e validação de ambiente
├── core/       # Regras transversais do sistema
├── shared/     # Utilitários reutilizáveis
├── infra/      # Providers / adapters externos (scaffolds)
├── prisma/     # Integração ORM Nest ↔ PostgreSQL
└── modules/    # Bounded contexts do MVP
```

### Config

Responsável por carregar e validar variáveis de ambiente:

- App (`PORT`, `API_PREFIX`, Swagger)
- PostgreSQL (`DATABASE_URL`)
- Redis
- OpenAI
- Evolution API

Não contém regra de domínio.

### Core

Regras transversais do sistema:

- Multi-tenancy (`core/tenancy`)
- Guards, filters, interceptors, middleware (preparados)

Tudo que se aplica a múltiplos módulos sem ser utilitário genérico.

### Shared

Utilitários e contratos reutilizáveis:

- constants, DTOs compartilhados, utils, types

Sem regra de negócio de um bounded context específico.

### Infra

Adapters de infraestrutura (vazios nesta etapa):

| Pasta | Futuro provider |
|---|---|
| `infra/database` | acesso/pooling além do Prisma service |
| `infra/redis` | cliente Redis |
| `infra/openai` | cliente OpenAI |
| `infra/evolution` | cliente Evolution API |
| `infra/events` | bus/publisher de eventos |

`modules/*` não devem conhecer detalhes de SDK; consomem ports via infra.

### Prisma

Integração Nest do Prisma Client.  
Schema atual: apenas `generator` + `datasource` (sem models).

### Modules

Bounded contexts do MVP:

| Módulo | Nota |
|---|---|
| `health` | `/health`, `/health/live`, `/health/ready` |
| `auth` | autenticação (futuro) |
| `companies` | tenant |
| `users` | usuários da company |
| `leads` | leads |
| `conversations` | conversas **e mensagens** |
| `whatsapp` | canal WhatsApp / Evolution |
| `ai` | camada de IA (não destrutiva) |
| `follow-up` | recuperação / follow-ups |
| `dashboard` | métricas básicas |
| `events` | eventos de domínio |
| `audit` | auditoria |

**Não existe** `modules/messages` — mensagens pertencem a `conversations`.

## Fluxo alvo (futuro)

```text
WhatsApp → Evolution → Backend → Events → AI → Resposta
```

n8n orquestra integrações; regras ficam no backend.

## Princípios

1. Multi-tenant por `Company`
2. Soft delete obrigatório
3. Eventos + auditoria em ações importantes
4. IA sem acesso destrutivo
5. Escopo MVP fechado (sem ERP/estoque/oficina/veículos)

Detalhes de dados: `docs/database-principles.md`.
