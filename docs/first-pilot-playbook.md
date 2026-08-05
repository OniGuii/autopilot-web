# Playbook do Primeiro Piloto Real — Autopilot

**Tipo:** operação e adoção (somente documentação — sem implementação)  
**Data:** 2026-08-05  
**Público:** time Autopilot (ops) + champion do cliente piloto  
**Pré-requisito técnico:** ambiente go-live conforme `docs/pilot-deployment-plan.md`  
**Superfície atual:** `apps/web` (Sprints 1–2) + API Nest (`apps/api`)

---

## Premissas do piloto

| Item | Estado atual |
|------|----------------|
| Login / select-company / dashboard / leads | UI web |
| Conversas / mensagens / WhatsApp / follow-ups | UI web |
| AI suggest | **API apenas** (sem página `/ai` ainda) |
| Memberships / convites | **API apenas** (sem UI) |
| Setup company | **API** `POST /api/setup/company` (sem wizard web) |
| Signup público | **Não existe** — usuário owner é provisionado pela ops |
| Convite por e-mail | **Não existe** — `invite.delivery: NONE`; senha offline |
| 1 company por user | Limite de API (`SETUP_COMPANY_LIMIT`) |

**Perfil piloto recomendado:** 1 concessionária/oficina, 1–3 usuários (OWNER + 1–2 AGENT), 1 linha WhatsApp, 2–4 semanas de uso diário.

---

## 1. Como cadastrar a primeira empresa

### 1.1 Provisionar o OWNER (ops Autopilot)

Não há auto-cadastro. A ops cria o usuário no banco (ou processo interno aprovado) com:

- e-mail corporativo do champion
- `status=ACTIVE`
- `passwordHash` argon2 (senha forte temporária, entregue por canal seguro)
- **sem** membership ainda

### 1.2 Champion cria a empresa

1. Abrir o web → `/login` (ou Swagger/API).
2. Login com e-mail/senha do OWNER.
3. Chamar API (enquanto não houver tela Setup):

```http
POST /api/setup/company
Authorization: Bearer <accessToken sem cid>
Content-Type: application/json

{
  "name": "Nome Fantasia do Cliente",
  "slug": "cliente-piloto",
  "timezone": "America/Sao_Paulo",
  "locale": "pt-BR"
}
```

4. `POST /api/auth/select-company` com `{ "companySlug": "cliente-piloto" }`.
5. No web: login novamente se necessário → selecionar empresa → Dashboard.
6. Conferir `GET /api/setup/status` (steps: company / whatsapp / firstLead / firstMessage).
7. Ajustar settings da company (`GET/PATCH /api/settings/company`): timezone, currency (`BRL` default).

### 1.3 Regras

- Máximo **1 empresa por usuário**.
- Não usar `seed:pilot` / `seed:local` na base do cliente.
- Registrar no runbook interno: `companyId`, slug, owner e-mail, data de início.

### 1.4 Critério de “empresa pronta”

- [ ] Login + select-company OK  
- [ ] Dashboard carrega KPIs (mesmo zerados)  
- [ ] Settings coerentes (timezone/currency)

---

## 2. Como conectar o primeiro WhatsApp

### 2.1 Pré-checks ops

- [ ] Evolution real UP (`EVOLUTION_API_URL` + key)
- [ ] `API_PUBLIC_URL` HTTPS público
- [ ] Telefone/WhatsApp Business do cliente disponível para QR

### 2.2 Fluxo (champion OWNER/ADMIN)

1. No web: menu **WhatsApp** (`/whatsapp`).
2. **Conectar** → status `QR_PENDING` + QR.
3. Escanear com o celular do cliente.
4. Aguardar `CONNECTED` + número exibido.
5. Enviar **1 mensagem inbound** de um celular de teste para o número conectado.
6. Confirmar que a conversa/mensagem aparece em **Conversas**.
7. Enviar **1 outbound** (composer modo WhatsApp ou follow-up execute).

### 2.3 Se falhar

| Sintoma | Ação |
|---------|------|
| QR não aparece / ERROR | Ver `lastError`; Evolution; reconnect |
| CONNECTED mas sem inbound | Webhook/`API_PUBLIC_URL`/secret |
| Send 409 not CONNECTED | Reconectar; não forçar execute |

Detalhes técnicos: `docs/pilot-deployment-plan.md` §12 e `apps/api/docs/runbooks/runbook-whatsapp.md`.

### 2.4 Critério de “WhatsApp pronto”

