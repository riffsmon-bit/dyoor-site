import type { MapId } from "../types/game";

export const TILE_SIZE = 32;

export type MapDefinition = {
  id: MapId;
  displayName: string;
  tiles: string[];
  palette: {
    floor: number;
    floorAlt: number;
    wall: number;
    wallAccent: number;
  };
  spawn: { x: number; y: number };
  returnSpawn: { x: number; y: number };
};

export const LABORATORY_MAP: MapDefinition = {
  id: "laboratory",
  displayName: "Core Laboratory",
  palette: {
    floor: 0x0d1728,
    floorAlt: 0x102239,
    wall: 0x182142,
    wallAccent: 0x37f7d4,
  },
  tiles: [
    "##############################",
    "#............................#",
    "#..######............######..#",
    "#..#....#............#....#..#",
    "#..#....#............#....#..#",
    "#..######............######..#",
    "#............................#",
    "#..........#######...........#",
    "#..........#.....#...........#",
    "#..........#.....#...........#",
    "#..........#######...........#",
    "#............................#",
    "#...####..............####...#",
    "#...#..#..............#..#...#",
    "#...####..............####...#",
    "#............................#",
    "#............................#",
    "#............DD..............#",
    "#............DD..............#",
    "#############..###############",
  ],
  spawn: { x: 15 * TILE_SIZE, y: 15 * TILE_SIZE },
  returnSpawn: { x: 14.5 * TILE_SIZE, y: 17 * TILE_SIZE },
};

export const INDUSTRIAL_WASTES_MAP: MapDefinition = {
  id: "industrial-wastes",
  displayName: "Rustbelt Expanse",
  palette: {
    floor: 0x1e1725,
    floorAlt: 0x291b2a,
    wall: 0x3b2635,
    wallAccent: 0xffb12f,
  },
  tiles: [
    "##############..####################",
    "#..................................#",
    "#..................................#",
    "#....#####..............#####......#",
    "#....#...#..............#...#......#",
    "#....#####..............#####......#",
    "#..................................#",
    "#..........####....................#",
    "#..........#..#.............####...#",
    "#..........####.............#..#...#",
    "#...........................####...#",
    "#..................................#",
    "#..#####.........................#.#",
    "#..#...#.........######..........#.#",
    "#..#####.........#....#..........#.#",
    "#................#....#............#",
    "#................######............#",
    "#..................................#",
    "#......####........................#",
    "#......#..#..............#####.....#",
    "#......####..............#...#.....#",
    "#.......................#####......#",
    "#..................................#",
    "####################################",
  ],
  spawn: { x: 15 * TILE_SIZE, y: 2.5 * TILE_SIZE },
  returnSpawn: { x: 15 * TILE_SIZE, y: 2.5 * TILE_SIZE },
};

export const MAPS: Record<MapId, MapDefinition> = {
  laboratory: LABORATORY_MAP,
  "industrial-wastes": INDUSTRIAL_WASTES_MAP,
};

export function isMapTileWalkable(definition: MapDefinition, tileX: number, tileY: number) {
  const row = definition.tiles[tileY];
  if (!row) return false;
  return row[tileX] !== "#" && row[tileX] !== undefined;
}
