import Phaser from "phaser";
import type { MapDefinition } from "../data/maps";
import { createMetadataDroidSheet } from "../entities/DroidSpriteFactory";
import { Player } from "../entities/Player";
import { UnifiedInput } from "../input/UnifiedInput";
import { gameSession } from "../services/GameSession";
import type { Direction } from "../types/game";
import { DialogueBox } from "../ui/DialogueBox";
import { Hud } from "../ui/Hud";
import { InventoryOverlay } from "../ui/InventoryOverlay";
import { MobileControls } from "../ui/MobileControls";
import { PartyOverlay } from "../ui/PartyOverlay";
import { buildWorldMap } from "../systems/world/WorldMapBuilder";

export abstract class BaseWorldScene extends Phaser.Scene {
  protected player!: Player;
  protected controls!: UnifiedInput;
  protected dialogue!: DialogueBox;
  protected hud!: Hud;
  protected mobileControls!: MobileControls;
  protected inventory!: InventoryOverlay;
  protected party!: PartyOverlay;
  protected mapDefinition!: MapDefinition;
  protected transitioning = false;
  private lastPersistAt = 0;
  private noticeText?: Phaser.GameObjects.Text;
  private useSavedLocation = false;

  init(data: { useSavedLocation?: boolean }) {
    this.useSavedLocation = Boolean(data?.useSavedLocation);
  }

  create() {
    const map = buildWorldMap(this, this.mapDefinition);
    this.physics.world.setBounds(0, 0, map.width, map.height);
    this.cameras.main.setBounds(0, 0, map.width, map.height);

    const state = gameSession.state;
    const canUseSaved = this.useSavedLocation && state.location.mapId === this.mapDefinition.id;
    const spawn = canUseSaved
      ? { x: state.location.x, y: state.location.y }
      : this.mapDefinition.spawn;
    const direction: Direction = canUseSaved ? state.location.direction : "down";
    const textureKey = createMetadataDroidSheet(this, state.character);
    this.player = new Player(this, spawn.x, spawn.y, textureKey, direction);
    this.physics.add.collider(this.player, map.walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setZoom(1);

    this.controls = new UnifiedInput(this);
    this.dialogue = new DialogueBox(this);
    this.hud = new Hud(this, this.mapDefinition.displayName);
    this.inventory = new InventoryOverlay(this);
    this.party = new PartyOverlay(
      this,
      (memberId) => this.activatePartyMember(memberId),
      () => {
        this.mobileControls?.setVisible(true);
        this.hud?.setVisible(true);
      },
    );
    this.mobileControls = new MobileControls(this, this.controls);
    this.noticeText = this.add.text(this.scale.width / 2, 94, "", {
      color: "#fff5b4",
      backgroundColor: "#080b18dd",
      padding: { x: 14, y: 8 },
      fontFamily: '"Arial Black", sans-serif',
      fontSize: "14px",
      align: "center",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1800).setAlpha(0);

    this.populateWorld();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (!this.transitioning && this.player?.active) this.persistLocation();
    });
  }

  override update(time: number) {
    if (!this.player?.active || this.transitioning) return;
    if (this.controls.consumeInventory()) {
      this.party.close();
      const opened = this.inventory.toggle();
      this.mobileControls.setVisible(!opened);
      this.hud.setVisible(!opened);
      this.player.halt();
    }
    if (this.controls.consumeParty()) {
      this.inventory.close();
      const opened = this.party.toggle();
      this.mobileControls.setVisible(!opened);
      this.hud.setVisible(!opened);
      this.player.halt();
    }
    if (this.isWorldModalOpen() || this.inventory.visible || this.party.visible) {
      this.player.halt();
      return;
    }

    if (this.dialogue.active) {
      this.player.halt();
      if (this.controls.consumeAction()) this.dialogue.advance();
      return;
    }

    this.player.move(this.controls.movement());
    if (this.controls.consumeAction()) this.handleAction();
    this.checkTransitions();
    this.hud.refresh();
    if (time - this.lastPersistAt > 1_000) {
      this.persistLocation();
      this.lastPersistAt = time;
    }
  }

  protected abstract populateWorld(): void;
  protected abstract handleAction(): void;
  protected abstract checkTransitions(): void;

  protected isWorldModalOpen() {
    return false;
  }

  private activatePartyMember(memberId: string) {
    const profile = gameSession.setActivePartyMember(memberId);
    if (!profile) return false;
    const textureKey = createMetadataDroidSheet(this, profile);
    this.player.setTexture(textureKey, `${this.player.direction}-0`);
    this.player.halt();
    this.hud.refresh();
    this.notice(`ACTIVE DROID · ${profile.displayName.toUpperCase()}`);
    return true;
  }

  protected near(object: Phaser.GameObjects.Components.Transform, distance = 78) {
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, object.x, object.y) <= distance;
  }

  protected showDialogue(speaker: string, lines: string[], onComplete?: () => void) {
    this.player.halt();
    this.dialogue.show(speaker, lines, onComplete);
  }

  protected notice(message: string) {
    if (!this.noticeText) return;
    this.noticeText
      .setText(message)
      .setPosition(this.scale.width / 2, this.scale.width < 560 ? 154 : 116)
      .setWordWrapWidth(Math.max(240, this.scale.width - 48), true)
      .setAlpha(1);
    this.tweens.killTweensOf(this.noticeText);
    this.tweens.add({
      targets: this.noticeText,
      alpha: 0,
      delay: 1_800,
      duration: 400,
    });
  }

  protected transitionTo(sceneKey: string, mapId: "laboratory" | "industrial-wastes", x: number, y: number) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.player.halt();
    gameSession.updateLocation(mapId, x, y, this.player.direction);
    this.cameras.main.fadeOut(220, 5, 5, 18);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(sceneKey, { useSavedLocation: true });
    });
  }

  protected persistLocation() {
    gameSession.updateLocation(
      this.mapDefinition.id,
      Math.round(this.player.x),
      Math.round(this.player.y),
      this.player.direction,
    );
  }
}
