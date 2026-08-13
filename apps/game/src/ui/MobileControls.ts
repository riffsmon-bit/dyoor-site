import Phaser from "phaser";
import type { Direction } from "../types/game";
import type { UnifiedInput } from "../input/UnifiedInput";

export class MobileControls {
  private readonly container: Phaser.GameObjects.Container;
  private readonly leftCluster: Phaser.GameObjects.Container;
  private readonly rightCluster: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene, private readonly input: UnifiedInput) {
    this.leftCluster = scene.add.container(0, 0);
    this.rightCluster = scene.add.container(0, 0);
    this.container = scene.add.container(0, 0, [this.leftCluster, this.rightCluster])
      .setScrollFactor(0)
      .setDepth(1500);
    this.createDirection("up", 56, 0, "▲");
    this.createDirection("left", 0, 56, "◀");
    this.createDirection("down", 56, 56, "▼");
    this.createDirection("right", 112, 56, "▶");
    this.createAction(0, 0, "ACT", () => this.input.virtual.queueAction(), 0x3ff3d7);
    this.createAction(-76, 32, "BAG", () => this.input.virtual.queueInventory(), 0xa973ff, 48);
    this.createAction(-76, -32, "TEAM", () => this.input.virtual.queueParty(), 0xffd45d, 48);
    this.layout();
    this.updateVisibility();
    scene.scale.on("resize", this.layout, this);
    scene.scale.on("resize", this.updateVisibility, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  setVisible(visible: boolean) {
    this.container.setVisible(visible && this.shouldShow());
  }

  destroy() {
    this.scene.scale.off("resize", this.layout, this);
    this.scene.scale.off("resize", this.updateVisibility, this);
    this.input.reset();
    this.container.destroy(true);
  }

  private createDirection(direction: Direction, x: number, y: number, label: string) {
    const button = this.scene.add.rectangle(x, y, 52, 52, 0x071726, 0.76)
      .setStrokeStyle(2, 0x45f5dd, 0.7)
      .setScrollFactor(0)
      .setInteractive();
    const text = this.scene.add.text(x, y, label, {
      color: "#dffef9",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "18px",
    }).setOrigin(0.5).setScrollFactor(0);
    button.on("pointerdown", () => {
      this.input.setVirtualDirection(direction, true);
      button.setFillStyle(0x1a625f, 0.95);
    });
    const release = () => {
      this.input.setVirtualDirection(direction, false);
      button.setFillStyle(0x071726, 0.76);
    };
    button.on("pointerup", release);
    button.on("pointerout", release);
    this.leftCluster.add([button, text]);
  }

  private createAction(
    x: number,
    y: number,
    label: string,
    action: () => void,
    color: number,
    size = 68,
  ) {
    const button = this.scene.add.circle(x, y, size / 2, 0x10122b, 0.88)
      .setStrokeStyle(3, color, 0.9)
      .setScrollFactor(0)
      .setInteractive();
    const text = this.scene.add.text(x, y, label, {
      color: "#ffffff",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: size > 50 ? "14px" : "11px",
      letterSpacing: 1,
    }).setOrigin(0.5).setScrollFactor(0);
    button.on("pointerdown", () => {
      button.setScale(0.94);
      action();
    });
    button.on("pointerup", () => button.setScale(1));
    button.on("pointerout", () => button.setScale(1));
    this.rightCluster.add([button, text]);
  }

  private shouldShow() {
    return this.scene.scale.width <= 900
      || this.scene.scale.height <= 650
      || window.matchMedia("(pointer: coarse)").matches;
  }

  private updateVisibility() {
    this.container.setVisible(this.shouldShow());
  }

  private layout() {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    this.leftCluster.setPosition(28, height - 142);
    this.rightCluster.setPosition(width - 72, height - 86);
  }
}
