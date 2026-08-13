import Phaser from "phaser";
import type { Direction, MovementVector } from "../types/game";
import { VirtualInputState } from "./VirtualInputState";

export class UnifiedInput {
  readonly virtual = new VirtualInputState();
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly keys: Record<
    "W" | "A" | "S" | "D" | "E" | "SPACE" | "ENTER" | "I" | "P",
    Phaser.Input.Keyboard.Key
  >;

  constructor(scene: Phaser.Scene) {
    if (!scene.input.keyboard) throw new Error("Keyboard input is unavailable.");
    this.cursors = scene.input.keyboard.createCursorKeys();
    this.keys = scene.input.keyboard.addKeys("W,A,S,D,E,SPACE,ENTER,I,P") as typeof this.keys;
  }

  movement(): MovementVector {
    const virtual = this.virtual.movement();
    if (virtual.x || virtual.y) return virtual;

    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const up = this.cursors.up.isDown || this.keys.W.isDown;
    const down = this.cursors.down.isDown || this.keys.S.isDown;
    if (left !== right) return { x: left ? -1 : 1, y: 0 };
    if (up !== down) return { x: 0, y: up ? -1 : 1 };
    return { x: 0, y: 0 };
  }

  consumeAction() {
    return this.virtual.consumeAction()
      || Phaser.Input.Keyboard.JustDown(this.keys.E)
      || Phaser.Input.Keyboard.JustDown(this.keys.SPACE)
      || Phaser.Input.Keyboard.JustDown(this.keys.ENTER);
  }

  consumeInventory() {
    return this.virtual.consumeInventory() || Phaser.Input.Keyboard.JustDown(this.keys.I);
  }

  consumeParty() {
    return this.virtual.consumeParty() || Phaser.Input.Keyboard.JustDown(this.keys.P);
  }

  setVirtualDirection(direction: Direction, pressed: boolean) {
    this.virtual.setDirection(direction, pressed);
  }

  reset() {
    this.virtual.reset();
  }
}
