-- Phase 4: FollowUp metadata for retry attempt tracking (P4-R4 / P4-D5)
ALTER TABLE "follow_ups"
ADD COLUMN "metadata" JSONB;
