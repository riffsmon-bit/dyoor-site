import Phaser from "phaser";
import type { MapDefinition } from "../../data/maps";
import { isMapTileWalkable, TILE_SIZE } from "../../data/maps";

export type BuiltWorldMap = {
  width: number;
  height: number;
  walls: Phaser.Physics.Arcade.StaticGroup;
};

export function buildWorldMap(scene: Phaser.Scene, definition: MapDefinition): BuiltWorldMap {
  const width = Math.max(...definition.tiles.map((row) => row.length)) * TILE_SIZE;
  const height = definition.tiles.length * TILE_SIZE;
  const textureKey = `map-${definition.id}`;

  if (!scene.textures.exists(textureKey)) {
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    for (let row = 0; row < definition.tiles.length; row += 1) {
      const line = definition.tiles[row] || "";
      for (let column = 0; column < line.length; column += 1) {
        const tile = line[column];
        const x = column * TILE_SIZE;
        const y = row * TILE_SIZE;
        if (tile === "#") {
          graphics.fillStyle(definition.palette.wall, 1);
          graphics.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          graphics.fillStyle(definition.palette.wallAccent, 0.48);
          graphics.fillRect(x, y, TILE_SIZE, 2);
          graphics.fillStyle(0x050813, 0.6);
          graphics.fillRect(x, y + TILE_SIZE - 5, TILE_SIZE, 5);
        } else {
          const alternating = (row + column) % 2 === 0;
          graphics.fillStyle(
            alternating ? definition.palette.floor : definition.palette.floorAlt,
            1,
          );
          graphics.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          graphics.fillStyle(definition.palette.wallAccent, 0.09);
          graphics.fillRect(x + 15, y + 15, 2, 2);
        }
      }
    }
    graphics.generateTexture(textureKey, width, height);
    graphics.destroy();
  }

  scene.add.image(0, 0, textureKey).setOrigin(0).setDepth(0);
  const walls = scene.physics.add.staticGroup();

  for (let row = 0; row < definition.tiles.length; row += 1) {
    const line = definition.tiles[row] || "";
    let runStart = -1;
    for (let column = 0; column <= line.length; column += 1) {
      const isWall = line[column] === "#";
      if (isWall && runStart < 0) runStart = column;
      if ((!isWall || column === line.length) && runStart >= 0) {
        const runEnd = column - 1;
        const runWidth = (runEnd - runStart + 1) * TILE_SIZE;
        const zone = scene.add.zone(
          runStart * TILE_SIZE + runWidth / 2,
          row * TILE_SIZE + TILE_SIZE / 2,
          runWidth,
          TILE_SIZE,
        );
        scene.physics.add.existing(zone, true);
        walls.add(zone);
        runStart = -1;
      }
    }
  }

  return { width, height, walls };
}

export function mapTileIsWalkable(definition: MapDefinition, tileX: number, tileY: number) {
  return isMapTileWalkable(definition, tileX, tileY);
}