- [ ] Status `CONNECTED` estável ≥ 24h ou pelo menos 1 dia útil de uso  
- [ ] ≥1 inbound + ≥1 outbound reais registrados  

---

## 3. Como cadastrar usuários

### 3.1 Papéis

| Role | Uso no piloto |
|------|----------------|
| `OWNER` | Champion; settings, WA connect, exports, memberships |
| `ADMIN` | Quase igual OWNER (ops do dia a dia) |
| `AGENT` | Atende leads/conversas/follow-ups; sem connect WA / exports |

### 3.2 Convite via API (OWNER/ADMIN)

```http
POST /api/memberships
Authorization: Bearer <token com cid>
Content-Type: application/json

{
  "email": "atendente@cliente.com",
  "name": "Ana Atendente",
  "role": "AGENT"
}
```

Resposta relevante:

- Membership `INVITED`
- User pode ser criado como `PENDING` **sem senha**
- `invite.delivery: "NONE"` — **nenhum e-mail é enviado**

### 3.3 Ativação offline (obrigatória hoje)

1. Ops/champion define senha forte temporária.
2. Ops grava `passwordHash` + `User.status=ACTIVE` (procedimento interno).
3. Membership → `ACTIVE` (via `PATCH /api/memberships/:id` quando aplicável ao fluxo de ativação, ou procedimento ops alinhado ao status ACTIVE exigido no login).
4. Entregar credenciais por canal seguro; pedir troca na primeira semana.
5. Usuário faz login → select-company → começa a operar.

> Login só funciona com usuário ACTIVE e membership ACTIVE na company. Conta só `INVITED`/`PENDING` **não** entra no fluxo web útil.

### 3.4 Boas práticas piloto

- Começar com **OWNER + 1 AGENT** (não escalar time antes do WhatsApp estável).
- Não convidar OWNER extras sem necessidade (limite 1 company/user ainda vale para novos owners criarem outra empresa).
- Revogar acesso: `DELETE /api/memberships/:id` / revoke-access (API) — sem UI ainda.

### 3.5 Critério de “time pronto”

- [ ] ≥2 logins distintos bem-sucedidos na mesma company  
- [ ] AGENT consegue listar leads e abrir conversas  

---

## 4. Como criar leads

### 4.1 Pela UI (recomendado)

1. Menu **Leads** → **Novo lead**.
2. Preencher: nome, telefone (obrigatório), e-mail/origem/status opcionais.
3. Salvar → aparece na lista; abrir detalhe para editar.

### 4.2 Origens típicas no piloto

| Origem | Como entra |
|--------|------------|
| Manual ( Balcão / planilha ) | Create lead na UI |
| WhatsApp inbound (número novo) | Engine pode criar/associar lead automaticamente no inbound |
| Import futuro | Fora do escopo atual — usar create manual ou API |

### 4.3 Higiene de dados (adoção)

- Telefone no padrão local/E.164 legível; API normaliza dígitos.
- Evitar duplicar o mesmo telefone (API retorna conflito).
- Status sugerido no dia a dia: `NEW` → `CONTACTED` → `RESPONDED` → `QUALIFIED` → `CONVERTED` / `LOST`.
- Atualizar status na ficha do lead após cada contato relevante.

### 4.4 Meta de volume piloto (ordem de grandeza)

| Semana | Leads novos (guia) |
|--------|---------------------|
| 1 | 20–50 (incluindo backlog real) |
| 2–4 | ritmo natural do funil do cliente |

### 4.5 Critério de “leads em uso”

- [ ] ≥20 leads na company  
- [ ] ≥50% com status ≠ `NEW` ao fim da semana 2  

---

## 5. Como usar conversations

### 5.1 Conceito

Uma **conversa** amarra um lead a um canal (`WHATSAPP`) e a uma timeline de mensagens (inbound/outbound).

### 5.2 Fluxo diário do AGENT

1. **Conversas** → inbox ordenada por última mensagem.
2. Abrir thread → ler timeline.
3. Responder:
   - **CRM** (`POST .../messages`): registra mensagem operacional (não depende de Evolution).
   - **WhatsApp** (`/whatsapp/send`): envia de verdade (exige `CONNECTED`).
4. Atalhos: ver lead, follow-ups do lead, fechar conversa se encerrada.

### 5.3 A partir do lead

Na ficha do lead → **Conversas** (filtro `leadId`) → abrir existente ou criar com o UUID do lead.

### 5.4 Regras de adoção

