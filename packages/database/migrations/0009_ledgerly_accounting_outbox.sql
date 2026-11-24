CREATE TABLE IF NOT EXISTS accounting_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('sale', 'refund')),
  entity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  ledgerly_journal_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_type, entity_id)
);
CREATE INDEX IF NOT EXISTS accounting_outbox_pending_idx ON accounting_outbox(status, available_at, created_at);

-- Emit the sale exactly once when prepaid orders are paid or COD orders are delivered.
CREATE OR REPLACE FUNCTION ugmall_enqueue_sale_accounting() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('paid', 'delivered') AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO accounting_outbox (event_type, entity_id)
    VALUES ('sale', NEW.id)
    ON CONFLICT (event_type, entity_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_ledgerly_accounting_outbox ON orders;
CREATE TRIGGER orders_ledgerly_accounting_outbox
AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION ugmall_enqueue_sale_accounting();

-- Completed refunds are accounted separately from the original sale.
CREATE OR REPLACE FUNCTION ugmall_enqueue_refund_accounting() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'succeeded' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO accounting_outbox (event_type, entity_id)
    VALUES ('refund', NEW.id)
    ON CONFLICT (event_type, entity_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refunds_ledgerly_accounting_outbox ON refunds;
CREATE TRIGGER refunds_ledgerly_accounting_outbox
AFTER UPDATE OF status ON refunds
FOR EACH ROW EXECUTE FUNCTION ugmall_enqueue_refund_accounting();
