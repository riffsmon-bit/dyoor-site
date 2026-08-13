import type { InventoryState } from "../../types/game";

export function normalizeInventory(value: unknown): InventoryState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const inventory: InventoryState = {};
  for (const [itemId, quantity] of Object.entries(value)) {
    if (!/^[a-z0-9-]{1,64}$/.test(itemId)) continue;
    if (!Number.isSafeInteger(quantity) || Number(quantity) <= 0) continue;
    inventory[itemId] = Math.min(Number(quantity), 999);
  }
  return inventory;
}

export function addItem(inventory: InventoryState, itemId: string, quantity = 1) {
  if (!/^[a-z0-9-]{1,64}$/.test(itemId)) throw new Error("Invalid inventory item ID.");
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Inventory quantity must be positive.");
  return {
    ...inventory,
    [itemId]: Math.min(999, (inventory[itemId] || 0) + quantity),
  };
}

export function removeItem(inventory: InventoryState, itemId: string, quantity = 1) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Inventory quantity must be positive.");
  const current = inventory[itemId] || 0;
  if (current < quantity) return { inventory, removed: false };
  const next = { ...inventory };
  const remaining = current - quantity;
  if (remaining > 0) next[itemId] = remaining;
  else delete next[itemId];
  return { inventory: next, removed: true };
}
