-- Fase 11C — AUTO supervised: intents HOURS/ADDRESS + conversation.agent_paused

DO $$ BEGIN
  ALTER TYPE "AiIntent" ADD VALUE 'HOURS';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "AiIntent" ADD VALUE 'ADDRESS';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "agent_paused" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "conversations_company_id_agent_paused_idx"
  ON "conversations"("company_id", "agent_paused");
