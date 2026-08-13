import Phaser from "phaser";

export class DialogueBox {
  private readonly container: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly speaker: Phaser.GameObjects.Text;
  private readonly message: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;
  private lines: string[] = [];
  private index = 0;
  private onComplete: (() => void) | null = null;
  active = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.panel = scene.add.rectangle(0, 0, 760, 128, 0x050918, 0.97)
      .setStrokeStyle(2, 0x39ffe2, 0.85)
      .setScrollFactor(0);
    this.speaker = scene.add.text(-350, -48, "", {
      color: "#60ffe7",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "18px",
      letterSpacing: 2,
    });
    this.message = scene.add.text(-350, -18, "", {
      color: "#f4f2ff",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "19px",
      lineSpacing: 7,
      wordWrap: { width: 690 },
    });
    this.prompt = scene.add.text(350, 45, "E / TAP ▾", {
      color: "#bfa4ff",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "12px",
      letterSpacing: 1,
    }).setOrigin(1, 0.5);
    this.container = scene.add.container(0, 0, [
      this.panel,
      this.speaker,
      this.message,
      this.prompt,
    ]).setScrollFactor(0).setDepth(2000).setVisible(false);
    this.layout();
    this.panel.on("pointerup", () => this.advance());
    scene.scale.on("resize", this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off("resize", this.layout, this);
    });
  }

  show(speaker: string, lines: string[], onComplete?: () => void) {
    this.lines = lines.length ? lines : ["…"];
    this.index = 0;
    this.onComplete = onComplete || null;
    this.speaker.setText(speaker.toUpperCase());
    this.message.setText(this.lines[0] || "…");
    this.active = true;
    this.container.setVisible(true);
    this.panel.setInteractive();
  }

  advance() {
    if (!this.active) return false;
    this.index += 1;
    if (this.index < this.lines.length) {
      this.message.setText(this.lines[this.index] || "…");
      return true;
    }
    this.active = false;
    this.panel.disableInteractive();
    this.container.setVisible(false);
    const callback = this.onComplete;
    this.onComplete = null;
    callback?.();
    return true;
  }

  destroy() {
    this.scene.scale.off("resize", this.layout, this);
    this.container.destroy(true);
  }

  private layout() {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const compact = width < 560;
    const panelWidth = Math.min(760, Math.max(300, width - 32));
    const panelHeight = compact ? 160 : 128;
    this.panel.setSize(panelWidth, panelHeight);
    this.speaker
      .setFontSize(compact ? 14 : 18)
      .setPosition(-panelWidth / 2 + 28, compact ? -62 : -48);
    this.message
      .setFontSize(compact ? 15 : 19)
      .setLineSpacing(compact ? 4 : 7)
      .setPosition(-panelWidth / 2 + 28, compact ? -32 : -18);
    this.message.setWordWrapWidth(panelWidth - 56, true);
    this.prompt.setPosition(panelWidth / 2 - 24, compact ? 63 : 45);
    this.container.setPosition(width / 2, height - (compact ? 98 : 82));
  }
}
