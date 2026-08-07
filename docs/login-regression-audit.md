# Login Visual Regression — Audit & Fix

**Tipo:** correção de regressão visual (sem features novas)  
**Data:** 2026-08-07  
**Introduzida em:** Product Polish (PR #53 / `a5a7190`)  
**Branch:** `cursor/fix-login-visual-regression-dd93`

---

## Sintomas reportados

- Forma preta gigante ocupando quase toda a tela
- Aparência de HTML cru
- Inputs sem estilo
- Suspeita de perda de Tailwind/Shadcn
- Layout diferente do login pré–Product Polish

---

## Causa raiz exata

O componente `BrandMark` criado no Product Polish (`apps/web/src/components/brand/logo.tsx`) e usado no login via `BrandLogo`:

1. Declarava SVG só com `viewBox="0 0 32 32"` **sem** atributos HTML `width` / `height`
2. Dependia 100% das classes Tailwind `h-8 w-8` para dimensionar
3. Usava `fill="currentColor"` + `className="text-primary"` no `<rect>`

Quando o CSS do app **não aplica** (`.next` corrompido, 404 em `/_next/static/css/...`, FOUC prolongado, etc.):

| Efeito | Resultado visual |
|--------|------------------|
| `h-8 w-8` ausentes | SVG escala para ~viewport (reproduzido: **1424×1424** em 1440×900) |
| `text-primary` ausente | `currentColor` cai no default do browser → **preto** |
| Utilitários Shadcn ausentes | Inputs/botão/card viram HTML nativo |

Isso reproduz **exatamente** a “forma preta gigante” + “HTML cru” + “inputs sem estilo”.

### Reprodução controlada

Com CSS carregado: SVG ~32–40px, inputs estilizados.  
Removendo `<link rel="stylesheet">` em runtime: SVG → ~viewport preto; form sem estilo.

Arquivos de evidência:

- `/opt/cursor/artifacts/screenshots/login-regression.png` (CSS ok, pré-fix)
- `/opt/cursor/artifacts/screenshots/login-no-css.png` (CSS removido — regressão)
- `/opt/cursor/artifacts/screenshots/login-fixed.png` / `login-fixed-no-css.png` (pós-fix)

### O que NÃO era a causa

| Hipótese | Veredito |
|----------|----------|
| `globals.css` sem `@import "tailwindcss"` | Intactos |
| `layout.tsx` sem import de `globals.css` | Intactos |
| Remoção acidental de Shadcn Input/Card | Intactos — classes corretas no HTML |
| `icon.svg` (favicon) quebrando a página | Só `rel="icon"`; não entra no layout |
| Tailwind PostCSS desconfigurado | `postcss.config.mjs` + build CSS ok (~50KB) |

### Causa secundária (layout)

O polish trocou o hero tipográfico **“Autopilot”** (`text-5xl`/`text-6xl`) por um `BrandLogo` pequeno + headline “Seu CRM…”, enfraquecendo a marca no primeiro viewport. Isso explica o “layout diferente do esperado”, separado do bloco preto.

---

## Arquivos afetados

| Arquivo | Papel |
|---------|--------|
| `apps/web/src/components/brand/logo.tsx` | **Causa raiz** — SVG sem tamanho intrínseco + `currentColor` |
| `apps/web/src/app/(public)/login/page.tsx` | Consome BrandMark/BrandLogo no hero |
| `apps/web/src/app/icon.svg` | Favicon (referência de cores; não causa o bug) |
| `apps/web/src/app/globals.css` | Intactos (não quebram Tailwind) |
| `apps/web/src/app/layout.tsx` | Intactos |

Também usam `BrandMark`/`BrandLogo` (beneficiam do fix): `app-shell.tsx`, `logout/page.tsx`.

---

## Diff mínimo para correção

### 1. `logo.tsx` — endurecer o SVG

- Adicionar `xmlns`, `width="32"`, `height="32"`
- Trocar `fill="currentColor"` por fill hex `#0F5C4C` (igual `icon.svg`)
- Strokes com cores hex (não dependem de CSS)

Assim o mark permanece ~32px e teal **mesmo sem CSS**.

### 2. `login/page.tsx` — restaurar brand hero

- Voltar **Autopilot** como sinal tipográfico hero (`text-5xl` / `md:text-6xl`)
- Manter `BrandMark` ao lado (agora seguro)
- Manter copy de suporte do polish (sem headline competindo com a marca)

---

## Mitigação operacional (CSS ausente)

Se inputs ainda aparecerem crus, o stylesheet não está carregando — limpar cache e subir de novo:

```bash
cd apps/web && rm -rf .next && PORT=3000 npm run dev
```

O fix do SVG elimina o bloco preto catastrófico mesmo nesse cenário; o form cru só some quando o CSS volta a servir.

---

## Validação

1. Abrir `/login` com CSS normal — brand hero + card Shadcn  
2. DevTools → remover stylesheet — mark permanece 32px (não preenche a tela)  
3. Shell/logout ainda mostram logo correto  

---

## Resultado

| Antes do fix (sem CSS) | Depois do fix (sem CSS) |
|------------------------|-------------------------|
| SVG ~1424×1424 preto | SVG 32×32 com cor de marca |
| Página inutilizável | Degradado, mas legível; com CSS, layout restaurado |
