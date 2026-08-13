import Phaser from "phaser";
import { BattleScene } from "../scenes/BattleScene";
import { BootScene } from "../scenes/BootScene";
import { CharacterSelectScene } from "../scenes/CharacterSelectScene";
import { IdentitySetupScene } from "../scenes/IdentitySetupScene";
import { IndustrialWastesScene } from "../scenes/IndustrialWastesScene";
import { LaboratoryScene } from "../scenes/LaboratoryScene";
import { TitleScene } from "../scenes/TitleScene";

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#070716",
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  render: {
    antialias: false,
    antialiasGL: false,
    pixelArt: true,
    roundPixels: true,
  },
  dom: {
    createContainer: true,
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: "100%",
    height: "100%",
  },
  physics: {
    default: "arcade",
    arcade: {
      debug: false,
      gravity: { x: 0, y: 0 },
    },
  },
  scene: [
    BootScene,
    TitleScene,
    CharacterSelectScene,
    IdentitySetupScene,
    LaboratoryScene,
    IndustrialWastesScene,
    BattleScene,
  ],
};