- Preferir **sempre** responder pelo modo WhatsApp quando a linha estiver CONNECTED (cliente vê a mensagem).
- Usar modo CRM só para anotações/treinos ou se o canal estiver fora.
- Não deixar inbox sem dono: OWNER define quem olha Conversas a cada turno.
- Meta: primeira resposta humana/IA no mesmo dia útil do inbound.

### 5.5 Critério de “conversations em uso”

- [ ] ≥10 conversas com ≥1 mensagem nos dois lados (in+out)  
- [ ] Tempo mediano até primeira resposta outbound &lt; 4h úteis (meta aspiracional)  

---

## 6. Como usar follow-ups

### 6.1 Ciclo de vida (API)

```text
SUGGESTED → (approve) → SCHEDULED → (execute) → EXECUTED
                ↘ reject → REJECTED
         SCHEDULED/APPROVED → reschedule
         FAILED → retry (limites da API)
```

### 6.2 Pela UI

1. Em uma conversa: painel **Criar follow-up** (texto sugerido) → vai para detalhe `SUGGESTED`.
2. Em **Follow-ups**: filtrar por status; abrir item.
3. Ações:
   - **Aprovar** (+ data) → `SCHEDULED`
   - **Rejeitar** (motivo obrigatório)
   - **Reagendar**
   - **Executar** (WhatsApp CONNECTED) → envia `suggestedBody`
   - **Retry** se `FAILED`

### 6.3 Cadência sugerida no piloto

| Momento | Follow-up |
|---------|-----------|
| Lead sem resposta em 24h | 1º recovery |
| Após proposta enviada | Lembrete 48–72h |
| Sugerido por IA | Review humano → approve/reject no mesmo turno |

### 6.4 Regras de adoção

- **Nunca** executar sem ler o texto.
- Reject com motivo útil (treina qualidade / futuro prompt).
- Não acumular `SCHEDULED` vencidos sem execute ou reschedule.
- Se Evolution cair: pausar executes; não spammar retry.

### 6.5 Critério de “follow-ups em uso”

- [ ] ≥15 follow-ups criados  
- [ ] ≥50% dos `SUGGESTED` decididos (approve/reject) em &lt; 24h  
- [ ] ≥5 `EXECUTED` com sucesso  

---

## 7. Como usar AI Assist

### 7.1 Estado do produto

| Capacidade | Onde |
|------------|------|
| Gerar sugestão | `POST /api/ai/conversations/:conversationId/suggest` |
| Persistir | FollowUp `SUGGESTED` tipo AI (`AI_REPLY` / metadata source) |
| Revisar / aprovar / executar | UI **Follow-ups** (mesmo fluxo da §6) |
| Tela “AI Assist” no web | **Ainda não existe** — usar Swagger/curl ou cliente HTTP |

### 7.2 Fluxo operacional recomendado

1. Garantir `OPENAI_API_KEY` e conversa com contexto (algumas msgs).
2. OWNER/AGENT chama suggest na conversa alvo.
3. Abrir o FollowUp gerado na UI.
4. **Editar mentalmente**: se o texto for fraco → Reject + motivo; se bom → Approve.
5. Execute quando for a hora certa (não disparar automático no dia 1 sem revisão).
6. Medir: quantos suggests aceitos vs rejeitados.

### 7.3 Guardrails do piloto

- Humanos no loop: **approve obrigatório** antes de execute (não ligar execução cega só com scheduler no dia 1).
- Tom: alinhado ao negócio do cliente (veículos/oficina); rejeitar genérico.
- LGPD: não colar dados sensíveis desnecessários no histórico antes do suggest.
- Se 503 OpenAI: registrar incidente; continuar atendimento manual.

### 7.4 Critério de “AI em uso”

- [ ] ≥20 suggests gerados  
- [ ] Taxa de approve (approve / (approve+reject)) documentada  
- [ ] ≥3 executes originados de AI sem reclamação do cliente final  

---

## 8. Como medir sucesso do piloto

Sucesso = **adoção real + resultado de negócio + estabilidade técnica**, não só “sistema no ar”.

### 8.1 Três eixos

| Eixo | Pergunta |
|------|----------|
| Adoção | O time usa Autopilot no fluxo diário? |
| Resultado | Leads são trabalhados e há conversões/contatos recuperados? |
| Confiabilidade | WhatsApp/API/AI ficam estáveis o suficiente? |

### 8.2 Ritual de medição

| Quando | O quê |
|--------|-------|
| Diário (15 min) | Inbox zerada? WA CONNECTED? Falhas óbvias? |
| Semanal (30–45 min) | KPIs dashboard + amostra de conversas + feedback champion |
| Fim do piloto | Scorecard §11 |

