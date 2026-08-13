import { normalizeSave, SAVE_KEY } from "../systems/save/SaveSchema";
import type { GameSave } from "../types/game";

export type StoragePort = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export class SaveService {
  constructor(private readonly storage: StoragePort) {}

  hasSave() {
    return this.load() !== null;
  }

  load() {
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw || raw.length > 200_000) return null;
      return normalizeSave(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  save(value: GameSave) {
    const normalized = normalizeSave({
      ...value,
      updatedAt: new Date().toISOString(),
    });
    if (!normalized) throw new Error("Refusing to save invalid game state.");
    this.storage.setItem(SAVE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  clear() {
    this.storage.removeItem(SAVE_KEY);
  }
}
