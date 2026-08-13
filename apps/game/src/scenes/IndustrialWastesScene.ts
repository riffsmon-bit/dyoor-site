import Phaser from "phaser";
import { CORRUPTED_SCOUT_PROFILE } from "../data/characters";
import { INDUSTRIAL_WASTES_MAP, TILE_SIZE } from "../data/maps";
import { createMetadataDroidSheet } from "../entities/DroidSpriteFactory";
import { NonPlayerCharacter } from "../entities/NonPlayerCharacter";
import { gameSession } from "../services/GameSession";
import { miningEnergyForProtocol } from "../systems/identity/FieldProtocol";
import { advanceCoreRecovery } from "../systems/quest/QuestEngine";
import { BaseWorldScene } from "./BaseWorldScene";

export class IndustrialWastesScene extends BaseWorldScene {
  protected override mapDefinition = INDUSTRIAL_WASTES_MAP;
  private core?: Phaser.Physics.Arcade.Sprite;
  private enemy?: NonPlayerCharacter;
  private readonly miningNodes = new Map<string, Phaser.Physics.Arcade.Sprite>();
  private battleStarting = false;

  constructor() {
    super("IndustrialWastesScene");
  }

  protected override populateWorld() {
    this.add.text(18 * TILE_SIZE, 2.2 * TILE_SIZE, "RUSTBELT EXPANSE // SIGNAL UNSTABLE", {
      color: "#ffb340",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "16px",
      letterSpacing: 2,
    }).setOrigin(0.5).setDepth(4);

    if (gameSession.state.quest.coreRecovery === "active") {
      this.core = this.physics.add.sprite(28 * TILE_SIZE, 16 * TILE_SIZE, "energy-core")
        .setDepth(12);
      (this.core.body as Phaser.Physics.Arcade.Body).setSize(24, 24);
      this.tweens.add({
        targets: this.core,
        y: this.core.y - 8,
        alpha: { from: 0.65, to: 1 },
        duration: 750,
        yoyo: true,
        repeat: -1,
      });
      this.physics.add.overlap(this.player, this.core, () => this.collectCore());
    }

    if (!gameSession.state.defeatedEnemies.includes("corrupted-scout")) {
      const corruptedTexture = createMetadataDroidSheet(this, CORRUPTED_SCOUT_PROFILE);
      this.enemy = new NonPlayerCharacter(
        this,
        21 * TILE_SIZE,
        12 * TILE_SIZE,
        corruptedTexture,
        "left",
      );
      this.enemy.play(`${corruptedTexture}-walk-left`);
      this.physics.add.overlap(this.player, this.enemy, () => this.startBattle());
      const marker = this.add.text(this.enemy.x, this.enemy.y - 48, "!", {
        color: "#ff315c",
        fontFamily: '"Arial Black", sans-serif',
        fontSize: "24px",
      }).setOrigin(0.5).setDepth(30);
      this.tweens.add({
        targets: marker,
        y: marker.y - 6,
        duration: 500,
        yoyo: true,
        repeat: -1,
      });
    }

    if (gameSession.state.quest.energyMining.stage === "active") {
      const collected = new Set(gameSession.state.quest.energyMining.collectedNodeIds);
      const nodes = [
        { id: "seam-north", x: 26 * TILE_SIZE, y: 6 * TILE_SIZE },
        { id: "seam-west", x: 8 * TILE_SIZE, y: 8 * TILE_SIZE },
        { id: "seam-south", x: 30 * TILE_SIZE, y: 17 * TILE_SIZE },
      ];
      for (const node of nodes) {
        if (collected.has(node.id)) continue;
        const sprite = this.physics.add.sprite(node.x, node.y, "energy-core")
          .setScale(0.78)
          .setTint(0x61ffe6)
          .setDepth(12);
        (sprite.body as Phaser.Physics.Arcade.Body).setSize(28, 28);
        this.miningNodes.set(node.id, sprite);
        this.tweens.add({
          targets: sprite,
          y: sprite.y - 6,
          angle: { from: -3, to: 3 },
          duration: 620,
          yoyo: true,
          repeat: -1,
        });
        this.physics.add.overlap(this.player, sprite, () => this.collectMiningNode(node.id));
      }
    }
  }

  protected override handleAction() {
    if (this.core && this.near(this.core, 72)) {
      this.collectCore();
      return;
    }
    if (this.enemy && this.near(this.enemy, 74)) {
      this.startBattle();
      return;
    }
    const nearbyMiningNode = [...this.miningNodes.entries()].find(
      ([, node]) => node.active && this.near(node, 72),
    );
    if (nearbyMiningNode) {
      this.collectMiningNode(nearbyMiningNode[0]);
      return;
    }
    this.notice("Only static answers. Explore deeper into the Rustbelt.");
  }

  protected override checkTransitions() {
    if (this.player.y < 1.65 * TILE_SIZE && this.player.x > 13.2 * TILE_SIZE && this.player.x < 16.8 * TILE_SIZE) {
      this.transitionTo(
        "LaboratoryScene",
        "laboratory",
        LABORATORY_MAP_RETURN_X,
        17.2 * TILE_SIZE,
      );
    }
  }

  private collectCore() {
    if (!this.core?.active || gameSession.state.quest.coreRecovery !== "active") return;
    this.core.destroy();
    this.core = undefined;
    const transition = advanceCoreRecovery("active", "collect_energy_core");
    gameSession.setQuestStage(transition.stage);
    gameSession.addInventoryItem("energy-core", 1);
    this.showDialogue("Recovered Signal", [
      "The Energy Core hums with archived Burned Echo telemetry.",
      "Return it to Dr. Halogen before the corrupted grid reacquires the signal.",
    ], () => this.notice(transition.message));
  }

  private startBattle() {
    if (this.battleStarting || this.transitioning) return;
    this.battleStarting = true;
    this.transitioning = true;
    this.persistLocation();
    this.player.halt();
    this.cameras.main.shake(180, 0.008);
    this.time.delayedCall(180, () => {
      this.scene.start("BattleScene", {
        enemyId: "corrupted-scout",
        returnScene: "IndustrialWastesScene",
      });
    });
  }

  private collectMiningNode(nodeId: string) {
    const node = this.miningNodes.get(nodeId);
    if (!node?.active || !gameSession.collectMiningNode(nodeId)) return;
    node.destroy();
    this.miningNodes.delete(nodeId);
    const mining = gameSession.state.quest.energyMining;
    const count = mining.collectedNodeIds.length;
    if (mining.stage === "ready") {
      this.showDialogue("Charged Seam", [
        "Final ore signature secured. Passive Core Emission remained online throughout the survey.",
        "Return all three samples to Dr. Halogen for a 100 Energy completion bonus.",
      ]);
    } else {
      const nodeReward = miningEnergyForProtocol(gameSession.state.identity.protocol);
      this.notice(`CHARGED ORE ${count}/3 · +${nodeReward} SIMULATED ENERGY`);
    }
  }
}

const LABORATORY_MAP_RETURN_X = 14 * TILE_SIZE;
