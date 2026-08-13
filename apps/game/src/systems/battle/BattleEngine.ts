import type {
  BattleAction,
  BattleSnapshot,
  EnemyDefinition,
  PlayerVitals,
} from "../../types/game";

export type RandomSource = () => number;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rollInteger(random: RandomSource, minimum: number, maximum: number) {
  return minimum + Math.floor(clamp(random(), 0, 0.999999) * (maximum - minimum + 1));
}

export class BattleEngine {
  private readonly enemy: EnemyDefinition;
  private readonly random: RandomSource;
  private snapshot: BattleSnapshot;

  constructor(vitals: PlayerVitals, enemy: EnemyDefinition, random: RandomSource = Math.random) {
    this.enemy = enemy;
    this.random = random;
    this.snapshot = {
      turn: 1,
      status: "active",
      playerHealth: clamp(vitals.health, 1, vitals.maxHealth),
      playerMaxHealth: vitals.maxHealth,
      playerEnergy: clamp(vitals.energy, 0, vitals.maxEnergy),
      playerMaxEnergy: vitals.maxEnergy,
      enemyHealth: enemy.maxHealth,
      enemyMaxHealth: enemy.maxHealth,
      guarding: false,
      log: [`${enemy.name} intercepts the signal.`],
    };
  }

  get state(): BattleSnapshot {
    return structuredClone(this.snapshot);
  }

  act(action: BattleAction) {
    if (this.snapshot.status !== "active") return this.state;
    const log: string[] = [];
    this.snapshot.guarding = false;

    if (action === "pulse") {
      if (this.snapshot.playerEnergy < 12) {
        log.push("The core needs 12 Energy for a Pulse.");
        this.snapshot.log = log;
        return this.state;
      }
      const damage = rollInteger(this.random, 15, 22);
      this.snapshot.playerEnergy -= 12;
      this.snapshot.enemyHealth = Math.max(0, this.snapshot.enemyHealth - damage);
      log.push(`Core Pulse hits for ${damage}.`);
    } else if (action === "overclock") {
      if (this.snapshot.playerEnergy < 20) {
        log.push("Overclock needs 20 Energy.");
        this.snapshot.log = log;
        return this.state;
      }
      const damage = rollInteger(this.random, 24, 34);
      this.snapshot.playerEnergy -= 20;
      this.snapshot.playerHealth = Math.max(1, this.snapshot.playerHealth - 4);
      this.snapshot.enemyHealth = Math.max(0, this.snapshot.enemyHealth - damage);
      log.push(`Overclock ruptures the signal for ${damage}. Feedback costs 4 HP.`);
    } else if (action === "guard") {
      this.snapshot.guarding = true;
      this.snapshot.playerEnergy = Math.min(
        this.snapshot.playerMaxEnergy,
        this.snapshot.playerEnergy + 8,
      );
      log.push("Deflection field raised. 8 Energy recovered.");
    } else {
      const damage = rollInteger(this.random, 8, 14);
      this.snapshot.enemyHealth = Math.max(0, this.snapshot.enemyHealth - damage);
      this.snapshot.playerEnergy = Math.min(
        this.snapshot.playerMaxEnergy,
        this.snapshot.playerEnergy + 3,
      );
      log.push(`Alloy Strike hits for ${damage}.`);
    }

    if (this.snapshot.enemyHealth <= 0) {
      this.snapshot.status = "victory";
      this.snapshot.log = [...log, `${this.enemy.name} has been stabilized.`];
      return this.state;
    }

    let enemyDamage = rollInteger(this.random, this.enemy.attackMin, this.enemy.attackMax);
    if (this.snapshot.guarding) enemyDamage = Math.max(1, Math.ceil(enemyDamage * 0.4));
    this.snapshot.playerHealth = Math.max(0, this.snapshot.playerHealth - enemyDamage);
    log.push(`${this.enemy.name} deals ${enemyDamage} damage.`);

    if (this.snapshot.playerHealth <= 0) {
      this.snapshot.status = "defeat";
      log.push("Emergency recall initiated.");
    } else {
      this.snapshot.turn += 1;
    }
    this.snapshot.log = log;
    return this.state;
  }
}
