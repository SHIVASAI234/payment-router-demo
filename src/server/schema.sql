CREATE TABLE IF NOT EXISTS payment_intents (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents = 4999),
  currency text NOT NULL CHECK (currency = 'EUR'),
  scenario text NOT NULL CHECK (scenario IN ('happy_path','outage','delayed_success','no_charge','decline','duplicate_webhook','concurrent_retry','unresolved_timeout')),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','succeeded','declined','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_attempts (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES payment_intents(id),
  provider text NOT NULL CHECK (provider IN ('atlas','beacon')),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('prepared','pending','succeeded','not_sent','no_charge','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(intent_id, provider)
);
CREATE TABLE IF NOT EXISTS payment_events (
  id bigserial PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES payment_intents(id),
  event_key text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(intent_id, event_key)
);
-- This ledger belongs to the simulator, not the router transaction. There is
-- deliberately NO unique(intent_id): double charging must be observable in tests.
CREATE TABLE IF NOT EXISTS simulator_requests (
  idempotency_key text PRIMARY KEY,
  intent_id uuid NOT NULL,
  provider text NOT NULL,
  scenario text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL,
  final_status text NOT NULL CHECK (final_status IN ('succeeded','no_charge','declined','pending')),
  ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS simulator_charges (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL,
  provider text NOT NULL,
  idempotency_key text NOT NULL UNIQUE REFERENCES simulator_requests(idempotency_key),
  amount_cents integer NOT NULL,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_receipts (
  provider text NOT NULL,
  event_id text NOT NULL,
  intent_id uuid NOT NULL REFERENCES payment_intents(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, event_id)
);
CREATE INDEX IF NOT EXISTS attempts_intent_idx ON provider_attempts(intent_id);
CREATE INDEX IF NOT EXISTS events_intent_idx ON payment_events(intent_id, id);
CREATE INDEX IF NOT EXISTS charges_intent_idx ON simulator_charges(intent_id);
