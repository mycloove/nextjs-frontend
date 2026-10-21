-- Store only successful feature use: account, feature key, and completion time.
-- No file names, document contents, prompts, or request payloads are retained.
CREATE TABLE "feature_usage_events" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tool_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_usage_events_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "feature_usage_events_user_id_created_at_idx"
    ON "feature_usage_events"("user_id", "created_at" DESC);
CREATE INDEX "feature_usage_events_tool_id_created_at_idx"
    ON "feature_usage_events"("tool_id", "created_at" DESC);
CREATE UNIQUE INDEX "feature_usage_events_event_id_key"
    ON "feature_usage_events"("event_id");