### 8.3 Fontes de dados

| Fonte | Uso |
|-------|-----|
| `GET /api/dashboard` | totalLeads, conversões, open conversations, follow-ups pending/overdue |
| Web leads/conversations/follow-ups | amostragem qualitativa |
| `GET /api/ops/diagnostics` | saúde WA/Redis/OpenAI/workers |
| `GET /api/exports/*` (OWNER) | análise offline semanal |
| Entrevista champion | percepção e atritos |

### 8.4 Baseline

Na **semana 0** (antes ou dia 1):

- Registrar volume típico de leads/WhatsApp do cliente (mesmo que manual).
- Tirar screenshot/export do dashboard zerado ou inicial.
- Anotar ferramentas anteriores (planilha, WhatsApp Web puro, CRM antigo).

---

## 9. Quais métricas acompanhar nos primeiros 30 dias

### 9.1 Semana a semana (guia)

| Métrica | Semana 1 | Semanas 2–4 | Onde olhar |
|---------|----------|-------------|------------|
| Leads criados (estoque + novos) | subir rápido | ritmo estável | Dashboard / leads |
| % leads tocados (≠ NEW) | ≥30% | ≥50% | Leads by status |
| Conversas abertas | monitorar | sem explosão sem dono | Dashboard conversations |
| Msgs enviadas / recebidas | tendência ↑ | estável | Dashboard |
| Follow-ups pending / overdue | pending sobe com uso; overdue → 0 | overdue baixo | Dashboard followUps |
| Follow-ups executed | ≥1–2 | ≥5 total | Follow-ups filter EXECUTED |
| AI suggest → approve rate | baseline | ≥40% se IA ativa | Amostra + API |
| WhatsApp uptime (CONNECTED) | &gt;90% horário comercial | &gt;95% | Status + diagnostics |
| Incidentes P0/P1 | 0 ideais | ≤1/semana | Ops log |

### 9.2 Métricas de adoção (pessoas)

| Métrica | Meta 30 dias |
|---------|----------------|
| Logins/semana por AGENT ativo | ≥4 dias/semana |
| % respostas outbound feitas no Autopilot (vs WhatsApp Web paralelo) | ≥70% declarada pelo champion |
| Tempo até primeiro uso de follow-up execute | ≤7 dias após WA connect |

### 9.3 Métricas de negócio (simples)

| Métrica | Como capturar |
|---------|----------------|
| Leads `CONVERTED` | status no CRM |
| Contatos reativados | leads que estavam parados e voltaram a `RESPONDED` |
| Tempo até primeiro contato | qualitativo + timestamps lead/conversation |

Não exigir ROI financeiro formal no primeiro piloto; exigir **sinais direcionais**.

### 9.4 Saúde técnica (não negociável)

- `/health/ready` verde
- Redis/Postgres ok
- Evolution não em stub
- OpenAI configurada se IA estiver no escopo do piloto
- Backlog de filas sob controle se async ligado

---

## 10. Quais feedbacks coletar dos usuários

Usar entrevistas curtas (15 min) no fim das semanas 1, 2 e 4 + canal assíncrono (WhatsApp/Slack com a ops).

### 10.1 Perguntas obrigatórias (champion + AGENT)

1. O que você fazia antes e o que faz agora no Autopilot?
2. Em que momento você ainda volta para o WhatsApp Web / planilha? Por quê?
3. O que mais atrapalhou esta semana? (QR, lentidão, texto da IA, falta de tela X…)
4. O follow-up automático/manual ajudou a recuperar algum lead? Exemplo.
5. A sugestão de IA foi útil, genérica ou prejudicial? (pegar 2 exemplos)
6. O que falta para você usar isso todo dia sem pensar?
7. Em uma escala 0–10, quanto recomendaria para outra unidade da rede? (NPS interno)
8. Se pudesse mudar **uma** coisa na próxima sprint, qual seria?

### 10.2 Feedback estruturado (tags)

Classificar cada item em `apps/api/docs` / log de feedback futuro:

| Severidade | Exemplos |
|------------|----------|
| P0 | WA cai e não volta; perda de mensagem; vazamento entre empresas |
| P1 | Não consegue convidar usuário sozinho; IA 503 frequente; execute falha |
| P2 | Falta UI de AI/Memberships; filtros; UX mobile |
| P3 | Copy, labels, nice-to-have |

### 10.3 Artefatos a guardar

