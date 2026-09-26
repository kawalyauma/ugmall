CREATE TYPE "public"."location_level" AS ENUM('region', 'district', 'division', 'parish', 'village');--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"level" "location_level" NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"delivery_zone_id" uuid,
	"is_custom" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "location_id" integer;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "nearby_place" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "location_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "location_path" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "nearby_place" text;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "locations_parent_idx" ON "locations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "locations_zone_idx" ON "locations" USING btree ("delivery_zone_id");--> statement-breakpoint
CREATE INDEX "locations_name_idx" ON "locations" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "locations_unique_child" ON "locations" USING btree ("parent_id","level",lower("name"));