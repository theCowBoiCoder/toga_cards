import catalogue from "../../catalog/topps-premier-league-2026-27.json";

type Holding = {
  season: string;
  collection: string;
  variant: string;
  number: string;
  player: string;
  club: string;
  stock: number;
};
type ChecklistCard = (typeof catalogue.cards)[number];
const identity = (
  card: Pick<Holding, "variant" | "number" | "player" | "club">,
) => JSON.stringify([card.variant, card.number, card.player, card.club]);

export function calculateSetProgress(holdings: Holding[]) {
  const stock = new Map<string, number>();
  for (const card of holdings) {
    if (
      card.season !== catalogue.season ||
      card.collection !== catalogue.collection
    )
      continue;
    const key = identity(card);
    stock.set(key, (stock.get(key) || 0) + Math.max(0, card.stock));
  }
  const groups = new Map<string, ChecklistCard[]>();
  for (const card of catalogue.cards) {
    const group = groups.get(card.variant) || [];
    group.push(card);
    groups.set(card.variant, group);
  }
  // Future Stars #1–20 belong to the 300-card base checklist as well as their subset.
  groups.set("Base", [...groups.get("Base")!, ...groups.get("Future Stars")!]);
  return [...groups]
    .map(([section, required]) => {
      const quantities = required.map((card) => stock.get(identity(card)) || 0);
      const completeSets = Math.min(...quantities);
      const nextSetOwned = quantities.filter(
        (quantity) => quantity > completeSets,
      ).length;
      return {
        section,
        total: required.length,
        completeSets,
        nextSetOwned,
        nextSetMissing: required.length - nextSetOwned,
      };
    })
    .sort((a, b) =>
      a.section === "Base"
        ? -1
        : b.section === "Base"
          ? 1
          : a.section.localeCompare(b.section),
    );
}
