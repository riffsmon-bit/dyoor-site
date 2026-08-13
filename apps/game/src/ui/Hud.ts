import Phaser from "phaser";
import { gameSession } from "../services/GameSession";
import { formatEmissionEnergy } from "../systems/emission/CoreEmission";

export class Hud {
  private readonly container: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly locationText: Phaser.GameObjects.Text;
  private readonly healthText: Phaser.GameObjects.Text;
  private readonly energyText: Phaser.GameObjects.Text;
  private readonly emissionText: Phaser.GameObjects.Text;
  private readonly questText: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene, location: string) {
    this.panel = scene.add.rectangle(0, 0, 460, 70, 0x040816, 0.88)
      .setOrigin(0)
      .setStrokeStyle(1, 0x7655d9, 0.75);
    this.locationText = scene.add.text(16, 10, location.toUpperCase(), {
      color: "#67ffe7",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "14px",
      letterSpacing: 2,
    });
    this.healthText = scene.add.text(16, 36, "", {
      color: "#ff759b",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "13px",
    });
    this.energyText = scene.add.text(145, 36, "", {
      color: "#72ffe9",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "13px",
    });
    this.emissionText = scene.add.text(16, 60, "", {
      color: "#ffe27a",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "11px",
      letterSpacing: 1,
    });
    this.questText = scene.add.text(265, 60, "", {
      color: "#d4c4ff",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "13px",
    });
    this.container = scene.add.container(12, 12, [
      this.panel,
      this.locationText,
      this.healthText,
      this.energyText,
      this.emissionText,
      this.questText,
    ]).setScrollFactor(0).setDepth(1000);
    this.layout();
    this.refresh();
    scene.scale.on("resize", this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off("resize", this.layout, this);
    });
  }

  refresh() {
    const state = gameSession.state;
    this.locationText.setText(`${state.identity.callsign} // ${this.locationText.text.split(" // ").at(-1)}`);
    this.healthText.setText(`HP ${Math.ceil(state.vitals.health)}/${state.vitals.maxHealth}`);
    this.energyText.setText(`CORE ${Math.floor(state.vitals.energy)}/${state.vitals.maxEnergy}`);
    this.emissionText.setText(
      `${state.coreEmission.tier.toUpperCase()} EMISSION`
      + ` · ${state.coreEmission.energyPerHour}/H`
      + ` · BANK ${formatEmissionEnergy(state.coreEmission.bankedEnergy)}`
      + ` · TEAM ${state.party.members.length}/3`,
    );
    const coreLabels = {
      not_started: "Talk to Dr. Halogen",
      active: "Find the Energy Core",
      core_collected: "Return to the laboratory",
      complete: "Core Recovery complete",
    };
    const miningLabels = {
      locked: coreLabels[state.quest.coreRecovery],
      available: "New quest: Energy Seam Survey",
      active: `Mine charged ore ${state.quest.energyMining.collectedNodeIds.length}/3`,
      ready: "Return ore to Dr. Halogen",
      complete: "Energy Seam Survey complete",
    };
    this.questText.setText(
      state.quest.coreRecovery === "complete"
        ? miningLabels[state.quest.energyMining.stage]
        : coreLabels[state.quest.coreRecovery],
    );
  }

  setVisible(visible: boolean) {
    this.container.setVisible(visible);
  }

  private layout() {
    const width = this.scene.scale.width;
    const compact = width < 560;
    const panelWidth = Math.min(460, Math.max(296, width - 24));
    this.panel.setSize(panelWidth, compact ? 118 : 92);
    this.locationText.setFontSize(compact ? 12 : 14);
    this.healthText.setPosition(16, 36).setFontSize(compact ? 12 : 13);
    this.energyText.setPosition(compact ? 126 : 145, 36).setFontSize(compact ? 12 : 13);
    this.emissionText
      .setPosition(16, 60)
      .setFontSize(compact ? 9 : 11)
      .setWordWrapWidth(panelWidth - 32, true);
    this.questText
      .setPosition(compact ? 16 : 265, compact ? 86 : 60)
      .setFontSize(compact ? 12 : 13)
      .setWordWrapWidth(compact ? panelWidth - 32 : Math.max(160, panelWidth - 276), true);
  }
}
