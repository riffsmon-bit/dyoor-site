import Phaser from "phaser";
import { TRAINING_DROID } from "../data/characters";
import { createMetadataDroidSheet } from "../entities/DroidSpriteFactory";
import { validateOwnedSelection } from "../services/OwnershipSelection";
import { createWalletService } from "../services/WalletService";
import type { CharacterProfile, GameMode } from "../types/game";
import type { OwnedDroid, WalletPort } from "../types/wallet";
import { PixelButton } from "../ui/PixelButton";

export class CharacterSelectScene extends Phaser.Scene {
  private mode: GameMode = "guest";
  private profiles: CharacterProfile[] = [];
  private selectedIndex = 0;
  private cardContainer?: Phaser.GameObjects.Container;
  private statusText?: Phaser.GameObjects.Text;
  private heading?: Phaser.GameObjects.Text;
  private confirm?: PixelButton;
  private backButton?: PixelButton;
  private wallet: WalletPort = createWalletService();
  private busy = false;

  constructor() {
    super("CharacterSelectScene");
  }

  init(data: { mode?: GameMode }) {
    this.mode = data.mode === "wallet" ? "wallet" : "guest";
  }

  create() {
    this.cameras.main.setBackgroundColor("#060716");
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x101634, 0.45)
      .setOrigin(0);
    this.heading = this.add.text(this.scale.width / 2, 54, "SELECT ACTIVE DROID", {
      color: "#f6f3ff",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "38px",
      letterSpacing: 2,
      align: "center",
    }).setOrigin(0.5);
    this.statusText = this.add.text(this.scale.width / 2, 104, "", {
      color: "#79ffe9",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "16px",
      align: "center",
      wordWrap: { width: Math.min(680, this.scale.width - 32) },
    }).setOrigin(0.5);
    this.backButton = new PixelButton(this, 92, 46, "← BACK", () => this.scene.start("TitleScene"), {
      width: 145,
      height: 40,
      fontSize: 13,
    });
    this.confirm = new PixelButton(
      this,
      this.scale.width / 2,
      this.scale.height - 62,
      "DEPLOY DROID",
      () => void this.confirmSelection(),
      { width: 250, fill: 0x0b4a43, hoverFill: 0x147d70 },
    ).setEnabled(false);

    this.scale.on("resize", this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.layout, this);
    });
    this.layout();

    if (this.mode === "guest") {
      this.profiles = [TRAINING_DROID];
      this.statusText.setText("Guest simulation · generic training droid · local progress only");
      this.renderCards();
    } else {
      this.statusText.setText("Requesting the approved D.Y.O.O.R wallet host…");
      void this.loadWalletDroids();
    }
  }

  private async loadWalletDroids() {
    this.busy = true;
    try {
      if (!this.wallet.available) {
        throw new Error(
          "Wallet mode is available when launched by the D.Y.O.O.R site. "
          + "For local UI testing only, reload with ?mock-wallet=1.",
        );
      }
      await this.wallet.connect();
      const droids = await this.wallet.getOwnedDroids();
      if (!droids.length) {
        this.statusText?.setText("No surviving Season 2 droids were verified for this wallet.");
        this.profiles = [];
        this.renderCards();
        return;
      }
      this.profiles = droids;
      const prefix = this.wallet.kind === "mock"
        ? "DEVELOPMENT MOCK — no ownership claim"
        : `${droids.length} server-verified surviving droid${droids.length === 1 ? "" : "s"}`;
      this.statusText?.setText(prefix);
      this.renderCards();
    } catch (error) {
      this.statusText?.setText(error instanceof Error ? error.message : "Wallet discovery failed.");
      this.profiles = [];
      this.renderCards();
    } finally {
      this.busy = false;
      this.renderCards();
    }
  }

  private renderCards() {
    this.cardContainer?.destroy(true);
    this.cardContainer = this.add.container(0, 0);
    const visibleProfiles = this.profiles.slice(0, 6);
    const width = this.scale.width;
    const columns = width < 680 ? Math.min(2, Math.max(1, visibleProfiles.length)) : Math.min(3, Math.max(1, visibleProfiles.length));
    const cardWidth = width < 680 ? 145 : 190;
    const gap = width < 680 ? 16 : 24;
    const totalWidth = columns * cardWidth + (columns - 1) * gap;
    const startX = width / 2 - totalWidth / 2 + cardWidth / 2;
    const startY = width < 520 ? 285 : width < 680 ? 190 : 205;

    visibleProfiles.forEach((profile, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = startX + column * (cardWidth + gap);
      const y = startY + row * 210;
      const selected = index === this.selectedIndex;
      const panel = this.add.rectangle(x, y, cardWidth, 184, selected ? 0x113e46 : 0x0a0b18, 0.97)
        .setStrokeStyle(2, selected ? 0x42ffe3 : 0x563b8b, 0.9)
        .setInteractive();
      const textureKey = createMetadataDroidSheet(this, profile);
      const sprite = this.add.sprite(x, y - 28, textureKey, "down-0").setScale(1.5);
      const name = this.add.text(x, y + 58, profile.displayName, {
        color: "#ffffff",
        fontFamily: '"Arial Black", sans-serif',
        fontSize: width < 680 ? "12px" : "14px",
        align: "center",
        wordWrap: { width: cardWidth - 12 },
      }).setOrigin(0.5);
      const type = this.add.text(x, y + 78, profile.tokenId ? `S2 TOKEN #${profile.tokenId}` : "GUEST TRAINER", {
        color: profile.tokenId ? "#72ffe9" : "#f4d457",
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: "11px",
        align: "center",
      }).setOrigin(0.5);
      panel.on("pointerup", () => {
        this.selectedIndex = index;
        this.renderCards();
      });
      this.cardContainer?.add([panel, sprite, name, type]);
    });

    this.confirm?.setEnabled(Boolean(this.profiles[this.selectedIndex]) && !this.busy);
  }

  private async confirmSelection() {
    if (this.busy) return;
    const profile = this.profiles[this.selectedIndex];
    if (!profile) return;
    this.busy = true;
    this.confirm?.setEnabled(false);
    try {
      if (this.mode === "wallet") {
        const result = await validateOwnedSelection(
          this.wallet,
          Number(profile.tokenId),
          this.profiles as OwnedDroid[],
        );
        if (!result.valid) throw new Error(result.reason);
      }
      const textureKey = createMetadataDroidSheet(this, profile);
      const selectedProfile = { ...profile, textureKey };
      const partyProfiles = [
        selectedProfile,
        ...this.profiles.filter((member) => member.id !== selectedProfile.id),
      ].slice(0, 3);
      this.scene.start("IdentitySetupScene", {
        mode: this.mode,
        selectedProfile,
        partyProfiles,
      });
    } catch (error) {
      this.statusText?.setText(error instanceof Error ? error.message : "Droid selection failed.");
      this.busy = false;
      this.confirm?.setEnabled(true);
    }
  }

  private layout() {
    const width = this.scale.width;
    const narrow = width < 520;
    this.backButton?.setPosition(narrow ? 75 : 92, narrow ? 36 : 46);
    this.heading
      ?.setText(narrow ? "SELECT DROID" : "SELECT ACTIVE DROID")
      .setFontSize(narrow ? 28 : 38)
      .setPosition(width / 2, narrow ? 94 : 54);
    this.statusText
      ?.setFontSize(narrow ? 14 : 16)
      .setPosition(width / 2, narrow ? 148 : 104)
      .setWordWrapWidth(Math.min(680, width - 32), true);
    this.confirm?.setPosition(width / 2, this.scale.height - 62);
    this.renderCards();
  }
}
