-- M2: Partial unique indexes for soft-delete-aware business rules
-- See docs/migration-plan.md and docs/prisma-review.md
-- Note: without CONCURRENTLY to remain compatible with Prisma migration transactions.

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_company_phone_active
ON leads (company_id, phone)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_company_user_active
ON memberships (company_id, user_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_company_channel_external_active
ON conversations (company_id, channel, external_thread_id)
WHERE external_thread_id IS NOT NULL
  AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_company_external_active
ON messages (company_id, external_message_id)
WHERE external_message_id IS NOT NULL
  AND deleted_at IS NULL;
