ALTER TABLE "delivery_zones" ALTER COLUMN "methods" SET DEFAULT '{boda}'::text[];--> statement-breakpoint
-- No pickup stations: remove "pickup" from every zone's delivery options (keep at least boda).
UPDATE "delivery_zones" SET "methods" = array_remove("methods", 'pickup') WHERE 'pickup' = ANY("methods");--> statement-breakpoint
UPDATE "delivery_zones" SET "methods" = '{boda}' WHERE cardinality("methods") = 0;
