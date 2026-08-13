import Phaser from "phaser";
import { gameSession } from "../services/GameSession";
import { createWalletService } from "../services/WalletService";
import { PixelButton } from "../ui/PixelButton";

export class TitleScene extends Phaser.Scene {
  private layoutObjects: Array<Phaser.GameObjects.GameObject & { setPosition(x: number, y: number): unknown }> = [];
  private statusText?: Phaser.GameObjects.Text;
  private busy = false;

  constructor() {
    super("TitleScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#050511");
    this.createBackdrop();

    const eyebrow = this.add.text(0, 0, "D.Y.O.O.R FIELD SIMULATION // PROTOTYPE 01", {
      color: "#5bffe5",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "15px",
      letterSpacing: 3,
      align: "center",
    }).setOrigin(0.5);
    const title = this.add.text(0, 0, "ECHOES OF\nTHE CORE", {
      color: "#f7f4ff",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "58px",
      lineSpacing: -8,
      letterSpacing: 2,
      align: "center",
      stroke: "#1f0b3d",
      strokeThickness: 8,
    }).setOrigin(0.5);
    const subtitle = this.add.text(0, 0, "A RETRO-FUTURISTIC DROID RPG", {
      color: "#c5b5ef",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "18px",
      letterSpacing: 4,
      align: "center",
    }).setOrigin(0.5);

    const guest = new PixelButton(this, 0, 0, "ENTER GUEST MODE", () => {
      if (!this.busy) this.scene.start("CharacterSelectScene", { mode: "guest" });
    }, { width: 280, fill: 0x0b453f, hoverFill: 0x147467 });
    const holder = new PixelButton(this, 0, 0, "CONNECT HOLDER", () => {
      if (!this.busy) this.scene.start("CharacterSelectScene", { mode: "wallet" });
    }, { width: 280, fill: 0x241642, hoverFill: 0x432a74 });
    const resume = new PixelButton(this, 0, 0, "CONTINUE SIGNAL", () => {
      void this.resumeSave();
    }, { width: 280, fill: 0x18233b, hoverFill: 0x2a4165 });
    resume.setEnabled(gameSession.hasSave());

    this.statusText = this.add.text(0, 0, "", {
      color: "#ffb6cc",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "15px",
      align: "center",
      wordWrap: { width: 560 },
    }).setOrigin(0.5);
    const footnote = this.add.text(0, 0, "LOCAL PROGRESS ONLY · NO TOKEN OR ENERGY CLAIMS", {
      color: "#69627f",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "11px",
      letterSpacing: 2,
      align: "center",
    }).setOrigin(0.5);

    this.layoutObjects = [eyebrow, title, subtitle, guest, holder, resume, this.statusText, footnote];
    this.layout();
    this.scale.on("resize", this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.layout, this);
    });
  }

  private async resumeSave() {
    if (this.busy) return;
    this.busy = true;
    this.statusText?.setText("Revalidating saved signal…");
    try {
      const save = gameSession.load();
      if (!save) throw new Error("No valid local save was found.");
      if (save.mode === "wallet" && save.character.tokenId) {
        const wallet = createWalletService();
        if (!wallet.available) {
          throw new Error("Reconnect through the D.Y.O.O.R site before resuming this holder save.");
        }
        await wallet.connect();
        if (!await wallet.recheckOwnership(save.character.tokenId)) {
          throw new Error("This wallet no longer owns the selected surviving droid.");
        }
        const verifiedParty = [save.character];
        for (const member of save.party.members) {
          if (!member.tokenId || member.id === save.character.id) continue;
          if (await wallet.recheckOwnership(member.tokenId)) verifiedParty.push(member);
        }
        gameSession.setPartyMembers(verifiedParty);
      }
      this.scene.start(
        save.location.mapId === "laboratory" ? "LaboratoryScene" : "IndustrialWastesScene",
        { useSavedLocation: true },
      );
    } catch (error) {
      this.statusText?.setText(error instanceof Error ? error.message : "Could not resume the save.");
      this.busy = false;
    }
  }

  private createBackdrop() {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x5d42a5, 0.2);
    for (let x = 0; x < Math.max(1200, this.scale.width); x += 48) {
      graphics.lineBetween(x, 0, x, Math.max(800, this.scale.height));
    }
    for (let y = 0; y < Math.max(800, this.scale.height); y += 48) {
      graphics.lineBetween(0, y, Math.max(1200, this.scale.width), y);
    }
    graphics.setScrollFactor(0);
    for (let index = 0; index < 24; index += 1) {
      const spark = this.add.rectangle(
        Phaser.Math.Between(0, Math.max(960, this.scale.width)),
        Phaser.Math.Between(0, Math.max(540, this.scale.height)),
        Phaser.Math.Between(2, 5),
        Phaser.Math.Between(2, 5),
        index % 2 ? 0x3fffe2 : 0xa56bff,
        0.5,
      );
      this.tweens.add({
        targets: spark,
        alpha: { from: 0.15, to: 0.8 },
        duration: Phaser.Math.Between(900, 2200),
        yoyo: true,
        repeat: -1,
        delay: Phaser.Math.Between(0, 1200),
      });
    }
  }

  private layout() {
    if (!this.layoutObjects.length) return;
    const [eyebrow, title, subtitle, guest, holder, resume, status, footnote] = this.layoutObjects;
    const width = this.scale.width;
    const height = this.scale.height;
    const centerX = width / 2;
    const compact = height < 650 || width < 560;
    const narrow = width < 520;
    const eyebrowText = eyebrow as Phaser.GameObjects.Text | undefined;
    const titleText = title as Phaser.GameObjects.Text | undefined;
    const subtitleText = subtitle as Phaser.GameObjects.Text | undefined;
    const statusText = status as Phaser.GameObjects.Text | undefined;
    const footnoteText = footnote as Phaser.GameObjects.Text | undefined;

    eyebrowText
      ?.setText(narrow ? "D.Y.O.O.R FIELD SIM // P-01" : "D.Y.O.O.R FIELD SIMULATION // PROTOTYPE 01")
      .setFontSize(narrow ? 10 : 15)
      .setLetterSpacing(narrow ? 2 : 3)
      .setPosition(centerX, compact ? 42 : height * 0.13);
    titleText
      ?.setFontSize(narrow ? 36 : compact ? 42 : 58)
      .setPosition(centerX, compact ? 137 : height * 0.31);
    subtitleText
      ?.setFontSize(narrow ? 13 : 18)
      .setLetterSpacing(narrow ? 2 : 4)
      .setWordWrapWidth(Math.max(280, width - 32), true)
      .setPosition(centerX, compact ? 220 : height * 0.48);
    guest?.setPosition(centerX, compact ? 292 : height * 0.61);
    holder?.setPosition(centerX, compact ? 352 : height * 0.72);
    resume?.setPosition(centerX, compact ? 412 : height * 0.83);
    statusText
      ?.setWordWrapWidth(Math.max(280, width - 40), true)
      .setPosition(centerX, compact ? 470 : height * 0.91);
    footnoteText
      ?.setText(narrow
        ? "LOCAL PROGRESS ONLY\nNO TOKEN OR ENERGY CLAIMS"
        : "LOCAL PROGRESS ONLY · NO TOKEN OR ENERGY CLAIMS")
      .setFontSize(narrow ? 9 : 11)
      .setLetterSpacing(narrow ? 1 : 2)
      .setLineSpacing(3)
      .setPosition(centerX, height - (narrow ? 34 : 24));
  }
}
