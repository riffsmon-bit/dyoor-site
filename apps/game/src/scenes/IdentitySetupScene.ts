import Phaser from "phaser";
import { TRAINING_DROID } from "../data/characters";
import { gameSession } from "../services/GameSession";
import {
  createPlayerIdentity,
  FIELD_PROTOCOLS,
} from "../systems/identity/FieldProtocol";
import type {
  CharacterProfile,
  FieldProtocol,
  GameMode,
} from "../types/game";
import { PixelButton } from "../ui/PixelButton";

type ProtocolCard = {
  container: Phaser.GameObjects.Container;
  panel: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  role: Phaser.GameObjects.Text;
  description: Phaser.GameObjects.Text;
};

export class IdentitySetupScene extends Phaser.Scene {
  private mode: GameMode = "guest";
  private selectedProfile: CharacterProfile = TRAINING_DROID;
  private partyProfiles: CharacterProfile[] = [TRAINING_DROID];
  private selectedProtocol: FieldProtocol = "prospector";
  private callsignInput?: HTMLInputElement;
  private callsignDom?: Phaser.GameObjects.DOMElement;
  private heading?: Phaser.GameObjects.Text;
  private subtitle?: Phaser.GameObjects.Text;
  private inputLabel?: Phaser.GameObjects.Text;
  private protocolLabel?: Phaser.GameObjects.Text;
  private partyText?: Phaser.GameObjects.Text;
  private safetyText?: Phaser.GameObjects.Text;
  private backButton?: PixelButton;
  private confirmButton?: PixelButton;
  private protocolCards: ProtocolCard[] = [];

  constructor() {
    super("IdentitySetupScene");
  }

  init(data: {
    mode?: GameMode;
    selectedProfile?: CharacterProfile;
    partyProfiles?: CharacterProfile[];
  }) {
    this.mode = data?.mode === "wallet" ? "wallet" : "guest";
    this.selectedProfile = data?.selectedProfile || TRAINING_DROID;
    const supplied = Array.isArray(data?.partyProfiles) ? data.partyProfiles : [];
    this.partyProfiles = this.mode === "guest"
      ? [TRAINING_DROID]
      : [
        this.selectedProfile,
        ...supplied.filter((profile) => profile.id !== this.selectedProfile.id),
      ].slice(0, 3);
  }

