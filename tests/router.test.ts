import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/server/migrate';
import { pool, simulatorPool } from '../src/server/db';
import { PaymentRouter, Conflict, InvalidWebhook, signWebhook } from '../src/server/router';
import { Simulator, type ProviderRequest } from '../src/server/simulator';
import type { Scenario } from '../src/shared/scenarios';

let now = Date.now();
const simulator = new Simulator(() => now);
const router = new PaymentRouter(simulator);
async function start(scenario: Scenario) { return router.run((await router.create(randomUUID(),scenario)).id); }
before(async () => { process.env.WEBHOOK_SECRET ||= 'test-only-secret'; await migrate(); });
after(async () => { await pool.end(); await simulatorPool.end(); });

test('normal payment persists integer cents and one successful simulator charge', async () => {
  const p = await start('happy_path');
  assert.equal(p.amount_cents,4999); assert.equal(p.currency,'EUR');
  assert.equal(p.status,'succeeded'); assert.equal(p.charges.length,1);
  assert.equal(p.charges[0].amount_cents,4999); assert.equal(p.attempts.length,1);
});
test('provider outage before dispatch permits Beacon without sending to Atlas', async () => {
  const p = await start('outage');
  assert.equal(p.status,'succeeded'); assert.deepEqual(p.attempts.map(a=>a.status),['not_sent','succeeded']);
  assert.equal(p.charges.length,1); assert.equal(p.charges[0].provider,'beacon');
  assert.equal((await simulatorPool.query('SELECT * FROM simulator_requests WHERE intent_id=$1 AND provider=\'atlas\'',[p.id])).rowCount,0);
});
test('ambiguous timeout remains pending through retries, then original provider confirms exactly one charge', async () => {
  const p = await start('delayed_success');
  assert.equal(p.status,'pending'); assert.equal(p.charges.length,0);
  const key = p.attempts[0].idempotency_key;
  const pending = await Promise.all(Array.from({length:24},()=>router.run(p.id)));
  for (const r of pending) { assert.equal(r.status,'pending'); assert.equal(r.attempts.length,1); assert.equal(r.attempts[0].idempotency_key,key); }
  now += 7000;
  const final = await Promise.all(Array.from({length:24},()=>router.run(p.id)));
  for (const r of final) { assert.equal(r.status,'succeeded'); assert.equal(r.attempts.length,1); assert.equal(r.charges.length,1); assert.equal(r.charges[0].provider,'atlas'); }
});
test('confirmed terminal no-charge is required before failover and total successful charges is exactly one', async () => {
  const p = await start('no_charge');
  assert.equal(p.status,'pending'); assert.equal(p.attempts.length,1);
  assert.equal((await router.run(p.id)).attempts.length,1);
  now += 7000;
  const done = await router.run(p.id);
  assert.equal(done.status,'succeeded'); assert.deepEqual(done.attempts.map(a=>a.status),['no_charge','succeeded']);
  assert.equal(done.charges.length,1); assert.equal(done.charges[0].provider,'beacon');
  const titles = done.events.map(e=>e.title);
  assert.ok(titles.indexOf('Atlas confirms: no charge') < titles.indexOf('Route selected: Beacon'));
  await Promise.all(Array.from({length:12},()=>router.run(p.id)));
  assert.equal((await router.get(p.id)).charges.length,1);
});
test('card decline is terminal and is never retried at another provider', async () => {
  const p = await start('decline');
  for (let i=0;i<5;i++) await router.run(p.id);
  const done = await router.get(p.id);
  assert.equal(done.status,'declined'); assert.equal(done.attempts.length,1); assert.equal(done.charges.length,0);
});
test('duplicate signed webhooks are processed once and do not double charge', async () => {
  const p = await start('duplicate_webhook'); now += 5000;
  const body = JSON.stringify({provider:'atlas',event_id:`evt:${p.id}`,intent_id:p.id,idempotency_key:p.attempts[0].idempotency_key});
  const results = await Promise.all(Array.from({length:10},()=>router.webhook(body,signWebhook(body))));
  assert.equal(results.filter(r=>!r.duplicate).length,1);
  const done = await router.get(p.id);
  assert.equal(done.webhook_count,1); assert.equal(done.status,'succeeded'); assert.equal(done.charges.length,1); assert.equal(done.attempts.length,1);
});
test('concurrent order creation and checkout retries persist one intent and one charge', async () => {
  const order = randomUUID();
  const intents = await Promise.all(Array.from({length:30},()=>router.create(order,'concurrent_retry')));
  assert.equal(new Set(intents.map(p=>p.id)).size,1);
  const id = intents[0].id;
  await Promise.all(Array.from({length:30},()=>router.run(id)));
  assert.equal((await router.get(id)).attempts.length,1);
  now += 5000;
  await Promise.all(Array.from({length:30},()=>router.run(id)));
  const done = await router.get(id);
  assert.equal(done.status,'succeeded'); assert.equal(done.charges.length,1); assert.equal(done.attempts.length,1);
});
test('unresolved timeout stays pending indefinitely, even after many retries', async () => {
  const p = await start('unresolved_timeout'); now += 86400000;
  await Promise.all(Array.from({length:16},()=>router.run(p.id)));
  const done = await router.get(p.id);
  assert.equal(done.status,'pending'); assert.equal(done.attempts.length,1); assert.equal(done.charges.length,0);
});
test('a missing provider lookup is unknown, never a terminal no-charge', async () => {
  assert.equal(await simulator.lookup(`absent:${randomUUID()}`),'pending');
});
test('crash after provider charge but before local commit recovers with same key and one charge', async () => {
  let crash = true;
  class CrashingSimulator extends Simulator {
    override async send(request: ProviderRequest) {
      const result = await super.send(request);
      if (crash) { crash=false; throw new Error('Simulated router crash after provider commit'); }
      return result;
    }
  }
  const recoveryRouter = new PaymentRouter(new CrashingSimulator(() => now));
  const p = await recoveryRouter.create(randomUUID(),'happy_path');
  await assert.rejects(()=>recoveryRouter.run(p.id),/Simulated router crash/);
  const interrupted = await recoveryRouter.get(p.id);
  assert.equal(interrupted.attempts[0].status,'prepared'); assert.equal(interrupted.charges.length,1);
  const done = await recoveryRouter.run(p.id);
  assert.equal(done.status,'succeeded'); assert.equal(done.charges.length,1); assert.equal(done.attempts.length,1);
  assert.equal(done.attempts[0].idempotency_key,interrupted.attempts[0].idempotency_key);
});
test('changing scenario for an existing order is rejected', async () => {
  const order = randomUUID(); await router.create(order,'happy_path');
  await assert.rejects(()=>router.create(order,'outage'),Conflict);
});
test('unsigned, tampered, or wrong-attempt webhooks cannot change a payment', async () => {
  const p = await start('delayed_success');
  const body = JSON.stringify({provider:'beacon',event_id:'forged',intent_id:p.id,idempotency_key:p.attempts[0].idempotency_key});
  await assert.rejects(()=>router.webhook(body,'0'.repeat(64)),InvalidWebhook);
  await assert.rejects(()=>router.webhook(body,signWebhook(body)),InvalidWebhook);
  const done = await router.get(p.id);
  assert.equal(done.status,'pending'); assert.equal(done.attempts.length,1); assert.equal(done.webhook_count,0);
});
test('simulator rejects reusing a provider key with a changed amount', async () => {
  const p = await start('happy_path');
  await assert.rejects(()=>simulator.send({...p.attempts[0],scenario:p.scenario,amount_cents:1,currency:'EUR'}),/payload mismatch/);
});
test('webhook and retries racing on no-charge confirmation still produce one backup charge', async () => {
  const p = await start('no_charge'); now+=7000;
  const body = JSON.stringify({provider:'atlas',event_id:`race:${p.id}`,intent_id:p.id,idempotency_key:p.attempts[0].idempotency_key});
  await Promise.all([router.webhook(body,signWebhook(body)),...Array.from({length:20},()=>router.run(p.id))]);
  const done = await router.get(p.id);
  assert.equal(done.status,'succeeded'); assert.equal(done.charges.length,1); assert.equal(done.charges[0].provider,'beacon'); assert.equal(done.attempts.length,2);
});
test('reversed transaction timestamps do not cause primary to be selected after backup preparation', async () => {
  let crash=true;
  class BackupCrash extends Simulator {
    override async send(request:ProviderRequest) {
      if(request.provider==='beacon'&&crash) { crash=false; throw new Error('Crash before backup dispatch'); }
      return super.send(request);
    }
  }
  const r=new PaymentRouter(new BackupCrash(()=>now));
  const p=await r.create(randomUUID(),'outage');
  await assert.rejects(()=>r.run(p.id),/Crash before backup/);
  // A waiting transaction can start before the transaction preparing Atlas.
  await pool.query("UPDATE provider_attempts SET created_at=CASE provider WHEN 'atlas' THEN now() ELSE now()-interval '1 minute' END WHERE intent_id=$1",[p.id]);
  const done=await r.run(p.id);
  assert.equal(done.status,'succeeded'); assert.equal(done.charges.length,1); assert.equal(done.charges[0].provider,'beacon');
});
