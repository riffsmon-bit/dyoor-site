import type { SVGProps } from "react";

export type WorldIconName = "chat" | "announce" | "collection" | "lab" | "energy" | "trade" | "activity" | "mail" | "arrow" | "shield" | "close";

const paths: Record<WorldIconName, string> = {
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 9h8M7 13h5",
  announce: "m3 10 13-5v14L3 14v-4Zm4 5 1 6h4l-2-5M20 8v8",
  collection: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
  lab: "M9 3h6M10 3v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M8 15h8",
  energy: "m13 2-9 12h7l-1 8 10-13h-8l1-7Z",
  trade: "M3 7h17l-4-4M21 17H4l4 4M20 7l-4 4M4 17l4-4",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  mail: "M3 5h18v14H3V5Zm0 1 9 7 9-7",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  close: "m6 6 12 12M6 18 18 6",
};

export function WorldIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: WorldIconName }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>;
}