  create() {
    this.cameras.main.setBackgroundColor("#050611");
    this.createBackdrop();

    this.heading = this.add.text(0, 0, "INITIALIZE FIELD IDENTITY", {
      color: "#f7f5ff",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "34px",
      letterSpacing: 2,
      align: "center",
      stroke: "#21103c",
      strokeThickness: 6,
    }).setOrigin(0.5);
    this.subtitle = this.add.text(0, 0, "CALLSIGN + CORE PROTOCOL", {
      color: "#6affe7",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "13px",
      letterSpacing: 3,
      align: "center",
    }).setOrigin(0.5);
    this.inputLabel = this.add.text(0, 0, "FIELD CALLSIGN", {
      color: "#bca8e8",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "11px",
      letterSpacing: 2,
    }).setOrigin(0.5);
    this.protocolLabel = this.add.text(0, 0, "SELECT STARTING PROTOCOL", {
      color: "#e9e2fb",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "12px",
      letterSpacing: 2,
    }).setOrigin(0.5);
    this.partyText = this.add.text(0, 0, "", {
      color: "#9b90b8",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "12px",
      align: "center",
      wordWrap: { width: 760 },
    }).setOrigin(0.5);
    this.safetyText = this.add.text(0, 0, "LOCAL TRAINING BUILD · PROTOCOL BONUSES HAVE NO TOKEN VALUE", {
      color: "#746c8b",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "9px",
      letterSpacing: 1,
      align: "center",
    }).setOrigin(0.5);

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 16;
    input.autocomplete = "off";
    input.autocapitalize = "characters";
    input.spellcheck = false;
    input.inputMode = "text";
    input.className = "dyoor-callsign-input";
    input.value = this.selectedProfile.tokenId
      ? `DROID-${this.selectedProfile.tokenId}`
      : "PILOT-01";
    input.setAttribute("aria-label", "Field callsign");
    this.callsignInput = input;
    this.callsignDom = this.add.dom(0, 0, input).setOrigin(0.5);

    for (const definition of FIELD_PROTOCOLS) {
      const panel = this.add.rectangle(0, 0, 250, 126, 0x0b0d1d, 0.97)
        .setStrokeStyle(2, definition.color, 0.66)
        .setInteractive();
      const name = this.add.text(0, -40, definition.name, {
        color: "#ffffff",
        fontFamily: '"Arial Black", sans-serif',
        fontSize: "16px",
        letterSpacing: 2,
      }).setOrigin(0.5);
      const role = this.add.text(0, -17, definition.role, {
        color: Phaser.Display.Color.IntegerToColor(definition.color).rgba,
        fontFamily: '"Arial Black", sans-serif',
        fontSize: "9px",
        letterSpacing: 2,
      }).setOrigin(0.5);
      const description = this.add.text(0, 22, definition.description, {
        color: "#c8c0d9",
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: "12px",
        align: "center",
        wordWrap: { width: 220 },
      }).setOrigin(0.5);
      const container = this.add.container(0, 0, [panel, name, role, description]);
      panel.on("pointerup", () => {
        this.selectedProtocol = definition.id;
        this.refreshProtocolCards();
      });
      this.protocolCards.push({
        container,
        panel,
        name,
        role,
        description,
      });
    }

    this.backButton = new PixelButton(
      this,
      0,
      0,
      "← DROID SELECT",
      () => this.scene.start("CharacterSelectScene", { mode: this.mode }),
      { width: 175, height: 40, fontSize: 11 },
    );
    this.confirmButton = new PixelButton(
      this,
      0,
      0,
      "BEGIN FIELD TEST",
      () => this.confirmIdentity(),
      { width: 260, fill: 0x0b4b43, hoverFill: 0x147d70 },
    );

    this.partyText.setText(
      `ACTIVE ${this.selectedProfile.displayName.toUpperCase()}`
      + ` · FIELD PARTY ${this.partyProfiles.length}/3`,
    );
    this.refreshProtocolCards();
    this.layout();
    this.scale.on("resize", this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.layout, this);
      this.callsignDom?.destroy();
    });
  }

  private confirmIdentity() {
    const identity = createPlayerIdentity(
      this.callsignInput?.value,
      this.selectedProtocol,
    );
    gameSession.start(this.mode, this.selectedProfile, {
      identity,
      party: this.partyProfiles,
    });
    this.scene.start("LaboratoryScene");
  }

  private refreshProtocolCards() {
    FIELD_PROTOCOLS.forEach((definition, index) => {
      const selected = definition.id === this.selectedProtocol;
      this.protocolCards[index]?.panel
        .setFillStyle(selected ? 0x142c35 : 0x0b0d1d, selected ? 1 : 0.97)
        .setStrokeStyle(selected ? 4 : 2, definition.color, selected ? 1 : 0.66);
      this.protocolCards[index]?.container.setScale(selected ? 1.03 : 1);
    });
  }

  private createBackdrop() {
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0x071b26, 0x1c0b30, 0x04050e, 0x04050e, 1);
    graphics.fillRect(0, 0, Math.max(1200, this.scale.width), Math.max(900, this.scale.height));
    graphics.lineStyle(1, 0x62ffe8, 0.08);
    for (let y = 0; y < Math.max(900, this.scale.height); y += 6) {
      graphics.lineBetween(0, y, Math.max(1200, this.scale.width), y);
    }
  }

  private layout() {
    const width = this.scale.width;
    const height = this.scale.height;
    const narrow = width < 720;
    const veryNarrow = width < 460;
    const centerX = width / 2;

    this.heading
      ?.setText(veryNarrow ? "FIELD IDENTITY" : "INITIALIZE FIELD IDENTITY")
      .setFontSize(veryNarrow ? 25 : narrow ? 30 : 34)
      .setPosition(centerX, narrow ? 72 : 58);
    this.subtitle?.setPosition(centerX, narrow ? 108 : 94);
    this.inputLabel?.setPosition(centerX, narrow ? 143 : 129);
    this.callsignDom?.setPosition(centerX, narrow ? 177 : 165);
    if (this.callsignInput) {
      this.callsignInput.style.width = `${Math.min(420, width - 48)}px`;
    }
    this.protocolLabel?.setPosition(centerX, narrow ? 222 : 218);

    if (narrow) {
      const cardWidth = Math.max(290, Math.min(430, width - 36));
      const compactHeight = height < 700;
      const cardHeight = compactHeight ? 68 : 102;
      const startY = compactHeight ? 250 : 286;
      const gap = cardHeight + (compactHeight ? 8 : 12);
      this.protocolCards.forEach((card, index) => {
        card.container.setPosition(centerX, startY + gap * index);
        card.panel.setSize(cardWidth, cardHeight);
        card.name.setY(compactHeight ? -16 : -40);
        card.role.setY(compactHeight ? 9 : -17);
        card.description
          .setVisible(!compactHeight)
          .setFontSize(11)
          .setWordWrapWidth(cardWidth - 36, true)
          .setY(22);
      });
      this.partyText
        ?.setVisible(!compactHeight)
        .setPosition(centerX, startY + gap * 3 + 4)
        .setWordWrapWidth(width - 36, true);
    } else {
      const cardWidth = Math.min(250, (width - 90) / 3);
      const gap = cardWidth + 18;
      const startX = centerX - gap;
      this.protocolCards.forEach((card, index) => {
        card.container.setPosition(startX + gap * index, 315);
        card.panel.setSize(cardWidth, 126);
        card.name.setY(-40);
        card.role.setY(-17);
        card.description
          .setVisible(true)
          .setY(22)
          .setWordWrapWidth(cardWidth - 30, true);
      });
      this.partyText?.setVisible(true).setPosition(centerX, 404);
    }

    this.backButton?.setPosition(narrow ? 96 : 112, narrow ? 34 : height - 42);
    this.confirmButton?.setPosition(centerX, height - 58);
    this.safetyText
      ?.setText(veryNarrow
        ? "LOCAL BUILD · NO TOKEN VALUE"
        : "LOCAL TRAINING BUILD · PROTOCOL BONUSES HAVE NO TOKEN VALUE")
      .setPosition(centerX, height - 18);
  }
}
