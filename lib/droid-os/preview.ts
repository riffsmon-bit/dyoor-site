// Presentation fixtures only. Never use these values for ownership or execution.
export const DROID_OS_PREVIEW = true;

export type PreviewDroid = {
  id: string;
  role: string;
  color: string;
  mon: string;
  energy: string;
  achievements: number;
  interests: string[];
};

export const PREVIEW_DROIDS: readonly PreviewDroid[] = [
  { id: "11", role: "Explorer", color: "#39ffe2", mon: "58.40", energy: "2,480", achievements: 17, interests: ["NFTs", "Monad ecosystem", "Quests"] },
  { id: "16", role: "Signal hunter", color: "#a78bfa", mon: "24.10", energy: "1,620", achievements: 9, interests: ["New projects", "NFTs", "Research"] },
  { id: "7", role: "Pathfinder", color: "#f3c876", mon: "12.75", energy: "860", achievements: 6, interests: ["Ecosystem quests", "Art", "Discovery"] },
  { id: "3", role: "Observer", color: "#79bfdb", mon: "8.20", energy: "3,140", achievements: 12, interests: ["Contracts", "Research", "NFTs"] },
];

export const OS_VIEWS = ["Talk", "Portfolio", "Strategy", "Missions", "Opportunities", "Activity", "Achievements", "Energy", "Trait Lab", "Settings"] as const;
export type OsView = typeof OS_VIEWS[number];

export function droidDisplayName(droid: Pick<PreviewDroid, "id">) {
  return `D.Y.O.O.R #${droid.id}`;
}

export function previewReply(input: string, droid: PreviewDroid) {
  const question = input.toLowerCase();
  if (/send|buy|sell|swap|trade|withdraw|mint|snipe/.test(question)) {
    return "I can help you think through a move, but I haven’t moved anything. This is a UI preview: there’s no wallet connection, live quote, simulation, or execution. In the finished system, we’ll check your rules and prepare an exact action for your approval.";
  }
  if (/balance|portfolio|fund|mon|reserve/.test(question)) {
    return `In this sample layout, my balance is ${droid.mon} MON. The portfolio view shows how native funds, tokens and a protected reserve will fit together. These are demonstration amounts—not a live account reading. Want to explore the layout?`;
  }
  if (/rule|strategy|permission|mode/.test(question)) {
    return "Research first. Ask before action. That’s the idea behind ASK mode. Your interests help me find relevant things; only your explicit permissions can authorize spending. The Strategy screen lets you explore the draft controls without saving a real policy.";
  }
  return `I’m ${droidDisplayName(droid)}. My focus is ${droid.interests.slice(0, 2).join(" and ")}. The finished briefing will bring together sourced research and opportunities that match your interests. This response is scripted for the design review—no live research or AI service has run.`;
}
