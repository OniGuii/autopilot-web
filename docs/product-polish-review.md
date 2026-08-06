# Product Polish — Review

**Sprint:** Product Polish  
**App:** `apps/web`  
**Constraint:** nenhuma funcionalidade nova; só texto, UX, branding, responsividade e navegação.  
**Data:** 2026-08-06

---

## Objetivo

Sair do visual de “sistema interno / Sprint N” e chegar a um **produto comercial** reconhecível: português de negócio, identidade própria, estados de UI claros e navegação consistente.

---

## 1. Revisão de textos

| Antes | Depois |
|-------|--------|
| Subtítulos com `` `GET /api/...` `` | Removidos em todas as telas |
| Menu em inglês (`Conversations`, `Team`, `Settings`…) | Português (`Conversas`, `Equipe`, `Configurações`…) |
| “CRM SaaS · Sprint 3” | “CRM comercial” / removido do chrome |
| “credenciais provisionadas na API” | “Acesse com o e-mail e a senha da sua conta” |
| “UUID do lead”, Evolution, CONNECTED cru | Linguagem de produto |
| Roles crus `OWNER` no chrome | Proprietário / Administrador / Agente |
| Metadata “Frontend SaaS — Sprint 1” | Descrição comercial do Autopilot |
| Toasts com status técnicos | Mensagens amigáveis via `friendlyError` |

Arquivos-chave: todas as `page.tsx` do app, `app-shell`, `create-lead-dialog`, `select-company`, `layout` metadata.

---

## 2. UX

### Componentes novos
- `EmptyState` — estados vazios com CTA
- `ErrorPanel` — erros sem vazar paths
- `LoadingBlock` — loading acessível (`role="status"`)
- `friendlyError()` — mapeia 401/403/404/413/5xx

### Confirmações destrutivas
- Sair da conta
- Fechar conversa
- Desconectar WhatsApp
- Remover membro / revogar acesso / encerrar sessões
- Rejeitar / executar follow-up (onde aplicável)

### Listas mobile
- Leads: cards no mobile + tabela no desktop

---

## 3. Branding

| Item | Entrega |
|------|---------|
| Marca | `BrandLogo` + `BrandMark` (triângulo / “A” estilizado) |
| Favicon | `app/icon.svg` (teal `#0F5C4C`) |
| Cores | Forest teal + pedra quente — CSS vars em `globals.css` |
| Fundo | Gradientes brand (sem purple / cream-terracotta clichê) |
| Tipografia | Fraunces (display) + Source Sans 3 (corpo) — mantidas com uso mais consistente |
| Metadata | Título `Autopilot` + template `%s · Autopilot` |

---

## 4. Responsividade

- Drawer mobile com overlay, Escape e fechamento ao navegar
- Breakpoints: cards em listas estreitas; tabelas a partir de `md`
- Header sticky; shell `max-w-[1440px]`
- Login empilha marca + card no mobile
- Setup / settings / forms em grid responsivo

---

## 5. Navegação

| Peça | Detalhe |
|------|---------|
| `lib/nav.ts` | Títulos PT + breadcrumbs + `ROLE_LABEL` |
| `PageHeader` | Trilha + título + descrição + ações |
| Menu | Operação / Administração em PT |
| Hierarquia | Display title → description → conteúdo |

Rotas cobertas com breadcrumbs: painel, leads (+ detalhe), conversas (+ mensagens), follow-ups (+ detalhe), WhatsApp, funil, equipe, usuários, configurações, exportações, diagnósticos, primeiros passos.

---

## Checklist de cobertura por tela

| Tela | Copy limpa | Empty/Loading/Error | Breadcrumbs | Confirms |
|------|:----------:|:-------------------:|:-----------:|:--------:|
| Login | ✓ | loading sessão | — | — |
| Select company | ✓ | empty | ✓ | — |
| Painel | ✓ | ✓ | ✓ | — |
| Leads | ✓ | ✓ + cards mobile | ✓ | — |
| Lead detalhe | ✓ | ✓ | ✓ | — |
| Conversas | ✓ | ✓ | ✓ | — |
| Conversa | ✓ | ✓ | ✓ | fechar |
| Follow-ups | ✓ | ✓ | ✓ | — |
| Follow-up detalhe | ✓ | ✓ | ✓ | rejeitar/executar |
| WhatsApp | ✓ | ✓ | ✓ | desconectar |
| Funil | ✓ | ✓ | ✓ | — |
| Equipe | ✓ | ✓ | ✓ | remover |
| Usuários | ✓ | ✓ | ✓ | sessões/revogar |
| Configurações | ✓ | ✓ | ✓ | — |
| Exportações | ✓ | ✓ | ✓ | — |
| Diagnósticos | ✓ | ✓ | ✓ | — |
| Primeiros passos | ✓ | ✓ | ✓ | — |
| Logout | ✓ | — | — | sair no shell |

---

## Fora do escopo (proposital)

- Novas features (IA, notes, assign, billing…)
- Mudanças em `apps/api`
- Redesign total de componentes shadcn (apenas uso + polish)

---

## Como validar

```bash
cd apps/web
rm -rf .next
PORT=3000 npm run dev
```

Percorrer menu como Proprietário: textos em PT, sem paths de API, drawer no mobile, breadcrumbs nas páginas internas, confirmação ao sair / desconectar WhatsApp / remover membro.

---

## Resultado

O Autopilot web passa a se apresentar como **produto comercial**: marca própria, navegação em português, feedback de UI padrão e menos vazamento técnico — sem alterar o contrato da API.
