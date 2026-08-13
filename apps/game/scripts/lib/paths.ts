import path from "node:path";
import { fileURLToPath } from "node:url";

const libraryDirectory = path.dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = path.resolve(libraryDirectory, "../../../..");
export const GAME_ROOT = path.join(REPOSITORY_ROOT, "apps", "game");
export const GAME_DATA_ROOT = path.join(REPOSITORY_ROOT, "data", "game");
export const GAME_CACHE_ROOT = path.join(GAME_DATA_ROOT, "cache");
export const PRIVATE_DATA_ROOT = path.join(GAME_DATA_ROOT, "private");
export const METADATA_CACHE_ROOT = path.join(GAME_CACHE_ROOT, "metadata");
export const SPRITE_CACHE_ROOT = path.join(GAME_ROOT, ".cache", "sprites");
export const PIXEL_LAYER_ROOT = path.join(GAME_ROOT, "public", "assets", "sprites", "layers");
export const PILOT_SPRITE_ROOT = path.join(GAME_ROOT, "public", "assets", "sprites", "pilots");

export function isPathInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertPathInside(root: string, candidate: string, label: string) {
  if (!isPathInside(root, candidate)) {
    throw new Error(`${label} escapes the approved root: ${candidate}`);
  }
  return path.resolve(candidate);
}

export function resolveRepositoryPath(value: string, label: string) {
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  return assertPathInside(REPOSITORY_ROOT, resolved, label);
}
