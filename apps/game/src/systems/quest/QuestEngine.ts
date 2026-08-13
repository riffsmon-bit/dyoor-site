import type {
  EnergyMiningQuestState,
  MiningQuestStage,
  QuestStage,
} from "../../types/game";

export type QuestEvent = "talk_to_scientist" | "collect_energy_core" | "return_energy_core";

export type QuestTransition = {
  stage: QuestStage;
  changed: boolean;
  message: string;
};

export function advanceCoreRecovery(stage: QuestStage, event: QuestEvent): QuestTransition {
  if (stage === "not_started" && event === "talk_to_scientist") {
    return {
      stage: "active",
      changed: true,
      message: "Quest started: recover the missing Energy Core from the Rustbelt Expanse.",
    };
  }
  if (stage === "active" && event === "collect_energy_core") {
    return {
      stage: "core_collected",
      changed: true,
      message: "Energy Core secured. Return it to Dr. Halogen.",
    };
  }
  if (stage === "core_collected" && event === "return_energy_core") {
    return {
      stage: "complete",
      changed: true,
      message: "Core stabilized. The laboratory grid is online.",
    };
  }
  return {
    stage,
    changed: false,
    message: stage === "complete"
      ? "The Core Recovery protocol is complete."
      : "No quest state changed.",
  };
}

export type MiningQuestEvent = "unlock" | "accept" | "collect_node" | "turn_in";

export type MiningQuestTransition = {
  state: EnergyMiningQuestState;
  changed: boolean;
  message: string;
};

export function advanceEnergyMining(
  state: EnergyMiningQuestState,
  event: MiningQuestEvent,
  nodeId?: string,
): MiningQuestTransition {
  if (state.stage === "locked" && event === "unlock") {
    return {
      state: { stage: "available", collectedNodeIds: [] },
      changed: true,
      message: "Energy Seam Survey unlocked.",
    };
  }
  if (state.stage === "available" && event === "accept") {
    return {
      state: { stage: "active", collectedNodeIds: [] },
      changed: true,
      message: "Mining quest started: recover three charged ore signals.",
    };
  }
  if (state.stage === "active" && event === "collect_node" && nodeId) {
    if (!/^seam-[a-z0-9-]{1,32}$/.test(nodeId) || state.collectedNodeIds.includes(nodeId)) {
      return { state, changed: false, message: "That seam signal was already recovered." };
    }
    const collectedNodeIds = [...state.collectedNodeIds, nodeId].slice(0, 3);
    const stage: MiningQuestStage = collectedNodeIds.length === 3 ? "ready" : "active";
    return {
      state: { stage, collectedNodeIds },
      changed: true,
      message: stage === "ready"
        ? "All seam samples recovered. Return to Dr. Halogen."
        : `Charged ore recovered (${collectedNodeIds.length}/3).`,
    };
  }
  if (state.stage === "ready" && event === "turn_in") {
    return {
      state: { stage: "complete", collectedNodeIds: [...state.collectedNodeIds] },
      changed: true,
      message: "Energy Seam Survey complete.",
    };
  }
  return {
    state,
    changed: false,
    message: state.stage === "complete"
      ? "The Energy Seam Survey is complete."
      : "No mining quest state changed.",
  };
}
