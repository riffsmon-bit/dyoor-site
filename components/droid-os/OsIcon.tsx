import type { OsView } from "@/lib/droid-os/preview";

export type OsIconName = OsView | "arrow" | "plus" | "shield" | "close" | "world" | "grid";
const paths: Record<OsIconName, string> = {
  Talk: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Zm3 5h8M8 13h5",
  Portfolio: "M3 7h18v13H3V7Zm3 0V3h12v4M15 12h6v4h-6v-4Z",
  Strategy: "M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4",
  Missions: "M5 3h14v18H5V3Zm3 5 1 1 2-2M13 8h3M8 13l1 1 2-2M13 13h3M8 18h8",
  Opportunities: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z",
  Activity: "M2 12h5l3-8 4 16 3-8h5",
  Achievements: "m12 2 3 5 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1 3-5Z",
  Energy: "m14 2-10 12h7l-1 8 10-12h-7l1-8Z",
  "Trait Lab": "M9 2h6M10 2v7L4 19v3h16v-3L14 9V2M7 16h10",
  Settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  shield: "m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6",
  close: "m6 6 12 12M6 18 18 6",
  world: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2c-6 6-6 14 0 20 6-6 6-14 0-20Z",
  grid: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
};

export function OsIcon({ name, className = "" }: { name: OsIconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
