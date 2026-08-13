import Phaser from "phaser";

type PixelButtonOptions = {
  width?: number;
  height?: number;
  fill?: number;
  hoverFill?: number;
  textColor?: string;
  fontSize?: number;
};

export class PixelButton extends Phaser.GameObjects.Container {
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private enabled = true;
  private readonly fill: number;
  private readonly hoverFill: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    options: PixelButtonOptions = {},
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    const width = options.width || 220;
    const height = options.height || 50;
    this.fill = options.fill ?? 0x102840;
    this.hoverFill = options.hoverFill ?? 0x1c5470;
    this.panel = scene.add.rectangle(0, 0, width, height, this.fill, 0.96)
      .setStrokeStyle(2, 0x39ffe2, 0.86);
    this.label = scene.add.text(0, 0, text, {
      color: options.textColor || "#f7fbff",
      fontFamily: '"Arial Black", "Trebuchet MS", sans-serif',
      fontSize: `${options.fontSize || 17}px`,
      letterSpacing: 2,
      align: "center",
    }).setOrigin(0.5);
    this.add([this.panel, this.label]);
    this.setSize(width, height);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    this.on("pointerover", () => {
      if (this.enabled) this.panel.setFillStyle(this.hoverFill, 1);
    });
    this.on("pointerout", () => this.panel.setFillStyle(this.fill, this.enabled ? 0.96 : 0.4));
    this.on("pointerdown", () => {
      if (this.enabled) this.setScale(0.98);
    });
    this.on("pointerup", () => {
      this.setScale(1);
      if (this.enabled) onClick();
    });
  }

  setLabel(value: string) {
    this.label.setText(value);
    return this;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.panel.setFillStyle(this.fill, enabled ? 0.96 : 0.4);
    this.label.setAlpha(enabled ? 1 : 0.45);
    return this;
  }
}
