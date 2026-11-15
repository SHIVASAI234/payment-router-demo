import { test } from "node:test";
import assert from "node:assert/strict";
import { saveSession, storageKey } from "../src/shared/session";
test("blocked browser storage does not throw or block checkout", () => {
  assert.equal(
    saveSession({ order_id: "same-order" }, () => {
      throw new DOMException("Blocked", "SecurityError");
    }),
    false,
  );
});
test("full browser storage does not throw or block checkout", () => {
  const storage = {
    setItem() {
      throw new DOMException("Full", "QuotaExceededError");
    },
  } as unknown as Storage;
  assert.equal(
    saveSession({ order_id: "same-order" }, () => storage),
    false,
  );
});
test("available browser storage retains the original order and intent", () => {
  const saved = new Map();
  const storage = {
    setItem(key: string, value: string) {
      saved.set(key, value);
    },
  } as unknown as Storage;
  const value = { order_id: "same-order", id: "same-intent" };
  assert.equal(
    saveSession(value, () => storage),
    true,
  );
  assert.deepEqual(JSON.parse(saved.get(storageKey)), value);
});
