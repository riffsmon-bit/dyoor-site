import Phaser from "phaser";
import { CORRUPTED_SCOUT, CORRUPTED_SCOUT_PROFILE } from "../data/characters";
import { createMetadataBattleSheet } from "../entities/DroidSpriteFactory";
import { gameSession } from "../services/GameSession";
import { BattleEngine } from "../systems/battle/BattleEngine";
import type { BattleAction, BattleSnapshot } from "../types/game";
import { PixelButton } from "../ui/PixelButton";

export class BattleScene extends Phaser.Scene {
  private engine!: BattleEngine;
  private state!: BattleSnapshot;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private enemySprite!: Phaser.GameObjects.Sprite;
  private playerBar!: Phaser.GameObjects.Rectangle;
  private enemyBar!: Phaser.GameObjects.Rectangle;
  private energyBar!: Phaser.GameObjects.Rectangle;
  private playerBarBack!: Phaser.GameObjects.Rectangle;
  private enemyBarBack!: Phaser.GameObjects.Rectangle;
  private energyBarBack!: Phaser.GameObjects.Rectangle;
  private playerName!: Phaser.GameObjects.Text;
  private enemyName!: Phaser.GameObjects.Text;
  private playerVitalsText!: Phaser.GameObjects.Text;
  private enemyVitalsText!: Phaser.GameObjects.Text;
  private heading!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private commandPanel!: Phaser.GameObjects.Rectangle;
  private logPanel!: Phaser.GameObjects.Rectangle;
  private playerPlatform!: Phaser.GameObjects.Ellipse;
  private enemyPlatform!: Phaser.GameObjects.Ellipse;
  private buttons: PixelButton[] = [];
  private continueButton?: PixelButton;
  private busy = false;
  private returnScene = "IndustrialWastesScene";
  private barWidth = 240;

  constructor() {
    super("BattleScene");
  }

  init(data: { returnScene?: string }) {
    this.returnScene = data?.returnScene || "IndustrialWastesScene";
  }

