import Phaser from "phaser";
import { gameConfig } from "./config/gameConfig";
import "./style.css";

const status = document.querySelector<HTMLElement>("#game-status");

try {
  const game = new Phaser.Game(gameConfig);
  if (import.meta.env.DEV) {
    Object.defineProperty(window, "__DYOOR_GAME_DEV__", {
      value: game,
      configurable: true,
    });
  }
  status?.remove();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (status) status.textContent = `Game initialization failed: ${message}`;
  throw error;
}
