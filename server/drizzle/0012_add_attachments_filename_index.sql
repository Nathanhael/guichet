CREATE INDEX "idx_messages_attachments_gin" ON "messages" USING gin ("attachments");--> statement-breakpoint
CREATE INDEX "idx_messages_media_url" ON "messages" USING btree ("media_url");