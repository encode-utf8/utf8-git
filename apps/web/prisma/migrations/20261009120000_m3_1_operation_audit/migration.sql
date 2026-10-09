-- CreateTable
CREATE TABLE "operation_audit" (
    "id" SERIAL NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operation_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operation_audit_idempotency_key_id_idx" ON "operation_audit"("idempotency_key", "id");

-- CreateIndex
CREATE INDEX "operation_audit_repo_recorded_at_idx" ON "operation_audit"("repo", "recorded_at");