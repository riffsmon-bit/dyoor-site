import { LABORATORY_MAP, TILE_SIZE } from "../data/maps";
import {
  DR_HALOGEN_APPEARANCE,
  ECHO_SURVEYOR_APPEARANCE,
} from "../data/characters";
import { createMetadataDroidSheet } from "../entities/DroidSpriteFactory";
import { NonPlayerCharacter } from "../entities/NonPlayerCharacter";
import { gameSession } from "../services/GameSession";
import { miningEnergyForProtocol } from "../systems/identity/FieldProtocol";
import {
  advanceCoreRecovery,
  advanceEnergyMining,
} from "../systems/quest/QuestEngine";
import { BaseWorldScene } from "./BaseWorldScene";

export class LaboratoryScene extends BaseWorldScene {
  protected override mapDefinition = LABORATORY_MAP;
  private scientist!: NonPlayerCharacter;
  private echoSurveyor!: NonPlayerCharacter;

  constructor() {
    super("LaboratoryScene");
  }

  protected override populateWorld() {
    this.add.text(15 * TILE_SIZE, 2.2 * TILE_SIZE, "CORE LAB // 07", {
      color: "#3fffe2",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "18px",
      letterSpacing: 3,
    }).setOrigin(0.5).setDepth(4);

    this.scientist = new NonPlayerCharacter(
      this,
      15 * TILE_SIZE,
      13 * TILE_SIZE,
      createMetadataDroidSheet(this, DR_HALOGEN_APPEARANCE),
      "down",
    );
    this.physics.add.collider(this.player, this.scientist);
    this.add.text(this.scientist.x, this.scientist.y + 34, "DR. HALOGEN // #17", {
      color: "#bda5ff",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "9px",
      letterSpacing: 1,
    }).setOrigin(0.5).setDepth(22);

    // Token 1100 is verified unminted in the registry. It is therefore a
    // game-controlled character, never a holder-selectable NFT.
    this.echoSurveyor = new NonPlayerCharacter(
      this,
      11 * TILE_SIZE,
      11 * TILE_SIZE,
      createMetadataDroidSheet(this, ECHO_SURVEYOR_APPEARANCE),
      "down",
    );
    this.physics.add.collider(this.player, this.echoSurveyor);
    this.add.text(this.echoSurveyor.x, this.echoSurveyor.y + 34, "ECHO SURVEYOR", {
      color: "#ffd55d",
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "9px",
      letterSpacing: 1,
    }).setOrigin(0.5).setDepth(22);
    this.add.text(this.echoSurveyor.x, this.echoSurveyor.y + 46, "UNACTIVATED UNIT", {
      color: "#9f94bd",
      fontFamily: '"Trebuchet MS", sans-serif',
      fontSize: "8px",
    }).setOrigin(0.5).setDepth(22);

    const doorGlow = this.add.rectangle(14 * TILE_SIZE, 18.3 * TILE_SIZE, 58, 12, 0x3fffe2, 0.35)
      .setDepth(3);
    this.tweens.add({
      targets: doorGlow,
      alpha: { from: 0.15, to: 0.75 },
      duration: 900,
      yoyo: true,
      repeat: -1,
    });
  }

