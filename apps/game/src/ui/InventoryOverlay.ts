import Phaser from "phaser";
import { ITEM_NAMES } from "../data/items";
import { gameSession } from "../services/GameSession";

export class InventoryOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly contents: Phaser.GameObjects.Text;
  visible = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.panel = scene.add.rectangle(0, 0, 440, 330, 0x060715, 0.98)
      .setStrokeStyle(2, 0x9a6cff, 0.9);
    const title = scene.add.text(0, -130, "FIELD INVENTORY", {
      color: "#68ffe8",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "24px",
      letterSpacing: 2,
    }).setOrigin(0.5);
    this.contents = scene.add.text(-180, -85, "", {
      color: "#f5f2ff",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "18px",
      lineSpacing: 12,
      wordWrap: { width: 360 },
    });
    const hint = scene.add.text(0, 130, "I / BAG TO CLOSE", {
      color: "#a99ac9",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "12px",
      letterSpacing: 1,
    }).setOrigin(0.5);
    this.container = scene.add.container(0, 0, [this.panel, title, this.contents, hint])
      .setScrollFactor(0)
      .setDepth(2100)
      .setVisible(false);
    this.layout();
    scene.scale.on("resize", this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off("resize", this.layout, this);
    });
  }

  toggle() {
    this.visible = !this.visible;
    if (this.visible) this.refresh();
    this.container.setVisible(this.visible);
    return this.visible;
  }

  close() {
    this.visible = false;
    this.container.setVisible(false);
  }

  private refresh() {
    const entries = Object.entries(gameSession.state.inventory);
    this.contents.setText(entries.length
      ? entries.map(([itemId, quantity]) => `◆ ${ITEM_NAMES[itemId] || itemId}  ×${quantity}`).join("\n")
      : "No field items collected yet.");
  }

  private layout() {
    this.container.setPosition(this.scene.scale.width / 2, this.scene.scale.height / 2);
    const width = Math.min(440, Math.max(310, this.scene.scale.width - 28));
    this.panel.setSize(width, 330);
    this.contents.setX(-width / 2 + 40);
    this.contents.setWordWrapWidth(width - 80, true);
  }
}
