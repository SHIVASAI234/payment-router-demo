export const scenarios = {
  happy_path: { name: 'Smooth sailing', tag: 'BASELINE', description: 'Atlas accepts the payment on the first try.', outcome: 'Paid with Atlas', delay: 0 },
  outage: { name: 'Provider outage', tag: 'FAILOVER', description: 'Atlas is unavailable before dispatch. Route safely to Beacon.', outcome: 'Paid with Beacon', delay: 0 },
  delayed_success: { name: 'The ambiguous timeout', tag: 'SAFETY FIRST', description: 'Atlas receives the request, but its response times out. Wait for the truth—not a second charge.', outcome: 'Pending → paid with Atlas', delay: 6000 },
  no_charge: { name: 'Confirmed no charge', tag: 'FAILOVER', description: 'Atlas times out, then confirms a terminal no-charge result. Only then can Beacon take over.', outcome: 'Pending → paid with Beacon', delay: 6000 },
  decline: { name: 'Card declined', tag: 'FINAL', description: 'Atlas declines the card. Do not shop the decline around to another provider.', outcome: 'Declined · no failover', delay: 0 },
  duplicate_webhook: { name: 'Duplicate webhooks', tag: 'IDEMPOTENCY', description: 'The same signed provider event arrives twice. Process it once.', outcome: 'One event · one charge', delay: 4000 },
  concurrent_retry: { name: 'Concurrent retries', tag: 'RACE CONDITION', description: 'Eight requests race for the same payment. Stable keys and database locks keep them together.', outcome: 'Eight retries · one charge', delay: 4000 },
  unresolved_timeout: { name: 'Still awaiting the truth', tag: 'PENDING', description: 'Atlas cannot yet confirm an outcome. No amount of retrying makes failover safe.', outcome: 'Stays pending · no failover', delay: null },
} as const;
export type Scenario = keyof typeof scenarios;
export type Provider = 'atlas' | 'beacon';
export type AttemptStatus = 'prepared' | 'pending' | 'succeeded' | 'not_sent' | 'no_charge' | 'declined';
export const AMOUNT_CENTS = 4999;
export const CURRENCY = 'EUR';
