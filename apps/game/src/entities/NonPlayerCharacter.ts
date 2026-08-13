import Phaser from "phaser";
import type { Direction } from "../types/game";

export class NonPlayerCharacter extends Phaser.Physics.Arcade.Sprite {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    direction: Direction = "down",
  ) {
    super(scene, x, y, textureKey, `${direction}-0`);
    scene.add.existing(this);
    scene.physics.add.existing(this, true);
    this.setDepth(18);
    this.setOrigin(0.5, 0.82);
    const body = this.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(22, 14);
    body.setOffset(21, 45);
  }
}
