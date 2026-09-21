"""Build RingVault's static catalogue and deterministic Supabase seed batches."""

import argparse
import hashlib
import json
from datetime import UTC, date, datetime
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
OUTPUT = ROOT / "data" / "catalogue.json"
DEFAULT_SQL_DIR = ROOT / "supabase" / "generated" / "catalogue"

SET_CONFIG = [
    ("collation_sources/2025_Topps_Universe_WWE_Master_Catalogue.xlsx", "2025-topps-universe-wwe", "2025 Topps Universe WWE", "Universe WWE", "#8b5cf6"),
    ("collation_sources/WWE collector app/2025_Topps_WWE_x_BAPE_Master_Catalogue.xlsx", "2025-topps-wwe-x-bape", "2025 Topps WWE x BAPE", "WWE x BAPE", "#f59e0b"),
    ("collation_sources/WWE collector app/2025_Topps_Finest_WWE_Master_Catalogue.xlsx", "2025-topps-finest-wwe", "2025 Topps Finest WWE", "Finest WWE", "#06b6d4"),
    ("collation_sources/WWE collector app/2025_Topps_Chrome_WWE_x_Cactus_Jack_Master_Catalogue.xlsx", "2025-topps-chrome-wwe-x-cactus-jack", "2025 Topps Chrome WWE x Cactus Jack", "Chrome x Cactus Jack", "#fb7185"),
    ("collation_sources/WWE collector app/2025_Topps_Chrome_WWE_Cactus_Jack_x_WrestleMania_Master_Catalogue.xlsx", "2025-topps-chrome-cactus-jack-wrestlemania", "2025 Topps Chrome WWE Cactus Jack x WrestleMania", "Cactus Jack x WrestleMania", "#ef4444"),
    ("collation_sources/WWE collector app/2025_Topps_Chrome_Sapphire_WWE_Master_Catalogue.xlsx", "2025-topps-chrome-sapphire-wwe", "2025 Topps Chrome Sapphire WWE", "Chrome Sapphire WWE", "#3b82f6"),
]


def clean(value):
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    if isinstance(value, str):
        return value.strip() or None
    return value


def rows_as_dicts(sheet):
    rows = sheet.iter_rows(values_only=True)
    headers = [clean(value) for value in next(rows)]
    for row in rows:
        values = [clean(value) for value in row]
        if any(value is not None for value in values):
            yield dict(zip(headers, values))


def as_bool(value):
    return str(value or "").strip().lower() in {"yes", "true", "1", "y"}


def as_int(value):
    return None if value in (None, "") else int(value)


