# Topps Flagship Premier League 2026/27 catalogue

Source: [Topps official checklist PDF](https://cdn.shopify.com/s/files/1/0739/2015/1805/files/26_27_Topps_Flagship_Premier_League_Checklist_2.pdf?v=1784890627), linked from the [Topps product page](https://www-next.topps.com/pages/topps-flagship-premier-league). Retrieved 8 September 2026.

The JSON contains all 1,138 individually listed cards in 43 sections: 300 numbered base cards (including 20 Future Stars), plus 838 inserts, autograph and relic cards. It does not expand unlisted colour/serial-number parallels. Topps says its checklist reflects intended production and actual contents may vary.

Names, clubs and card numbers follow the source, including unusual spellings and identifiers. Dual autographs occupy two player rows per card: these are combined into one entry. The repeated DA-ZP label at the page boundary is treated as one card. Golden Boot year-won labels are not part of card names or numbers. Rookie flags and PDF page references are retained in the JSON.

`scripts/extract-checklist.py` reproduces the JSON from the official PDF using pdfplumber. Download the linked PDF into `catalog/topps-premier-league-2026-27.pdf` to reproduce it; the PDF itself is excluded from Git. It rejects unrecognised rows, duplicate section/card-number combinations and an incomplete 1–300 base sequence. The JSON records the PDF SHA-256.

On database initialization, the app imports missing entries only. Matching season, collection, number, section, player and club entries are preserved with their existing condition, quantities and transactions. New cards have no stock movements and condition `Not assessed`. Restarting cannot reset stock or add duplicate catalogue entries. Future checklist revisions with changed identifiers require a reviewed migration, not an automatic replacement.
