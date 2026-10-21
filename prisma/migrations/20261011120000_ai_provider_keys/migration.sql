-- AI provider key broker. Purely additive: three new tables and two enums.
-- Nothing existing is altered, so this migration is safe on a live database.

-- CreateEnum
CREATE TYPE "ai_driver" AS ENUM ('openai_compatible', 'gemini_native', 'huggingface');

-- CreateEnum
CREATE TYPE "ai_feature" AS ENUM ('document_ai_chat', 'ai_analyzer_summary', 'document_ai_embedding');

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "driver" "ai_driver" NOT NULL,
    "base_url" TEXT,
    "chat_model" TEXT,
    "embedding_model" TEXT,
    "embedding_dim" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_keys" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "label" TEXT,
    "ciphertext" TEXT NOT NULL,
    "last4" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_error" TEXT,
    "last_used_at" TIMESTAMPTZ(6),
    "cooldown_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_provider_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feature_routes" (
    "id" UUID NOT NULL,
    "feature" "ai_feature" NOT NULL,
    "provider_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_feature_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_key_key" ON "ai_providers"("key");

-- CreateIndex
CREATE INDEX "ai_provider_keys_provider_id_enabled_idx" ON "ai_provider_keys"("provider_id", "enabled");

-- CreateIndex
CREATE INDEX "ai_feature_routes_feature_priority_idx" ON "ai_feature_routes"("feature", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feature_routes_feature_provider_id_key" ON "ai_feature_routes"("feature", "provider_id");

-- AddForeignKey
ALTER TABLE "ai_provider_keys" ADD CONSTRAINT "ai_provider_keys_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feature_routes" ADD CONSTRAINT "ai_feature_routes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
