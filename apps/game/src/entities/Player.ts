import Phaser from "phaser";
import type { Direction, MovementVector } from "../types/game";

const SPEED = 150;

export class Player extends Phaser.Physics.Arcade.Sprite {
  direction: Direction = "down";

  constructor(scene: Phaser.Scene, x: number, y: number, textureKey: string, direction: Direction = "down") {
    super(scene, x, y, textureKey, `${direction}-0`);
    this.direction = direction;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(20);
    this.setOrigin(0.5, 0.82);
    this.setCollideWorldBounds(true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(20, 12);
    body.setOffset(22, 47);
  }

  move(vector: MovementVector, blocked = false) {
    if (blocked) {
      this.halt();
      return;
    }
    this.setVelocity(vector.x * SPEED, vector.y * SPEED);
    if (vector.x < 0) this.direction = "left";
    else if (vector.x > 0) this.direction = "right";
    else if (vector.y < 0) this.direction = "up";
    else if (vector.y > 0) this.direction = "down";

    if (vector.x || vector.y) {
      this.play(`${this.texture.key}-walk-${this.direction}`, true);
    } else {
      this.halt();
    }
  }

  halt() {
    this.setVelocity(0, 0);
    this.anims.stop();
    this.setFrame(`${this.direction}-0`);
  }
}
