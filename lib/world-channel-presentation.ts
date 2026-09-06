// Presentation only. Access and available channels always come from the server.
const channels: Record<string, { title: string; group: string; icon: "chat" | "announce" | "collection" | "lab" | "energy" | "trade" | "activity" }> = {
  "world-lobby": { title: "The commons", group: "Community", icon: "chat" },
  announcements: { title: "Announcements", group: "Community", icon: "announce" },
  "season-1": { title: "Season 1 & Ascended", group: "Holder rooms", icon: "collection" },
  "season-2": { title: "Season 2", group: "Holder rooms", icon: "collection" },
  "trait-lab": { title: "Trait Lab", group: "Holder rooms", icon: "lab" },
  "energy-grid": { title: "Energy grid", group: "Holder rooms", icon: "energy" },
  "trade-desk": { title: "Trade desk", group: "Holder rooms", icon: "trade" },
  "sales-feed": { title: "Sales", group: "On-chain activity", icon: "activity" },
  "tip-ledger": { title: "Tip ledger", group: "On-chain activity", icon: "activity" },
  "burn-log": { title: "Burn log", group: "On-chain activity", icon: "activity" },
};

export function worldChannelPresentation(id: string) {
  return channels[id] || { title: id.replaceAll("-", " "), group: "Community", icon: "chat" as const };
}
