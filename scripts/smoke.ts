import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Payment } from "../src/server/router";

const base = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const results: string[] = [];
async function request(path: string, data?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: r.status, value: await r.json() };
}
async function waitUntilPaid(id: string, webhook = false): Promise<Payment> {
  const limit = Date.now() + 15000;
  while (Date.now() < limit) {
    const { value: p } = await request(
      `/api/payments/${id}/${webhook ? "webhook-demo" : "reconcile"}`,
      {},
    );
    if (p.status === "succeeded") return p;
    assert.equal(p.status, "pending");
    assert.equal(p.attempts.length, 1);
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("Payment did not resolve within 15 seconds");
}
async function main() {
  for (const scenario of [
    "happy_path",
    "outage",
    "delayed_success",
    "no_charge",
    "decline",
    "duplicate_webhook",
    "concurrent_retry",
    "unresolved_timeout",
  ]) {
    const order_id = randomUUID();
    const created = await request("/api/payments", { order_id, scenario });
    assert.equal(created.status, 201);
    const repeated = await request("/api/payments", { order_id, scenario });
    assert.equal(repeated.value.id, created.value.id);
    const id = created.value.id;
    let { value: p } = await request(`/api/payments/${id}/pay`, {});
    if (
      [
        "delayed_success",
        "no_charge",
        "duplicate_webhook",
        "concurrent_retry",
        "unresolved_timeout",
      ].includes(scenario)
    ) {
      assert.equal(p.status, "pending");
      assert.equal(p.attempts.length, 1);
      assert.equal(p.charges.length, 0);
      await Promise.all(
        Array.from({ length: 8 }, () =>
          request(`/api/payments/${id}/retry`, {}),
        ),
      );
      if (scenario !== "unresolved_timeout")
        p = await waitUntilPaid(id, scenario === "duplicate_webhook");
    }
    if (scenario === "decline") {
      assert.equal(p.status, "declined");
      assert.equal(p.charges.length, 0);
      assert.equal(p.attempts.length, 1);
    } else if (scenario === "unresolved_timeout") {
      assert.equal(p.status, "pending");
      assert.equal(p.charges.length, 0);
      assert.equal(p.attempts.length, 1);
    } else {
      assert.equal(p.status, "succeeded");
      assert.equal(p.charges.length, 1);
      assert.equal(p.charges[0].amount_cents, 4999);
      assert.equal(p.currency, "EUR");
    }
    if (scenario === "no_charge" || scenario === "outage")
      assert.equal(p.charges[0].provider, "beacon");
    if (scenario === "duplicate_webhook") {
      const replay = await request(`/api/payments/${id}/webhook-demo`, {});
      assert.equal(replay.value.webhook_count, 1);
      assert.equal(replay.value.charges.length, 1);
    }
    assert.ok(p.events.length > 1);
    results.push(
      `PASS ${scenario}: ${p.status}; ${p.charges.length} charge(s); ${p.attempts.length} provider attempt(s)`,
    );
  }
  assert.equal(
    (
      await request("/api/payments", {
        order_id: randomUUID(),
        scenario: "happy_path",
        amount_cents: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/payments", {
        order_id: randomUUID(),
        scenario: "happy_path",
        provider: "beacon",
      })
    ).status,
    400,
  );
  assert.equal((await request(`/api/payments/${randomUUID()}`)).status, 404);
  assert.equal((await request("/api/payments/not-a-uuid")).status, 400);
  assert.equal(
    (
      await request("/api/webhooks", {
        provider: "atlas",
        event_id: "unsigned",
      })
    ).status,
    401,
  );
  results.push(
    "PASS validation: amount/provider overrides rejected; missing and malformed IDs rejected; unsigned webhook rejected",
  );
  console.log(
    `Production HTTP checks: ${base}\n${results.join("\n")}\nAll 9 checks passed.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
