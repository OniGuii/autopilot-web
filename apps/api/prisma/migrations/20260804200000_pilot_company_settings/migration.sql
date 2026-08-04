-- Fase 10 — Pilot Enablement: company settings fields + slug unique parcial

CREATE TYPE "CompanyCurrency" AS ENUM ('BRL', 'USD', 'EUR');

ALTER TABLE "companies"
  ADD COLUMN "locale" VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN "business_hours" JSONB,
  ADD COLUMN "logo_url" VARCHAR(500),
  ADD COLUMN "currency" "CompanyCurrency" NOT NULL DEFAULT 'BRL';

CREATE UNIQUE INDEX "uq_companies_slug_active"
  ON "companies" ("slug")
  WHERE "slug" IS NOT NULL AND "deleted_at" IS NULL;
