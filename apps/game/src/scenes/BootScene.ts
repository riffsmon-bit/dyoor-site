import Phaser from "phaser";
import { createWorldTextures } from "../entities/DroidSpriteFactory";
import { gameSession } from "../services/GameSession";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    this.load.image(
      "droid-holder-green",
      "/assets/sprites/pilots/dyoor-16-walk-v1.png",
    );
    this.load.image(
      "droid-holder-red",
      "/assets/sprites/pilots/dyoor-132-walk-v1.png",
    );
    this.load.image(
      "droid-holder-gold",
      "/assets/sprites/pilots/dyoor-1100-walk-v1.png",
    );
    this.load.image(
      "droid-token-17-pilot",
      "/assets/sprites/pilots/dyoor-17-walk-v1.png",
    );
    this.load.image(
      "droid-training-pilot",
      "/assets/sprites/pilots/dyoor-training-unit-01-walk-v1.png",
    );
    this.load.image(
      "droid-corrupted-scout-pilot",
      "/assets/sprites/pilots/dyoor-corrupted-scout-walk-v1.png",
    );
  }

  create() {
    createWorldTextures(this);
    gameSession.initialize(window.localStorage);
    this.scene.start("TitleScene");
  }
}