def sql_literal(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def stable_id(prefix, *parts):
    digest = hashlib.sha256("\x1f".join(str(part or "") for part in parts).encode()).hexdigest()[:20]
    return f"{prefix}-{digest}"


def write_batches(sql_dir, table, columns, rows, conflict, batch_size=500):
    for index in range(0, len(rows), batch_size):
        batch = rows[index:index + batch_size]
        values = ",\n".join("(" + ",".join(sql_literal(row.get(column)) for column in columns) + ")" for row in batch)
        assignments = ",".join(f"{column}=excluded.{column}" for column in columns if column not in conflict)
        query = (
            f"insert into public.{table} ({','.join(columns)}) values\n{values}\n"
            f"on conflict ({','.join(conflict)}) do update set {assignments};\n"
        )
        (sql_dir / f"{table}_{index // batch_size + 1:03d}.sql").write_text(query, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, default=WORKSPACE)
    parser.add_argument("--sql-dir", type=Path, default=DEFAULT_SQL_DIR)
    args = parser.parse_args()

    sets, subsets, cards, rules, variants, sources = [], [], [], [], [], []
    static_sets, static_cards = [], []
    seen_cards, seen_variants = set(), set()

    for relative_path, set_id, set_name, short_name, accent in SET_CONFIG:
        path = args.source_root / relative_path
        workbook = load_workbook(path, read_only=True, data_only=True)
        master = list(rows_as_dicts(workbook["Master Cards"]))
        subset_rows = list(rows_as_dicts(workbook["Subsets"]))
        rule_rows = list(rows_as_dicts(workbook["Parallel Rules"]))
        variant_rows = list(rows_as_dicts(workbook["Variant Seed"]))
        source_rows = list(rows_as_dicts(workbook["Sources & Notes"]))
        release_date = master[0].get("Release Date")
        manufacturer = master[0].get("Manufacturer") or "Topps"
        sets.append({
            "id": set_id, "name": set_name, "short_name": short_name, "year": int(master[0].get("Set Year") or 2025),
            "manufacturer": manufacturer, "release_date": release_date, "source_file": path.name, "accent": accent,
            "card_count": len(master), "subset_count": len(subset_rows), "variant_count": len(variant_rows),
        })

        static_subsets = []
        subset_names = {}
        for row in subset_rows:
            subset = {
                "set_id": set_id, "subset_code": str(row["Subset Code"]), "category": row.get("Category"),
                "name": row.get("Subset"), "card_count": as_int(row.get("Card Count")),
                "parallel_group": row.get("Parallel Group"), "source_url": row.get("Source URL"),
            }
            subsets.append(subset)
            subset_names[subset["subset_code"]] = subset["name"]
            static_subsets.append({"category": subset["category"], "name": subset["name"], "code": subset["subset_code"], "count": subset["card_count"]})

        for row in master:
            card_id = str(row["Card UID"])
            if card_id in seen_cards:
                raise ValueError(f"Duplicate card UID: {card_id}")
            seen_cards.add(card_id)
            card = {
                "id": card_id, "set_id": set_id, "checklist_order": int(row["Checklist Order"]),
                "category": row.get("Category"), "subset_code": str(row["Subset Code"]),
                "card_number": str(row["Card Number"]), "display_name": row.get("Display Name"),
                "subject_1": row.get("Subject 1"), "subject_2": row.get("Subject 2"), "roster": row.get("Roster"),
                "rookie": as_bool(row.get("Rookie")), "parallel_group": row.get("Parallel Group"),
                "image_status": row.get("Image Status"), "pricing_status": row.get("Pricing Status"),
                "source_url": row.get("Source URL"), "notes": row.get("Notes"),
            }
            cards.append(card)
            static_cards.append({
                "id": card_id, "setId": set_id, "order": card["checklist_order"], "number": card["card_number"],
                "name": card["display_name"], "subject2": card["subject_2"], "category": card["category"],
                "subset": subset_names[card["subset_code"]], "subsetCode": card["subset_code"], "roster": card["roster"],
                "rookie": "Yes" if card["rookie"] else "No", "parallelGroup": card["parallel_group"],
            })

        for row in rule_rows:
            rule_id = stable_id("rule", set_id, row.get("Parallel Group"), row.get("Applies To"), row.get("Parallel"), row.get("Serial Cap"), row.get("Serial Exact"), row.get("Exclusive Note"))
            rules.append({
                "id": rule_id, "set_id": set_id, "parallel_group": row.get("Parallel Group"), "applies_to": row.get("Applies To"),
                "parallel": row.get("Parallel"), "serial_cap": as_int(row.get("Serial Cap")), "serial_exact": row.get("Serial Exact"),
                "exclusive_note": row.get("Exclusive Note"), "numbering_note": row.get("Numbering / Verification Note"),
                "verification_status": row.get("Verification Status"),
            })

        for row in variant_rows:
            variant_id = str(row["Variant UID"])
            if variant_id in seen_variants:
                raise ValueError(f"Duplicate variant UID: {variant_id}")
            if str(row["Card UID"]) not in seen_cards:
                raise ValueError(f"Orphan variant {variant_id}")
            seen_variants.add(variant_id)
            variants.append({
                "id": variant_id, "set_id": set_id, "card_id": str(row["Card UID"]), "variant_order": int(row["Variant Order"]),
                "subset": row.get("Subset"), "card_number": str(row.get("Card Number")), "display_name": row.get("Display Name"),
                "parallel": row.get("Parallel"), "serial_cap": as_int(row.get("Serial Cap")), "serial_exact": row.get("Serial Exact"),
                "exclusive_note": row.get("Exclusive Note"), "numbering_note": row.get("Numbering Note"),
                "verification_status": row.get("Verification Status"),
            })

        for row in source_rows:
            source_name, purpose, url = row.get("Source"), row.get("Purpose") or row.get("Used For"), row.get("URL")
            source_id = stable_id("source", set_id, source_name, purpose, url)
            sources.append({"id": source_id, "set_id": set_id, "source": source_name, "purpose": purpose, "url": url, "notes": row.get("Notes")})

        static_sets.append({
            "id": set_id, "name": set_name, "shortName": short_name, "accent": accent, "year": sets[-1]["year"],
            "manufacturer": manufacturer, "releaseDate": release_date, "cardCount": len(master), "subsetCount": len(subset_rows),
            "subsets": static_subsets,
        })

    payload = {
        "schemaVersion": 2, "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "setCount": len(static_sets), "cardCount": len(static_cards), "sets": static_sets, "cards": static_cards,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sql_dir = args.sql_dir
    sql_dir.mkdir(parents=True, exist_ok=True)
    for old in sql_dir.glob("*.sql"):
        old.unlink()
    write_batches(sql_dir, "catalogue_sets", list(sets[0]), sets, ["id"])
    write_batches(sql_dir, "catalogue_subsets", list(subsets[0]), subsets, ["set_id", "subset_code"])
    write_batches(sql_dir, "catalogue_cards", list(cards[0]), cards, ["id"])
    write_batches(sql_dir, "catalogue_parallel_rules", list(rules[0]), rules, ["id"])
    write_batches(sql_dir, "catalogue_variants", list(variants[0]), variants, ["id"])
    write_batches(sql_dir, "catalogue_sources", list(sources[0]), sources, ["id"])
    print(f"Wrote {len(cards):,} cards and {len(variants):,} variants across {len(sets)} sets")
    print(f"SQL batches: {len(list(sql_dir.glob('*.sql')))} in {sql_dir}")


if __name__ == "__main__":
    main()