- [ ] 3 prints de conversas reais (anonimizados)
- [ ] 3 follow-ups aprovados e 3 rejeitados (com motivo)
- [ ] Lista de atritos com data
- [ ] NPS interno + comentário

### 10.4 O que **não** pedir no piloto 1

- Customizações grandes de pipeline
- Integrações ERP/estoque
- App mobile nativo
- Billing / multi-filial complexa

---

## 11. Critérios para considerar o piloto aprovado

Avaliar no **D30** (ou D21 se piloto curto). Decisão: **APROVADO** / **APROVADO COM RESSALVAS** / **NÃO APROVADO**.

### 11.1 Critérios obrigatórios (todos devem passar)

| # | Critério | Evidência |
|---|----------|-----------|
| O1 | Empresa real operando (não seed) | company slug + users reais |
| O2 | WhatsApp CONNECTED com uso real | inbound+outbound reais |
| O3 | Time mínimo ativo | OWNER + ≥1 AGENT com login semanal |
| O4 | Volume mínimo de trabalho | ≥20 leads; ≥10 conversas bilaterais |
| O5 | Follow-ups no fluxo | ≥5 EXECUTED com sucesso |
| O6 | Estabilidade | ≤1 incidente P0 no período; WA uptime comercial ≥90% |
| O7 | Champion recomenda continuar | NPS interno ≥7 **ou** decisão explícita de seguir |

### 11.2 Critérios desejáveis (aprovar com ressalvas se faltarem ≤2)

| # | Critério |
|---|----------|
| D1 | AI: ≥20 suggests e approve rate ≥40% |
| D2 | ≥50% leads tocados (status ≠ NEW) |
| D3 | Overdue follow-ups ≈ 0 na última semana |
| D4 | Atendimento majoritariamente dentro do Autopilot (≥70% declarado) |
| D5 | Zero P0 de isolamento multi-tenant / segurança |

### 11.3 Critérios de NÃO aprovação (qualquer um derruba)

- WhatsApp não estabiliza (reconnect diário sem causa externa)
- Time abandona a ferramenta após semana 2
- Perda recorrente de mensagens / dúvida de dados entre empresas
- Champion declara que não usará sem feature bloqueante **e** não há workaround ops

### 11.4 Resultado e próximos passos

| Resultado | Ação |
|-----------|------|
| **APROVADO** | Planejar 2º piloto ou expansão de usuários; backlog priorizado pelo feedback P1/P2 |
| **APROVADO COM RESSALVAS** | Lista curta de correções (ex.: UI AI, convite com senha); novo checkpoint em 2 semanas |
| **NÃO APROVADO** | Postmortem; congelar aquisição; corrigir P0/P1 antes de novo cliente |

### 11.5 Template de decisão (preencher no D30)

```text
Cliente: _______________
Período: ___/___/___ → ___/___/___
Leads: ___ | Conversas bilaterais: ___ | FU executed: ___
AI suggests: ___ | Approve rate: ___%
WA uptime comercial: ___%
NPS interno: ___
Incidentes P0: ___
Decisão: APROVADO / APROVADO COM RESSALVAS / NÃO APROVADO
Ressalvas / próximos passos:
-
-
```

---

## Roteiro rápido de onboarding (primeira semana)

| Dia | Foco |
|-----|------|
| D0 | Deploy ok; OWNER provisionado; empresa criada; settings |
| D1 | WhatsApp QR → CONNECTED; 1 inbound/outbound teste |
| D2 | AGENT ativado; import/criação de 20 leads; rotina inbox |
| D3 | Follow-ups manuais no fluxo de recovery |
| D4–D5 | Ligar AI suggest (API) + review na UI follow-ups |
| D7 | Retro semana 1 (feedback §10 + métricas §9) |

---

## Referências

| Doc | Uso |
|-----|-----|
| `docs/pilot-deployment-plan.md` | Infra, env, go-live técnico |
| `docs/frontend-architecture.md` | Mapa do produto SaaS |
| `docs/frontend-sprint1-review.md` / `sprint2-review.md` | O que a UI já cobre |
| `apps/api/docs/go-live-checklist.md` | Checklist técnico API |
| `apps/api/docs/runbooks/*` | Incidentes WA/Redis/workers/AI/auth |
| `apps/api/docs/pilot-enablement-review.md` | Memberships INVITED, setup, exports |

---

**Fim do playbook.** Foco: fazer o cliente operar de ponta a ponta e decidir, com evidência, se o produto merece o próximo piloto.
