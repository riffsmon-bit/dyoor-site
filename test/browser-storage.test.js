import assert from "node:assert/strict";
import test from "node:test";
import { getStorageItem, removeStorageItem, setStorageJson } from "../lib/browser-storage.ts";

test("browser storage writes are best-effort when the browser rejects persistence", () => {
  const quotaLimitedStorage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };

  assert.equal(getStorageItem(quotaLimitedStorage, "pending-roll"), null);
  assert.equal(setStorageJson(quotaLimitedStorage, "pending-roll", { rollId: "roll-1" }), false);
  assert.equal(removeStorageItem(quotaLimitedStorage, "pending-roll"), false);
});

test("browser storage helpers serialize and remove recoverable state", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  assert.equal(setStorageJson(storage, "pending-roll", { rollId: "roll-1" }), true);
  assert.equal(getStorageItem(storage, "pending-roll"), values.get("pending-roll"));
  assert.deepEqual(JSON.parse(values.get("pending-roll")), { rollId: "roll-1" });
  assert.equal(removeStorageItem(storage, "pending-roll"), true);
  assert.equal(values.has("pending-roll"), false);
});
