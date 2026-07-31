# Princípios de Banco de Dados — AutoPilot

Este documento define as regras obrigatórias do modelo de dados.  
**Nenhuma entidade de negócio foi criada nesta etapa.**

## 1. Multi-tenancy

- Todo o sistema é multi-tenant.
- Toda entidade de negócio pertence a uma `Company`.
- Toda query de domínio deve ser escopada pelo tenant (`company_id`).
- Isolamento entre companies é obrigatório (sem vazamento cross-tenant).
- O contexto de tenant será resolvido em `src/core/tenancy`.

## 2. Soft delete

- Nunca apagar dados fisicamente.
- Toda entidade possui `deleted_at`.
- Exclusões são lógicas (`deleted_at = now()`).
- Leituras padrão devem ignorar registros com `deleted_at` preenchido.

## 3. Campos obrigatórios em toda entidade

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID / cuid | Identificador único |
| `created_at` | DateTime | Criação |
| `updated_at` | DateTime | Última atualização |
| `deleted_at` | DateTime? | Soft delete |

Entidades de domínio também devem incluir `company_id` (tenant), salvo exceções globais explicitamente aprovadas.

## 4. Auditoria

- Toda ação importante gera registro de auditoria.
- Auditoria responde: quem, o quê, quando, em qual company, e contexto relevante.
- Módulo de domínio: `modules/audit`.
- Implementação virá em etapa futura — sem regras nesta fundação.

## 5. Eventos

- Toda ação importante gera evento de domínio.
- Eventos alimentam follow-up, IA, integrações e auditoria.
- Separação:
  - `modules/events` → contexto de domínio
  - `infra/events` → adapters de infraestrutura (bus/publisher)
- Contratos de eventos serão definidos antes da implementação.

## 6. Convenções de tabelas

- Nomes de tabelas em `snake_case`, plural (`companies`, `leads`, `conversations`).
- Colunas em `snake_case`.
- Chaves estrangeiras: `<entidade>_id` (ex.: `company_id`, `lead_id`).
- Índices obrigatórios previstos:
  - `company_id`
  - `deleted_at` (quando fizer sentido composto)
  - campos de busca frequentes do domínio
- Mensagens **não** terão módulo Prisma/API separado; pertencem ao contexto de `conversations`.

## 7. Fora do escopo do MVP (proibido)

Não criar tabelas/módulos para:

- ERP, Financeiro, Estoque
- Oficina / Ordens de serviço
- Marketplace
- Sistema de veículos
- Test Drive

## 8. Próximo passo de modelagem

Somente após aprovação explícita:

1. Glossário de entidades do MVP
2. Models Prisma
3. Migrations
4. Policies de tenant + soft delete no Prisma middleware
