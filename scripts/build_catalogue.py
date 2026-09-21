import json
from datetime import UTC, date, datetime
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT.parent / "catalogues" / "WWE collector app" / "Completed set catalogues"
OUTPUT = ROOT / "data" / "catalogue.json"

SET_CONFIG = {
    "2025_Topps_Universe_WWE_Master_Catalogue.xlsx": {
        "id": "2025-topps-universe-wwe",
        "name": "2025 Topps Universe WWE",
        "shortName": "Universe WWE",
        "accent": "#8b5cf6",
    },
    "2025_Topps_WWE_x_BAPE_Master_Catalogue.xlsx": {
        "id": "2025-topps-wwe-x-bape",
        "name": "2025 Topps WWE x BAPE",
        "shortName": "WWE x BAPE",
        "accent": "#f59e0b",
    },
    "2025_Topps_Finest_WWE_Master_Catalogue.xlsx": {
        "id": "2025-topps-finest-wwe",
        "name": "2025 Topps Finest WWE",
        "shortName": "Finest WWE",
        "accent": "#06b6d4",
    },
    "2025_Topps_Chrome_WWE_x_Cactus_Jack_Master_Catalogue.xlsx": {
        "id": "2025-topps-chrome-cactus-jack",
        "name": "2025 Topps Chrome WWE x Cactus Jack",
        "shortName": "Chrome x Cactus Jack",
        "accent": "#ef4444",
    },
}


def clean(value):
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def rows_as_dicts(sheet):
    rows = sheet.iter_rows(values_only=True)
    headers = [clean(value) for value in next(rows)]
    for row in rows:
        values = [clean(value) for value in row]
        if not any(value is not None for value in values):
            continue
        yield dict(zip(headers, values))


def main():
    sets = []
    cards = []

    for filename, config in SET_CONFIG.items():
        path = SOURCE_DIR / filename
        workbook = load_workbook(path, read_only=True, data_only=True)

        set_cards = []
        for row in rows_as_dicts(workbook["Master Cards"]):
            card = {
                "id": row["Card UID"],
                "setId": config["id"],
                "order": int(row["Checklist Order"]),
                "number": str(row["Card Number"]),
                "name": row["Display Name"],
                "subject2": row["Subject 2"],
                "category": row["Category"],
                "subset": row["Subset"],
                "subsetCode": row["Subset Code"],
                "roster": row["Roster"],
                "rookie": row["Rookie"],
                "parallelGroup": row["Parallel Group"],
            }
            set_cards.append(card)
            cards.append(card)

        subsets = []
        for row in rows_as_dicts(workbook["Subsets"]):
            subsets.append({
                "category": row["Category"],
                "name": row["Subset"],
                "code": row["Subset Code"],
                "count": int(row["Card Count"]),
            })

        master_rows = list(rows_as_dicts(workbook["Master Cards"]))
        release_date = master_rows[0]["Release Date"] if master_rows else None
        sets.append({
            **config,
            "year": 2025,
            "manufacturer": "Topps",
            "releaseDate": release_date,
            "cardCount": len(set_cards),
            "subsetCount": len(subsets),
            "subsets": subsets,
        })

    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "setCount": len(sets),
        "cardCount": len(cards),
        "sets": sets,
        "cards": cards,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(cards):,} cards across {len(sets)} sets to {OUTPUT}")


if __name__ == "__main__":
    main()
