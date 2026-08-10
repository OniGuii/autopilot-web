# Outbound V1.2 — Lead Import Engine Review

**Status:** Implementado  
**Branch:** `cursor/outbound-lead-import-v1-2-dd93`  
**Design:** `docs/outbound-sales-engine-v1-design.md` §4  
**Base:** Outbound Protection V1.1  
**Data:** 2026-08-10

---

## Objetivo

Permitir importação em massa de leads (CSV / XLSX / colar tabela) com preview, mapeamento de colunas, validação e commit parcial — **sem** campanhas, first-touch ou disparos.

---

## Entregue

| Item | Status |
|------|--------|
| `LeadImportBatch` + RLS (staged rows JSON) | ✅ |
| Upload CSV | ✅ |
| Upload XLSX (exceljs) | ✅ |
| Paste table / TSV-CSV text | ✅ |
| Preview (20 linhas) | ✅ |
| Column mapping + aliases PT | ✅ |
| Validação telefone BR E.164-ish (digits + 55) | ✅ |
| Dedupe arquivo + DB | ✅ |
| Suppress check (V1.1) | ✅ |
| Import parcial (skip inválidos/dup/suppress) | ✅ |
| Relatório de erros por linha | ✅ |
| Commit → `Lead` NEW + metadata | ✅ |
| Dashboard `/api/outbound/import/dashboard` | ✅ |
| UI `/outbound/import` wizard | ✅ |
| Audits `OUTBOUND_IMPORT_*` | ✅ |
| Prometheus `outbound_import_*` | ✅ |
| Unit + e2e | ✅ |
| Review + executive | ✅ |

---

## Fora do escopo

- Outbound Campaign (V1.3+)  
- First Touch Engine  
- Disparos / sequences  
- Entidade paralela de lead (reusa `Lead`)

---

## Fluxo

```text
UPLOAD/PASTE
  → LeadImportBatch UPLOADED (stagedData + preview + guessed mapping)
MAP
  → columnMapping (phone obrigatório)
VALIDATE (dry-run)
  → report: valid / invalid / duplicates / suppressed / ignored
COMMIT
  → cria Lead (NEW) só para válidos
  → metadata: city/product/value/notes + importBatchId
  → COMPLETED
```

---

## APIs

| Método | Path |
|--------|------|
| GET | `/api/outbound/import/dashboard` |
| GET | `/api/outbound/import/batches` |
| GET | `/api/outbound/import/batches/:id` |
| POST | `/api/outbound/import/batches/upload` (multipart) |
| POST | `/api/outbound/import/batches/paste` |
| PATCH | `/api/outbound/import/batches/:id/mapping` |
| POST | `/api/outbound/import/batches/:id/validate` |
| POST | `/api/outbound/import/batches/:id/commit` |
| POST | `/api/outbound/import/batches/:id/cancel` |

Roles: OWNER / ADMIN.

---

## Persistência

- **Lead** = destino final (sem tabela paralela de prospect).  
- **LeadImportBatch** = job/staging (headers, mapping, staged rows, report).  
- Telefone armazenado como dígitos (compatível com `normalizePhone` / suppress).  
- Extras → `Lead.metadata`.

---

## Limites

- Máx. **500** linhas / batch  
- Máx. **2 MB** upload  
- Preview **20** linhas  

---

## Observabilidade

**Audits:** `OUTBOUND_IMPORT_CREATED` · `MAPPING_UPDATED` · `VALIDATED` · `COMMITTED` · `CANCELLED` · `FAILED`  

**Prometheus:**  
`outbound_import_uploaded_total` · `outbound_import_rows_total` · `outbound_import_validated_total{result}` · `outbound_import_committed_total` · `outbound_import_skipped_total` · `outbound_import_failed_total`

**Ops:** dashboard de import + métricas Prometheus (sem alterar fila WhatsApp outbound).

---

## PARAR

Não iniciar V1.3. Não criar first-touch.