  protected override handleAction() {
    if (this.near(this.echoSurveyor, 86)) {
      this.player.halt();
      const emission = gameSession.syncCoreEmission();
      this.showDialogue("Echo Surveyor", [
        `Your ${emission.tier.toUpperCase()} core emits ${emission.energyPerHour} simulated Energy each hour.`,
        `Emission continues behind quests and exploration. Current local bank: ${emission.bankedEnergy.toFixed(1)} Energy.`,
        "This prototype bank is local-only. Public rewards require an authoritative server ledger.",
      ]);
      return;
    }
    if (!this.near(this.scientist, 86)) {
      this.notice("No nearby signal. Approach Dr. Halogen, the Echo Surveyor, or the exit.");
      return;
    }
    const current = gameSession.state;
    const stage = current.quest.coreRecovery;
    if (stage === "not_started") {
      this.showDialogue("Dr. Halogen", [
        "The Rustbelt grid just lost an Energy Core.",
        "Without it, the Burned Echo memorials will go dark. Retrieve the Core and bring it back intact.",
      ], () => {
        const transition = advanceCoreRecovery(stage, "talk_to_scientist");
        gameSession.setQuestStage(transition.stage);
        this.notice(transition.message);
      });
    } else if (stage === "active") {
      this.showDialogue("Dr. Halogen", [
        "The signal is east of the outer assembly ruins.",
        "Watch for a corrupted scout. It is reacting to the same Energy signature.",
      ]);
    } else if (stage === "core_collected") {
      this.showDialogue("Dr. Halogen", [
        "You found it. Hold the casing steady while I synchronize the flywheel.",
        "Core stable. The grid remembers every unit that chose deflation over corruption.",
      ], () => {
        const transition = advanceCoreRecovery(stage, "return_energy_core");
        gameSession.setQuestStage(transition.stage);
        const mining = advanceEnergyMining(current.quest.energyMining, "unlock");
        if (mining.changed) gameSession.setMiningQuestStage(mining.state.stage);
        gameSession.removeInventoryItem("energy-core", 1);
        gameSession.addEnergy(40);
        gameSession.addInventoryItem("stabilized-core", 1);
        this.notice("QUEST COMPLETE · +40 CORE CHARGE · MINING SURVEY UNLOCKED");
      });
    } else {
      const mining = gameSession.state.quest.energyMining;
      if (mining.stage === "locked") {
        const unlocked = advanceEnergyMining(mining, "unlock");
        gameSession.setMiningQuestStage(unlocked.state.stage);
        this.notice(unlocked.message);
        return;
      }
      if (mining.stage === "available") {
        const nodeReward = miningEnergyForProtocol(gameSession.state.identity.protocol);
        this.showDialogue("Dr. Halogen", [
          "The restored grid exposed three charged ore seams in the Rustbelt.",
          `Mine all three while your core keeps emitting in the background. Your protocol yields ${nodeReward} simulated Energy per sample.`,
        ], () => {
          const accepted = advanceEnergyMining(mining, "accept");
          gameSession.setMiningQuestStage(accepted.state.stage);
          this.notice(accepted.message);
        });
        return;
      }
      if (mining.stage === "active") {
        this.showDialogue("Dr. Halogen", [
          `Seam samples recovered: ${mining.collectedNodeIds.length}/3.`,
          "Follow the cyan mining beacons in the Rustbelt. Your passive core emission does not pause while you mine.",
        ]);
        return;
      }
      if (mining.stage === "ready") {
        this.showDialogue("Dr. Halogen", [
          "All three ore signatures are stable. Routing the seam charge into your local Energy bank.",
          "Survey complete. The deeper mining grid is still buried beyond this prototype region.",
        ], () => {
          const completed = advanceEnergyMining(mining, "turn_in");
          gameSession.setMiningQuestStage(completed.state.stage);
          gameSession.removeInventoryItem("energy-ore", 3);
          gameSession.addInventoryItem("refined-energy-cell", 1);
          gameSession.awardSimulatedEnergy(100);
          this.notice("MINING QUEST COMPLETE · +100 SIMULATED ENERGY");
        });
        return;
      }
      this.showDialogue("Dr. Halogen", [
        "The laboratory is stable again.",
        "Your core keeps emitting while you explore. More Energy seams will open with later regions.",
      ]);
    }
  }

  protected override checkTransitions() {
    if (this.player.y > 18.35 * TILE_SIZE && this.player.x > 12.8 * TILE_SIZE && this.player.x < 15.4 * TILE_SIZE) {
      this.transitionTo(
        "IndustrialWastesScene",
        "industrial-wastes",
        LABORATORY_MAP.spawn.x,
        2.4 * TILE_SIZE,
      );
    }
  }
}
