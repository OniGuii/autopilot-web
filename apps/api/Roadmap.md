# Roadmap — AutoPilot API

Ordem sugerida de evolução. Cada etapa exige aprovação explícita.

## Concluído

- [x] Fundação NestJS em `apps/api`
- [x] Camadas Core / Shared / Infra / Modules
- [x] Scaffolds de módulos do MVP (+ health, events, audit)
- [x] Tenancy estrutural (vazio)
- [x] Prisma (sem entidades)
- [x] Docker (API + Postgres + Redis)
- [x] Swagger + Jest + env (Postgres, Redis, OpenAI, Evolution)

## Próximas etapas (pendentes de aprovação)

1. **Glossário de domínio**  
   Company, User/Membership, Lead, Conversation, Message, Follow-Up, Event, AuditLog + estados.

2. **Modelagem Prisma do MVP**  
   Entities + migrations + middleware de soft delete/tenant. Sem CRUDs ainda, ou com CRUD mínimo de Company/User se aprovado.

3. **Auth + multi-tenancy real**  
   Identidade, papéis mínimos, `TenantGuard` / contexto por request.

4. **Leads + Conversations/Messages**  
   CRUD enxuto e isolamento por company.

5. **WhatsApp (Evolution)**  
   Webhook inbound, persistência de mensagens, idempotência, fila (BullMQ).

6. **Events + Audit**  
   Contratos tipados e gravação obrigatória.

7. **Follow-Up**  
   Regras determinísticas iniciais (IA depois, se aprovado).

8. **AI layer**  
   Classificação / sugestões com allowlist de ações.

9. **Dashboard básico**  
   Métricas mínimas de conversão/recuperação.

10. **Billing / limites de plano** (se entrar no escopo)  
    Starter / Growth / Pro.

## Explicitamente fora do MVP

ERP, Financeiro, Estoque, Oficina, OS, Marketplace, Veículos, Test Drive.
