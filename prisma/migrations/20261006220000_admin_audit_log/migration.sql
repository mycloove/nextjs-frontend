-- Add an append-only record of privileged changes without changing the quota
-- tables or the reads used by conversion requests.
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "request_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_created_at_idx"
    ON "admin_audit_logs"("created_at" DESC);
CREATE INDEX "admin_audit_logs_actor_id_created_at_idx"
    ON "admin_audit_logs"("actor_id", "created_at" DESC);
CREATE INDEX "admin_audit_logs_action_created_at_idx"
    ON "admin_audit_logs"("action", "created_at" DESC);
