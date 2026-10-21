-- External integration connections (Mr. Markdown GitHub read-only connect).
-- Purely additive: two new tables. Nothing existing is altered, so this
-- migration is safe on a live database and rolls back by dropping the tables.

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "account_login" TEXT,
    "account_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "sealed_meta" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_repo_links" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "repo_id" TEXT NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    "default_branch" TEXT,
    "selected_path" TEXT,
    "last_read_at" TIMESTAMPTZ(6),

    CONSTRAINT "integration_repo_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_user_id_provider_idx" ON "integration_connections"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_user_id_provider_external_id_key" ON "integration_connections"("user_id", "provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_repo_links_connection_id_repo_id_key" ON "integration_repo_links"("connection_id", "repo_id");

-- AddForeignKey
ALTER TABLE "integration_repo_links" ADD CONSTRAINT "integration_repo_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
