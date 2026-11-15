import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AMOUNT_CENTS, CURRENCY, type AttemptStatus, type Provider, type Scenario } from '../shared/scenarios';
import { pool, transaction } from './db';
import { Simulator } from './simulator';

export class NotFound extends Error {}
export class Conflict extends Error {}
export class InvalidWebhook extends Error {}
export type Intent = { id: string; order_id: string; amount_cents: number; currency: string; scenario: Scenario; status: string; created_at: string };
export type Attempt = { id: string; intent_id: string; provider: Provider; idempotency_key: string; status: AttemptStatus; created_at: string };
export type TimelineEvent = { id: string; kind: string; title: string; detail: string; created_at: string };
export type Payment = Intent & { attempts: Attempt[]; events: TimelineEvent[]; charges: { id: string; provider: Provider; amount_cents: number; currency: string }[]; webhook_count: number };
async function event(db: PoolClient, id: string, key: string, kind: string, title: string, detail: string) {
  await db.query(`INSERT INTO payment_events(intent_id,event_key,kind,title,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT(intent_id,event_key) DO NOTHING`, [id,key,kind,title,detail]);
}
export class PaymentRouter {
  constructor(readonly simulator = new Simulator()) {}
  async create(orderId: string, scenario: Scenario): Promise<Payment> {
    const id = await transaction(async db => {
      await db.query(`INSERT INTO payment_intents(id,order_id,amount_cents,currency,scenario) VALUES($1,$2,$3,$4,$5) ON CONFLICT(order_id) DO NOTHING`, [randomUUID(),orderId,AMOUNT_CENTS,CURRENCY,scenario]);
      const {rows:[intent]} = await db.query<Intent>('SELECT * FROM payment_intents WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (intent.scenario !== scenario) throw new Conflict('This order already has a different scenario. Start a new order.');
      await event(db,intent.id,'created','info','One order. One payment intent.','€49.99 EUR is fixed on the server as 4,999 integer cents. Repeated checkout requests reuse this intent.');
      return intent.id;
    });
    return this.get(id);
  }
  async get(id: string): Promise<Payment> {
    return transaction(async db => {
      // A coherent snapshot, including independently committed provider charges.
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const {rows:[intent]} = await db.query<Intent>('SELECT * FROM payment_intents WHERE id=$1',[id]);
      if (!intent) throw new NotFound('Payment not found');
      const {rows:attempts} = await db.query<Attempt>("SELECT * FROM provider_attempts WHERE intent_id=$1 ORDER BY created_at, provider",[id]);
      const {rows:events} = await db.query<TimelineEvent>('SELECT id,kind,title,detail,created_at FROM payment_events WHERE intent_id=$1 ORDER BY id',[id]);
      const {rows:charges} = await db.query<Payment['charges'][number]>('SELECT id,provider,amount_cents,currency FROM simulator_charges WHERE intent_id=$1 ORDER BY created_at',[id]);
      const {rows:[receipts]} = await db.query('SELECT count(*)::int AS count FROM webhook_receipts WHERE intent_id=$1',[id]);
      return {...intent,attempts,events,charges,webhook_count:receipts.count};
    });
  }
  async run(id: string): Promise<Payment> {
    // Each new attempt is durably prepared BEFORE its external side effect.
    // If a process dies after send, replay uses that provider's original key.
    for (let step=0; step<6; step++) {
      const again = await transaction(async db => {
        const {rows:[intent]} = await db.query<Intent>('SELECT * FROM payment_intents WHERE id=$1 FOR UPDATE',[id]);
        if (!intent) throw new NotFound('Payment not found');
        if (['succeeded','declined','failed'].includes(intent.status)) return false;
        const {rows:attempts} = await db.query<Attempt>('SELECT * FROM provider_attempts WHERE intent_id=$1 ORDER BY created_at,provider',[id]);
        const current = attempts.at(-1);
        if (!current) { await this.prepare(db,intent,'atlas'); return true; }
        if (current.status === 'not_sent' || current.status === 'no_charge') {
          if (current.provider === 'beacon') { await db.query("UPDATE payment_intents SET status='failed' WHERE id=$1",[id]); return false; }
          await event(db,id,'failover','route','Failover is now safe',current.status === 'not_sent' ? 'Atlas request was never sent. No charge is possible; route to Beacon.' : 'Atlas confirmed a terminal no-charge result. Only now may Beacon receive a request.');
          await this.prepare(db,intent,'beacon'); return true;
        }
        const result = current.status === 'prepared'
          ? await this.simulator.send({...current,scenario:intent.scenario,amount_cents:intent.amount_cents,currency:intent.currency})
          : await this.simulator.lookup(current.idempotency_key);
        await this.apply(db,intent,current,result);
        return result === 'not_sent' || result === 'no_charge';
      });
      if (!again) return this.get(id);
    }
    throw new Error('Routing step limit exceeded');
  }
  private async prepare(db: PoolClient, intent: Intent, provider: Provider) {
    const key = `payment:${intent.id}:${provider}:v1`;
    await db.query("INSERT INTO provider_attempts(id,intent_id,provider,idempotency_key,status) VALUES($1,$2,$3,$4,'prepared')",[randomUUID(),intent.id,provider,key]);
    await db.query("UPDATE payment_intents SET status='pending' WHERE id=$1",[intent.id]);
    await event(db,intent.id,`prepare:${provider}`,'route',`Route selected: ${provider === 'atlas' ? 'Atlas' : 'Beacon'}`,`Attempt persisted before dispatch. Every retry uses the same ${provider} idempotency key.`);
  }
  private async apply(db: PoolClient, intent: Intent, attempt: Attempt, status: AttemptStatus) {
    await db.query('UPDATE provider_attempts SET status=$1 WHERE id=$2',[status,attempt.id]);
    const provider = attempt.provider === 'atlas' ? 'Atlas' : 'Beacon';
    if (status === 'pending') {
      await event(db,intent.id,`pending:${attempt.provider}`,'wait','Response unknown. Failover blocked.',`${provider} may have received the request. Keep this payment pending and reconcile with ${provider}; a timeout is not proof of no charge.`);
    } else if (status === 'succeeded') {
      await db.query("UPDATE payment_intents SET status='succeeded' WHERE id=$1",[intent.id]);
      await event(db,intent.id,'paid','success',`Payment confirmed by ${provider}`,'The provider ledger confirms one successful €49.99 charge. No further payment attempts will be sent.');
    } else if (status === 'declined') {
      await db.query("UPDATE payment_intents SET status='declined' WHERE id=$1",[intent.id]);
      await event(db,intent.id,'declined','error','Card declined. Routing stopped.','A card decline is final for this attempt. This demo does not retry it at another provider.');
    } else if (status === 'not_sent') {
      await event(db,intent.id,`not_sent:${attempt.provider}`,'warning',`${provider} unavailable before dispatch`,'The adapter confirms the request was never sent. It is safe to consider the backup provider.');
    } else if (status === 'no_charge') {
      await event(db,intent.id,`no_charge:${attempt.provider}`,'info',`${provider} confirms: no charge`,'Authoritative terminal result: this request cannot settle later. Failover eligibility is now established.');
    }
  }
  async webhook(raw: string, signature: string): Promise<{ duplicate: boolean; payment: Payment }> {
    const expected = signWebhook(raw);
    if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex'))) throw new InvalidWebhook('Invalid webhook signature');
    const body = JSON.parse(raw) as { provider: Provider; event_id: string; intent_id: string; idempotency_key: string };
    if (!['atlas','beacon'].includes(body.provider) || !/^[a-zA-Z0-9:_-]{1,200}$/.test(body.event_id) || !/^[a-f0-9-]{36}$/.test(body.intent_id) || typeof body.idempotency_key !== 'string') throw new InvalidWebhook('Invalid webhook payload');
    const duplicate = await transaction(async db => {
      const {rows:[intent]} = await db.query<Intent>('SELECT * FROM payment_intents WHERE id=$1 FOR UPDATE',[body.intent_id]);
      if (!intent) throw new NotFound('Payment not found');
      const {rows:[attempt]} = await db.query<Attempt>('SELECT * FROM provider_attempts WHERE intent_id=$1 AND provider=$2 AND idempotency_key=$3',[intent.id,body.provider,body.idempotency_key]);
      if (!attempt) throw new InvalidWebhook('Webhook does not match a recorded attempt');
      const receipt = await db.query('INSERT INTO webhook_receipts(provider,event_id,intent_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id',[body.provider,body.event_id,intent.id]);
      if (!receipt.rowCount) {
        await event(db,intent.id,`duplicate:${body.event_id}`,'info','Duplicate webhook ignored','The provider event ID was already processed. No state change and no new charge.');
        return true;
      }
      await event(db,intent.id,`webhook:${body.event_id}`,'info','Signed provider event received','Signature verified; outcome checked against the original provider request, not trusted from the event body.');
      if (['prepared','pending'].includes(attempt.status)) await this.apply(db,intent,attempt,await this.simulator.lookup(attempt.idempotency_key));
      return false;
    });
    return {duplicate,payment:await this.run(body.intent_id)};
  }
}
export function signWebhook(raw: string) {
  if (!process.env.WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET is required');
  return createHmac('sha256',process.env.WEBHOOK_SECRET).update(raw).digest('hex');
}
export const router = new PaymentRouter();
