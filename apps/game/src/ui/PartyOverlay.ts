import Phaser from "phaser";
import { createMetadataDroidSheet } from "../entities/DroidSpriteFactory";
import { gameSession } from "../services/GameSession";
import { protocolDefinition } from "../systems/identity/FieldProtocol";

export class PartyOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;
  private readonly subtitle: Phaser.GameObjects.Text;
  private readonly members: Phaser.GameObjects.Container;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly closePanel: Phaser.GameObjects.Rectangle;
  private readonly closeText: Phaser.GameObjects.Text;
  visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onActivate: (memberId: string) => boolean,
    private readonly onClose: () => void,
  ) {
    this.panel = scene.add.rectangle(0, 0, 470, 390, 0x050713, 0.985)
      .setStrokeStyle(3, 0x5fffe7, 0.82);
    this.title = scene.add.text(0, -160, "FIELD PARTY", {
      color: "#6affe8",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "24px",
      letterSpacing: 3,
    }).setOrigin(0.5);
    this.subtitle = scene.add.text(0, -128, "", {
      color: "#bba9e5",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "12px",
      align: "center",
    }).setOrigin(0.5);
    this.members = scene.add.container(0, 0);
    this.hint = scene.add.text(0, 163, "TAP A RESERVE TO ACTIVATE · P / TEAM TO CLOSE", {
      color: "#89809e",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "9px",
      letterSpacing: 1,
      align: "center",
    }).setOrigin(0.5);
    this.closePanel = scene.add.rectangle(202, -160, 38, 32, 0x28173f, 0.95)
      .setStrokeStyle(1, 0x9f78df, 0.9)
      .setScrollFactor(0)
      .setInteractive();
    this.closeText = scene.add.text(202, -160, "×", {
      color: "#ffffff",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "20px",
    }).setOrigin(0.5);
    this.closePanel.on("pointerup", () => this.close());
    this.container = scene.add.container(0, 0, [
      this.panel,
      this.title,
      this.subtitle,
      this.members,
      this.hint,
      this.closePanel,
      this.closeText,
    ])
      .setScrollFactor(0)
      .setDepth(2200)
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
    else this.onClose();
    this.container.setVisible(this.visible);
    return this.visible;
  }

  close() {
    const wasVisible = this.visible;
    this.visible = false;
    this.container.setVisible(false);
    if (wasVisible) this.onClose();
  }

  private refresh() {
    this.members.removeAll(true);
    const state = gameSession.state;
    const protocol = protocolDefinition(state.identity.protocol);
    this.subtitle.setText(
      `${state.identity.callsign} // ${protocol.name} // ${state.party.members.length}/3 UNITS`,
    );
    const rowWidth = Math.min(420, Math.max(275, this.scene.scale.width - 70));
    state.party.members.forEach((member, index) => {
      const active = member.id === state.party.activeDroidId;
      const y = -78 + index * 88;
      const panel = this.scene.add.rectangle(0, y, rowWidth, 76, active ? 0x103538 : 0x0b0c19, 0.98)
        .setStrokeStyle(active ? 3 : 1, active ? 0x55ffe6 : 0x61458d, active ? 1 : 0.8)
        .setScrollFactor(0)
        .setInteractive();
      const textureKey = createMetadataDroidSheet(this.scene, member);
      const sprite = this.scene.add.sprite(-rowWidth / 2 + 44, y + 4, textureKey, "down-0")
        .setScale(0.82);
      const name = this.scene.add.text(-rowWidth / 2 + 83, y - 16, member.displayName.toUpperCase(), {
        color: "#ffffff",
        fontFamily: '"Arial Black", sans-serif',
        fontSize: "12px",
        letterSpacing: 1,
      }).setOrigin(0, 0.5);
      const status = this.scene.add.text(-rowWidth / 2 + 83, y + 14, active
        ? "ACTIVE FIELD DROID"
        : "RESERVE · TAP TO ACTIVATE", {
        color: active ? "#65ffe9" : "#c4aedf",
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: "11px",
      }).setOrigin(0, 0.5);
      const token = this.scene.add.text(rowWidth / 2 - 16, y, member.tokenId
        ? `#${member.tokenId}`
        : "GUEST", {
        color: member.tokenId ? "#ffd661" : "#8b829f",
        fontFamily: '"Arial Black", sans-serif',
        fontSize: "11px",
      }).setOrigin(1, 0.5);
      // Activate on pointer-down so mobile wallet browsers do not lose the tap
      // when a touch ends outside the row after their browser chrome shifts.
      panel.on("pointerdown", () => {
        if (!active && this.onActivate(member.id)) this.refresh();
      });
      this.members.add([panel, sprite, name, status, token]);
    });
    for (let index = state.party.members.length; index < 3; index += 1) {
      const y = -78 + index * 88;
      const panel = this.scene.add.rectangle(0, y, rowWidth, 76, 0x080916, 0.72)
        .setStrokeStyle(1, 0x54436f, 0.52);
      const slot = this.scene.add.text(0, y - 7, `RESERVE SLOT ${index + 1}`, {
        color: "#716982",
        fontFamily: '"Arial Black", sans-serif',
        fontSize: "11px",
        letterSpacing: 2,
      }).setOrigin(0.5);
      const status = this.scene.add.text(0, y + 16, "EMPTY", {
        color: "#494354",
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: "10px",
        letterSpacing: 2,
      }).setOrigin(0.5);
      this.members.add([panel, slot, status]);
    }
  }

  private layout() {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    this.container.setPosition(width / 2, height / 2);
    const panelWidth = Math.min(470, Math.max(310, width - 24));
    const panelHeight = Math.min(390, Math.max(350, height - 36));
    this.panel.setSize(panelWidth, panelHeight);
    this.title.setY(-panelHeight / 2 + 34);
    this.subtitle.setY(-panelHeight / 2 + 68);
    this.closePanel.setPosition(panelWidth / 2 - 28, -panelHeight / 2 + 28);
    this.closeText.setPosition(panelWidth / 2 - 28, -panelHeight / 2 + 28);
    this.hint
      .setText(width < 460 ? "TAP RESERVE · TEAM TO CLOSE" : "TAP A RESERVE TO ACTIVATE · P / TEAM TO CLOSE")
      .setY(panelHeight / 2 - 24);
    if (this.visible) this.refresh();
  }
}
