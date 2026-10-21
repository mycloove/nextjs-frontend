-- Add a non-secret display prefix to provider keys so the bench can show
-- "sk-or-v1-4d…d8f" instead of a bare "…d8f". Purely additive: the column is
-- nullable, existing rows keep NULL, and the view falls back to "…last4".

-- AlterTable
ALTER TABLE "ai_provider_keys" ADD COLUMN "prefix" TEXT;
