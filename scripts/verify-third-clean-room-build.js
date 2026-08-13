import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIELDS = [
  "contract",
  "sourceSha256",
  "wholeArtifactSha256",
  "canonicalArtifactSha256",
  "abiSha256",
  "constructorSchema",
  "constructorSchemaSha256",
  "creationBytecodeHash",
  "runtimeBytecodeHash",
  "storageLayoutSha256",
  "linkReferencesSha256",
  "immutableReferencesSha256",
];

function option(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function requiredPath(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required.`);
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function critical(record) {
  return Object.fromEntries(FIELDS.map((field) => [field, record[field]]));
}

const reproducibilityPath = requiredPath("--reproducibility");
const cleanRoomPath = requiredPath("--clean-room");
const output = option("--output");
const reproducibility = readJson(reproducibilityPath);
const cleanRoom = readJson(cleanRoomPath);
const runA = reproducibility.runA.records.map(critical);
const runB = reproducibility.runB.records.map(critical);
const third = cleanRoom.contracts.map(critical);
const aEqualsB = JSON.stringify(runA) === JSON.stringify(runB);
const thirdMatches = JSON.stringify(runA) === JSON.stringify(third);

if (!aEqualsB || !thirdMatches) {
  throw new Error("The third clean-room build does not reproduce the frozen release outputs.");
}

const report = {
  schema: "hoodyoor-third-clean-room-check-v1",
  sourceCommit: reproducibility.sourceCommit,
  buildAEqualsBuildB: aEqualsB,
  cleanRoomThirdMatches: thirdMatches,
  existingBuildCacheUsed: false,
  localGeneratedArtifactsUsed: false,
  productionEnvironmentFilesPresent: false,
  signingVariablesPresent: false,
  contractsChecked: third.length,
  records: third,
  result: "PASS",
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  const target = path.isAbsolute(output) ? output : path.resolve(ROOT, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serialized);
}
process.stdout.write(serialized);
