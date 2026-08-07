# Branding Hardening — Review

**Tipo:** prevenção de regressões visuais (sem features novas)  
**Data:** 2026-08-07  
**Base:** pós fix login (`PR #56`)  
**Branch:** `cursor/branding-hardening-dd93`  
**Contexto:** regressão do Product Polish em que `BrandMark` sem tamanho intrínseco expandia para o viewport (`docs/login-regression-audit.md`)

---

## Objetivo

Garantir que nenhum SVG, logo ou BrandMark consiga quebrar a UI novamente — mesmo se o CSS Tailwind falhar parcial ou totalmente.

---

## Inventário auditado

| Área | Onde | Achado pré-hardening |
|------|------|----------------------|
| Logo / BrandMark | `components/brand/logo.tsx` | Já tinha width/height + fill hex (fix #56); faltavam caps CSS e `size` tipado |
| BrandLogo | mesmo arquivo + shell/logout | Sem `overflow-hidden` / `max-w-full` no wrapper |
| SVGs inline | só `BrandMark` no app | Único SVG de marca; Lucide usa width/height próprios |
| Backgrounds SVG | nenhum | Backgrounds são CSS gradients em `globals.css` |
| Favicon | `app/icon.svg`, `app/favicon.ico` | `icon.svg` sem width/height HTML |
| Hero login | `(public)/login/page.tsx` | Brand hero ok; container sem overflow guards |
| QR WhatsApp | `whatsapp/page.tsx` | `img` sem width/height HTML |
| Preview logo settings | `settings/page.tsx` | `img` sem width/height + overflow |
| Absolutos viewport | drawer mobile, dialog | Contidos (overlay intencional); sem brand absoluto |

---

## Regras aplicadas

| Regra | Como |
|-------|------|
| width e height explícitos | HTML attrs em `BrandMark` (`size`, default 32, cap 64); `icon.svg` 32×32; QR 256×256; preview logo 192×48 |
| max-width: 100% | Classes + regra global `img` e `svg[data-brand-mark]` / `[data-brand-logo]` |
| overflow hidden | Wrappers de BrandLogo, hero login, shell, QR, preview |
| sem currentColor em shapes principais | Fill/stroke hex (`#0F5C4C`, `#E8F5F0`, `#7BC4A8`) |
| sem absoluto de brand no viewport | Nenhum brand em `fixed`/`absolute` sem container; drawer continua com overlay contido |

---

## Defesa em profundidade (`globals.css`)

```css
img { max-width: 100%; height: auto; }

svg[data-brand-mark] {
  max-width: min(100%, 4rem);
  max-height: min(100%, 4rem);
  aspect-ratio: 1 / 1;
  overflow: hidden;
}

[data-brand-logo] { max-width: 100%; overflow: hidden; }
```

Mesmo que alguém remova classes Tailwind do mark, o teto de **4rem** impede o “bloco gigante”.

---

## Arquivos alterados

- `apps/web/src/components/brand/logo.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/icon.svg`
- `apps/web/src/app/(public)/login/page.tsx`
- `apps/web/src/app/(public)/logout/page.tsx`
- `apps/web/src/components/layout/app-shell.tsx`
- `apps/web/src/app/(app)/whatsapp/page.tsx`
- `apps/web/src/app/(app)/settings/page.tsx`
- `docs/branding-hardening-review.md`

---

## Checklist de prevenção (para PRs futuros)

- [ ] Todo SVG de marca tem `width` + `height` HTML (não só `viewBox`)
- [ ] Shape principal usa cor hex/token — não `currentColor` para o fill do mark
- [ ] Wrapper com `max-w-full` + `overflow-hidden` quando o logo fica em header/sidebar
- [ ] `img` de logo/QR com dimensões intrínsecas + `max-w-full`
- [ ] Nenhum brand em `position: absolute/fixed` cobrindo viewport sem container limitado
- [ ] Favicon SVG com width/height

---

## Validação sugerida

1. `/login` — mark ~40px; Autopilot hero  
2. DevTools → remover stylesheet — mark ≤ 4rem (não viewport)  
3. Shell desktop/mobile + logout — logo truncável, sem overflow  
4. WhatsApp QR_PENDING — QR cabe no card  
5. Settings com `logoUrl` — preview limitado a h-12  

---

## Fora de escopo

- Novas features / redesign  
- Troca de biblioteca de ícones (Lucide)  
- Billing / white-label completo  

---

## Resultado

Branding endurecido em camadas (HTML attrs + CSS utilitário + caps globais + containers). A regressão do bloco preto no login **não deve se repetir** por SVG de marca sem tamanho.
