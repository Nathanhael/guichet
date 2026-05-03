ALTER TABLE "partners" ALTER COLUMN "ai_provider" SET DEFAULT 'azure';
--> statement-breakpoint
-- Migrate existing rows: stripping the OllamaProvider class means any partner
-- still pointing at 'ollama' would now resolve to no provider at runtime.
-- 'azure' matches the new schema default + the deployment env vars.
UPDATE "partners" SET "ai_provider" = 'azure' WHERE "ai_provider" = 'ollama';