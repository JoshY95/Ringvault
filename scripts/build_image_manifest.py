#!/usr/bin/env python3
"""Build RingVault's public image manifest from an approved rights register."""

import argparse
import csv
import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote


ALLOWED_TYPES = {"card_front", "card_back", "card_thumbnail", "sealed_product"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
REQUIRED_COLUMNS = {
    "asset_key", "asset_type", "set_id", "card_uid", "filename",
    "rights_status", "source_type", "source_url", "rights_holder",
    "permission_reference", "photographer_credit",
}


def args_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalogue", type=Path, default=Path("data/catalogue.json"))
    parser.add_argument("--rights", type=Path, required=True, help="CSV rights register")
    parser.add_argument("--base-url", required=True, help="Public bucket URL ending before the filename")
    parser.add_argument("--output", type=Path, default=Path("data/images.json"))
    return parser.parse_args()


def public_url(base_url, filename):
    return f"{base_url.rstrip('/')}/{quote(filename.lstrip('/'), safe='/')}"


def main():
    args = args_parser()
    catalogue = json.loads(args.catalogue.read_text(encoding="utf-8"))
    card_ids = {card["id"] for card in catalogue["cards"]}
    set_ids = {item["id"] for item in catalogue["sets"]}
    manifest = {"schemaVersion": 1, "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "cards": {}, "sets": {}}
    errors = []

    with args.rights.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        missing_columns = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing_columns:
            raise SystemExit(f"Rights CSV is missing columns: {', '.join(sorted(missing_columns))}")

        for row_number, raw in enumerate(reader, 2):
            row = {key: (value or "").strip() for key, value in raw.items()}
            if row["rights_status"] != "approved":
                continue
            if row["asset_type"] not in ALLOWED_TYPES:
                errors.append(f"row {row_number}: unsupported asset_type {row['asset_type']!r}")
                continue
            if Path(row["filename"]).suffix.lower() not in ALLOWED_EXTENSIONS:
                errors.append(f"row {row_number}: unsupported image filename {row['filename']!r}")
                continue
            if row["set_id"] not in set_ids:
                errors.append(f"row {row_number}: unknown set_id {row['set_id']!r}")
                continue
            if not row["rights_holder"] or not row["permission_reference"]:
                errors.append(f"row {row_number}: approved assets require rights_holder and permission_reference")
                continue

            entry = {
                "rightsStatus": "approved",
                "sourceType": row["source_type"],
                "sourceUrl": row["source_url"] or None,
                "rightsHolder": row["rights_holder"],
                "permissionReference": row["permission_reference"],
                "photographerCredit": row["photographer_credit"] or None,
            }
            url = public_url(args.base_url, row["filename"])

            if row["asset_type"] == "sealed_product":
                entry["image"] = url
                manifest["sets"][row["set_id"]] = entry
                continue

            if row["card_uid"] not in card_ids:
                errors.append(f"row {row_number}: unknown card_uid {row['card_uid']!r}")
                continue
            card_entry = manifest["cards"].setdefault(row["card_uid"], entry)
            field = {"card_front": "front", "card_back": "back", "card_thumbnail": "thumbnail"}[row["asset_type"]]
            card_entry[field] = url

    if errors:
        raise SystemExit("Image manifest not written:\n- " + "\n- ".join(errors))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(manifest['cards'])} card entries and {len(manifest['sets'])} set entries to {args.output}")


if __name__ == "__main__":
    main()
