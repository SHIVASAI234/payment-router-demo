import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { scenarios, type AttemptStatus, type Provider, type Scenario } from '../shared/scenarios';
import { simulatorPool, transaction } from './db';

export type ProviderRequest = { intent_id: string; provider: Provider; idempotency_key: string; scenario: Scenario; amount_cents: number; currency: string };
type Clock = () => number;
export class Simulator {
  constructor(private now: Clock = Date.now) {}
  async send(request: ProviderRequest): Promise<AttemptStatus> {
    if (request.provider === 'atlas' && request.scenario === 'outage') return 'not_sent';
    return transaction(async db => {
      const primary = request.provider === 'atlas';
      const final = !primary ? 'succeeded' : request.scenario === 'decline' ? 'declined' : request.scenario === 'no_charge' ? 'no_charge' : request.scenario === 'unresolved_timeout' ? 'pending' : 'succeeded';
      const delay = primary ? scenarios[request.scenario].delay : 0;
      await db.query(`INSERT INTO simulator_requests(idempotency_key,intent_id,provider,scenario,amount_cents,currency,final_status,ready_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO NOTHING`,
        [request.idempotency_key, request.intent_id, request.provider, request.scenario, request.amount_cents, request.currency, final, delay === null ? null : new Date(this.now() + delay)]);
      return this.resolve(db, request.idempotency_key, request);
    }, simulatorPool);
  }
  async lookup(key: string): Promise<AttemptStatus> {
    return transaction(db => this.resolve(db, key), simulatorPool);
  }
  private async resolve(db: PoolClient, key: string, expected?: ProviderRequest): Promise<AttemptStatus> {
    const { rows: [request] } = await db.query('SELECT * FROM simulator_requests WHERE idempotency_key=$1 FOR UPDATE', [key]);
    // Absence is not proof that a request will never arrive. Never fail over here.
    if (!request) return 'pending';
    if (expected && (request.intent_id !== expected.intent_id || request.provider !== expected.provider || request.amount_cents !== expected.amount_cents || request.currency !== expected.currency || request.scenario !== expected.scenario)) throw new Error('Provider idempotency payload mismatch');
    if (!request.ready_at || new Date(request.ready_at).getTime() > this.now()) return 'pending';
    if (request.final_status === 'succeeded') {
      await db.query(`INSERT INTO simulator_charges(id,intent_id,provider,idempotency_key,amount_cents,currency)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING`,
        [randomUUID(), request.intent_id, request.provider, key, request.amount_cents, request.currency]);
    }
    return request.final_status;
  }
}
