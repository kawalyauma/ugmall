ALTER TABLE "orders" ADD COLUMN "device_id" text;
--> statement-breakpoint
CREATE INDEX "orders_device_idx" ON "orders" USING btree ("device_id");
