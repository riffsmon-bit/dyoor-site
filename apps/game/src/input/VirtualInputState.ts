import type { Direction, MovementVector } from "../types/game";

export class VirtualInputState {
  private readonly directions = new Set<Direction>();
  private actionQueued = false;
  private inventoryQueued = false;
  private partyQueued = false;

  setDirection(direction: Direction, pressed: boolean) {
    if (pressed) this.directions.add(direction);
    else this.directions.delete(direction);
  }

  queueAction() {
    this.actionQueued = true;
  }

  queueInventory() {
    this.inventoryQueued = true;
  }

  queueParty() {
    this.partyQueued = true;
  }

  movement(): MovementVector {
    const x = Number(this.directions.has("right")) - Number(this.directions.has("left"));
    const y = Number(this.directions.has("down")) - Number(this.directions.has("up"));
    if (x !== 0) return { x: x > 0 ? 1 : -1, y: 0 };
    if (y !== 0) return { x: 0, y: y > 0 ? 1 : -1 };
    return { x: 0, y: 0 };
  }

  consumeAction() {
    const queued = this.actionQueued;
    this.actionQueued = false;
    return queued;
  }

  consumeInventory() {
    const queued = this.inventoryQueued;
    this.inventoryQueued = false;
    return queued;
  }

  consumeParty() {
    const queued = this.partyQueued;
    this.partyQueued = false;
    return queued;
  }

  reset() {
    this.directions.clear();
    this.actionQueued = false;
    this.inventoryQueued = false;
    this.partyQueued = false;
  }
}