  create() {
    this.cameras.main.setBackgroundColor("#07050f");
    this.createBattleBackdrop();
    this.engine = new BattleEngine(gameSession.state.vitals, CORRUPTED_SCOUT);
    this.state = this.engine.state;

    this.heading = this.add.text(this.scale.width / 2, 38, "CORRUPTED SIGNAL INTERCEPT", {
      color: "#ff668d",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "26px",
      letterSpacing: 2,
      align: "center",
    }).setOrigin(0.5);
    const playerTexture = createMetadataBattleSheet(this, gameSession.state.character, "right");
    const enemyTexture = createMetadataBattleSheet(this, CORRUPTED_SCOUT_PROFILE, "left");
    this.playerPlatform = this.add.ellipse(0, 0, 230, 48, 0x1c6a76, 0.28)
      .setStrokeStyle(2, 0x47ffe5, 0.36);
    this.enemyPlatform = this.add.ellipse(0, 0, 230, 48, 0x6b193f, 0.3)
      .setStrokeStyle(2, 0xff4f85, 0.4);
    this.playerSprite = this.add.sprite(0, 0, playerTexture, "idle");
    this.enemySprite = this.add.sprite(0, 0, enemyTexture, "idle");
    this.playerSprite.play(`${playerTexture}-idle`);
    this.enemySprite.play(`${enemyTexture}-idle`);
    this.playerBarBack = this.add.rectangle(0, 0, 240, 14, 0x15222e).setOrigin(0, 0.5)
      .setStrokeStyle(1, 0x7b91a8, 0.5);
    this.enemyBarBack = this.add.rectangle(0, 0, 240, 14, 0x2b1723).setOrigin(0, 0.5)
      .setStrokeStyle(1, 0x8c6073, 0.5);
    this.energyBarBack = this.add.rectangle(0, 0, 240, 7, 0x151a2f).setOrigin(0, 0.5);
    this.playerBar = this.add.rectangle(0, 0, 240, 12, 0x39ffe2).setOrigin(0, 0.5);
    this.enemyBar = this.add.rectangle(0, 0, 240, 12, 0xff3f68).setOrigin(0, 0.5);
    this.energyBar = this.add.rectangle(0, 0, 240, 5, 0x9c6dff).setOrigin(0, 0.5);
    this.playerName = this.add.text(
      0,
      0,
      `${gameSession.state.identity.callsign} // ${gameSession.state.character.displayName}`.toUpperCase(),
      {
      color: "#eafffb",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "13px",
      letterSpacing: 1,
      },
    ).setOrigin(0, 0.5);
    this.enemyName = this.add.text(0, 0, "CORRUPTED SCOUT", {
      color: "#ffd9e3",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "13px",
      letterSpacing: 1,
    }).setOrigin(0, 0.5);
    this.playerVitalsText = this.add.text(0, 0, "", {
      color: "#c9fff6",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "11px",
    }).setOrigin(1, 0.5);
    this.enemyVitalsText = this.add.text(0, 0, "", {
      color: "#ffd3df",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "11px",
    }).setOrigin(1, 0.5);
    this.statsText = this.add.text(0, 0, "", {
      color: "#ded7f3",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "12px",
      letterSpacing: 1,
      align: "center",
    }).setOrigin(0.5);
    this.logPanel = this.add.rectangle(0, 0, 520, 120, 0x080b18, 0.94)
      .setStrokeStyle(2, 0x416b79, 0.8);
    this.commandPanel = this.add.rectangle(0, 0, 420, 120, 0x0b0a18, 0.96)
      .setStrokeStyle(2, 0x6a4aa2, 0.84);
    this.logText = this.add.text(0, 0, "", {
      color: "#ffffff",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "15px",
      lineSpacing: 5,
      align: "left",
      wordWrap: { width: 470 },
    }).setOrigin(0, 0.5);

    const buttonWidth = this.scale.width < 620 ? 142 : 185;
    const fontSize = this.scale.width < 620 ? 9 : 11;
    this.buttons = [
      new PixelButton(this, 0, 0, "ALLOY STRIKE  +3EN", () => this.act("strike"), {
        width: buttonWidth,
        height: 44,
        fontSize,
      }),
      new PixelButton(this, 0, 0, "CORE PULSE  -12EN", () => this.act("pulse"), {
        width: buttonWidth,
        height: 44,
        fontSize,
        fill: 0x0b4945,
        hoverFill: 0x147b70,
      }),
      new PixelButton(this, 0, 0, "DEFLECT  +8EN", () => this.act("guard"), {
        width: buttonWidth,
        height: 44,
        fontSize,
        fill: 0x29174c,
        hoverFill: 0x4a2c7e,
      }),
      new PixelButton(this, 0, 0, "OVERCLOCK  -20EN", () => this.act("overclock"), {
        width: buttonWidth,
        height: 44,
        fontSize,
        fill: 0x4b172f,
        hoverFill: 0x7c284e,
      }),
    ];
    this.refresh();
    this.layout();
    this.scale.on("resize", this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.layout, this);
    });
  }

  private act(action: BattleAction) {
    if (this.busy || this.state.status !== "active") return;
    const requiredEnergy = action === "pulse" ? 12 : action === "overclock" ? 20 : 0;
    if (this.state.playerEnergy < requiredEnergy) {
      this.state = this.engine.act(action);
      this.refresh();
      return;
    }
    this.busy = true;
    this.buttons.forEach((button) => button.setEnabled(false));
    this.playerSprite.anims.stop();
    this.enemySprite.anims.stop();
    this.playerSprite.setFrame("charge");
    const offensive = action !== "guard";
    const travel = offensive ? Math.max(14, this.scale.width * 0.025) : 0;
    this.tweens.add({
      targets: this.playerSprite,
      x: this.playerSprite.x + travel,
      scaleX: action === "guard" ? this.playerSprite.scaleX * 1.06 : this.playerSprite.scaleX,
      scaleY: action === "guard" ? this.playerSprite.scaleY * 1.06 : this.playerSprite.scaleY,
      yoyo: true,
      duration: 130,
      onComplete: () => {
        this.state = this.engine.act(action);
        this.refresh();
        if (offensive) {
          this.enemySprite.setFrame("hit").setTint(0xff738e);
          this.cameras.main.shake(action === "overclock" ? 150 : 90, action === "overclock" ? 0.007 : 0.003);
        }
        this.time.delayedCall(offensive ? 160 : 90, () => {
          this.enemySprite.clearTint();
          if (this.state.status === "victory") {
            this.busy = false;
            this.playerSprite.setFrame("idle");
            this.enemySprite.setFrame("hit");
            this.finishBattle();
            return;
          }
          this.animateEnemyCounter();
        });
      },
    });
  }

  private animateEnemyCounter() {
    const startX = this.enemySprite.x;
    this.enemySprite.setFrame("charge");
    this.tweens.add({
      targets: this.enemySprite,
      x: startX - Math.max(12, this.scale.width * 0.02),
      yoyo: true,
      duration: 120,
      onYoyo: () => {
        this.playerSprite.setFrame("hit").setTint(0xff8da2);
        this.cameras.main.shake(90, 0.003);
      },
      onComplete: () => {
        this.playerSprite.clearTint().setFrame("idle");
        this.enemySprite.setFrame("idle");
        this.playerSprite.play(`${this.playerSprite.texture.key}-idle`);
        this.enemySprite.play(`${this.enemySprite.texture.key}-idle`);
        this.busy = false;
        if (this.state.status === "active") {
          this.buttons.forEach((button) => button.setEnabled(true));
        } else {
          this.finishBattle();
        }
      },
    });
  }

  private finishBattle() {
    this.buttons.forEach((button) => button.setVisible(false));
    this.commandPanel.setVisible(false);
    const victory = this.state.status === "victory";
    this.statsText.setText(victory ? "SIGNAL STABILIZED // LOOT SECURED" : "CORE FAILURE // RECALL ACTIVE");
    if (victory) {
      gameSession.setVitals(
        Math.max(1, this.state.playerHealth),
        Math.min(this.state.playerMaxEnergy, this.state.playerEnergy + CORRUPTED_SCOUT.energyReward),
      );
      gameSession.markEnemyDefeated(CORRUPTED_SCOUT.id);
      if (CORRUPTED_SCOUT.itemReward) {
        gameSession.addInventoryItem(
          CORRUPTED_SCOUT.itemReward.itemId,
          CORRUPTED_SCOUT.itemReward.quantity,
        );
      }
    } else {
      gameSession.healFully();
      gameSession.setVitals(gameSession.state.vitals.maxHealth, 30);
      gameSession.updateLocation("laboratory", 15 * 32, 15 * 32, "down");
    }
    this.continueButton = new PixelButton(
      this,
      this.scale.width / 2,
      this.scale.height - 68,
      victory ? "COLLECT & CONTINUE" : "EMERGENCY RECALL",
      () => {
        this.scene.start(victory ? this.returnScene : "LaboratoryScene", { useSavedLocation: true });
      },
      {
        width: 280,
        fill: victory ? 0x0b4d43 : 0x4a172a,
        hoverFill: victory ? 0x167a6d : 0x7c2742,
      },
    );
  }

  private refresh() {
    const playerRatio = this.state.playerHealth / this.state.playerMaxHealth;
    const enemyRatio = this.state.enemyHealth / this.state.enemyMaxHealth;
    const energyRatio = this.state.playerEnergy / this.state.playerMaxEnergy;
    this.playerBar.setDisplaySize(Math.max(1, this.barWidth * playerRatio), 12);
    this.enemyBar.setDisplaySize(Math.max(1, this.barWidth * enemyRatio), 12);
    this.energyBar.setDisplaySize(Math.max(1, this.barWidth * energyRatio), 5);
    this.playerVitalsText.setText(
      `HP ${this.state.playerHealth}/${this.state.playerMaxHealth}  ·  EN ${this.state.playerEnergy}/${this.state.playerMaxEnergy}`,
    );
    this.enemyVitalsText.setText(`HP ${this.state.enemyHealth}/${this.state.enemyMaxHealth}`);
    this.statsText.setText(
      `TURN ${String(this.state.turn).padStart(2, "0")}  //  CHOOSE A CORE ROUTINE`,
    );
    this.logText.setText(this.state.log.join("\n"));
  }

  private createBattleBackdrop() {
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0x13233a, 0x25133c, 0x07050f, 0x07050f, 1);
    graphics.fillRect(0, 0, Math.max(1200, this.scale.width), Math.max(800, this.scale.height));
    graphics.lineStyle(1, 0xa46aff, 0.18);
    for (let y = 100; y < 800; y += 30) {
      graphics.lineBetween(0, y, 1200, y);
    }
  }

  private layout() {
    const width = this.scale.width;
    const height = this.scale.height;
    const compact = width < 700;
    const leftX = width * 0.28;
    const rightX = width * 0.72;
    const spriteY = compact
      ? Math.max(110, Math.min(height * 0.34, height - 350))
      : Math.max(120, Math.min(height * 0.36, height - 300));
    this.barWidth = compact ? Math.min(150, width * 0.36) : Math.min(220, width * 0.28);
    this.heading
      ?.setFontSize(compact ? 18 : 26)
      .setWordWrapWidth(Math.max(280, width - 32), true)
      .setPosition(width / 2, compact ? 45 : 38);
    const spriteScale = compact ? 0.74 : 0.92;
    this.playerSprite?.setScale(spriteScale).setPosition(leftX, spriteY);
    this.enemySprite?.setScale(spriteScale).setPosition(rightX, spriteY);
    this.playerPlatform?.setDisplaySize(compact ? 150 : 220, compact ? 32 : 44)
      .setPosition(leftX, spriteY + (compact ? 44 : 56));
    this.enemyPlatform?.setDisplaySize(compact ? 150 : 220, compact ? 32 : 44)
      .setPosition(rightX, spriteY + (compact ? 44 : 56));

    const playerBarX = Math.max(12, leftX - this.barWidth / 2);
    const enemyBarX = Math.min(width - this.barWidth - 12, rightX - this.barWidth / 2);
    const barY = spriteY + (compact ? 76 : 88);
    this.playerName?.setPosition(playerBarX, barY - 23).setFontSize(compact ? 10 : 13);
    this.enemyName?.setPosition(enemyBarX, barY - 23).setFontSize(compact ? 10 : 13);
    this.playerVitalsText
      ?.setOrigin(compact ? 0.5 : 1, 0.5)
      .setPosition(
        compact ? playerBarX + this.barWidth / 2 : playerBarX + this.barWidth,
        compact ? barY + 27 : barY - 23,
      )
      .setFontSize(compact ? 8 : 11);
    this.enemyVitalsText
      ?.setOrigin(compact ? 0.5 : 1, 0.5)
      .setPosition(
        compact ? enemyBarX + this.barWidth / 2 : enemyBarX + this.barWidth,
        compact ? barY + 22 : barY - 23,
      )
      .setFontSize(compact ? 8 : 11);
    this.playerBarBack?.setDisplaySize(this.barWidth, 14).setPosition(playerBarX, barY);
    this.enemyBarBack?.setDisplaySize(this.barWidth, 14).setPosition(enemyBarX, barY);
    this.playerBar?.setPosition(playerBarX, barY);
    this.enemyBar?.setPosition(enemyBarX, barY);
    this.energyBarBack?.setDisplaySize(this.barWidth, 7).setPosition(playerBarX, barY + 13);
    this.energyBar?.setPosition(playerBarX, barY + 13);

    if (compact) {
      const logHeight = 78;
      const commandHeight = 112;
      const commandY = height - commandHeight / 2 - 10;
      const logY = commandY - commandHeight / 2 - logHeight / 2 - 10;
      this.logPanel?.setDisplaySize(width - 24, logHeight).setPosition(width / 2, logY);
      this.commandPanel?.setDisplaySize(width - 24, commandHeight).setPosition(width / 2, commandY);
      this.logText
        ?.setPosition(24, logY)
        .setFontSize(12)
        .setWordWrapWidth(width - 48, true);
      this.statsText?.setPosition(width / 2, logY - logHeight / 2 - 16).setFontSize(9);
      const xGap = width * 0.25;
      const yGap = 25;
      this.buttons[0]?.setPosition(width / 2 - xGap, commandY - yGap);
      this.buttons[1]?.setPosition(width / 2 + xGap, commandY - yGap);
      this.buttons[2]?.setPosition(width / 2 - xGap, commandY + yGap);
      this.buttons[3]?.setPosition(width / 2 + xGap, commandY + yGap);
    } else {
      const panelY = height - 78;
      const logWidth = Math.min(500, width * 0.52);
      const commandWidth = Math.min(420, width * 0.44);
      const logX = 14 + logWidth / 2;
      const commandX = width - 14 - commandWidth / 2;
      this.logPanel?.setDisplaySize(logWidth, 126).setPosition(logX, panelY);
      this.commandPanel?.setDisplaySize(commandWidth, 126).setPosition(commandX, panelY);
      this.logText
        ?.setPosition(34, panelY)
        .setFontSize(15)
        .setWordWrapWidth(logWidth - 40, true);
      this.statsText?.setPosition(width / 2, panelY - 82).setFontSize(11);
      const xGap = commandWidth * 0.245;
      const yGap = 27;
      this.buttons[0]?.setPosition(commandX - xGap, panelY - yGap);
      this.buttons[1]?.setPosition(commandX + xGap, panelY - yGap);
      this.buttons[2]?.setPosition(commandX - xGap, panelY + yGap);
      this.buttons[3]?.setPosition(commandX + xGap, panelY + yGap);
    }
    if (this.state) this.refresh();
    this.continueButton?.setPosition(width / 2, height - 66);
  }
}
