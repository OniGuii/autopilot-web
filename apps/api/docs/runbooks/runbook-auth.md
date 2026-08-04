# Runbook — Auth & Sessions

**Serviço:** API Autopilot (`/api/auth/*`)  
**Sintomas:** 401 Session invalid, login falha, select-company vazio, logout-all em cascata

---

## Checks rápidos

```bash
curl -sS "$API/health/ready"
curl -sS -X POST "$API/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@pilot.autopilot.dev","password":"…"}'
```

- Postgres up? Redis up? (`/health/ready`)
- User `ACTIVE`, Membership `ACTIVE`, Company `ACTIVE`
- JWT secrets configurados (`JWT_ACCESS_SECRET` ≥ 32 chars)

---

## Incidentes comuns

### Login 401 genérico
1. Confirmar email/senha (seed piloto: `Demo@12345` só em non-prod)
2. User `PENDING` / sem `passwordHash` (convites INVITED) → não loga até fluxo futuro
3. User `DISABLED` → reativar só se política permitir (piloto: preferir membership)

### Session invalid no meio do uso
1. `AUTH_MAX_SESSIONS` — novos logins revogam sessions antigas
2. `POST /auth/logout-all` ou revoke membership
3. Redis cache de access principal inconsistente → invalidar padrão `autopilot:auth:access:*`

### select-company 403/404
1. Membership não `ACTIVE` (INVITED/REVOKED)
2. Company `SUSPENDED`/`CLOSED` ou soft-deleted
3. Slug errado (`autopilot-demo` no seed piloto)

### Último OWNER revogado
- API protege com `LAST_OWNER_PROTECTED`
- Recovery: bypass RLS admin + reativar membership OWNER (procedimento DB controlado)

---

## Mitigações piloto

- Limitar dispositivos / orientar re-login após logout-all remoto
- Não usar disable global de User (D2 Fase 10)
- Monitorar `AUTH_LOGOUT_ALL` / `MEMBERSHIP_REVOKE` no Audit Explorer
