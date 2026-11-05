import { getInventory } from "../utils/inventory";
import { toCsv } from "../utils/csv";

export default defineEventHandler((event) => {
  const kind = getQuery(event).kind === "sales" ? "sales" : "inventory";
  const { cards, sales } = getInventory().snapshot();
  const rows =
    kind === "sales"
      ? [
          [
            "Date",
            "Player",
            "Card number",
            "Variant",
            "Quantity",
            "Gross GBP",
            "Fees GBP",
            "Cost GBP",
            "Profit GBP",
            "Platform",
            "Fee status",
          ],
          ...sales.map((s: any) => [
            s.date,
            s.player,
            s.number,
            s.variant,
            s.quantity,
            s.gross / 100,
            s.fees / 100,
            s.cost / 100,
            (s.gross - s.fees - s.cost) / 100,
            s.platform,
            s.ebay_fees_confirmed === 0
              ? "Provisional - fees awaiting review"
              : "Recorded",
          ]),
        ]
      : [
          [
            "Player",
            "Club",
            "Season",
            "Collection",
            "Card number",
            "Variant",
            "Condition",
            "Stock",
            "Stock cost GBP",
          ],
          ...cards.map((c) => [
            c.player,
            c.club,
            c.season,
            c.collection,
            c.number,
            c.variant,
            c.condition,
            c.stock,
            c.stock_cost / 100,
          ]),
        ];
  setHeader(event, "Content-Type", "text/csv; charset=utf-8");
  setHeader(
    event,
    "Content-Disposition",
    `attachment; filename="toga-${kind}.csv"`,
  );
  setHeader(event, "Cache-Control", "no-store");
  return toCsv(rows);
});
