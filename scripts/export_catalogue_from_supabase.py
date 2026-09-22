"""Export the verified public Supabase catalogue for RingVault's offline bundle."""

import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config.js"
OUTPUT = ROOT / "data" / "catalogue.json"
PAGE_SIZE = 1000


def read_config():
    source = CONFIG.read_text(encoding="utf-8")
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', source)
    key = re.search(r'supabasePublishableKey:\s*"([^"]+)"', source)
    if not url or not key:
        raise ValueError("Could not read the public Supabase configuration")
    return url.group(1), key.group(1)


def fetch_all(base_url, api_key, table, columns, order):
    def fetch_page(start, include_count=False):
        query = urllib.parse.urlencode({"select": columns, "order": order})
        headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {api_key}",
            "Range": f"{start}-{start + PAGE_SIZE - 1}",
        }
        if include_count:
            headers["Prefer"] = "count=exact"
        request = urllib.request.Request(
            f"{base_url}/rest/v1/{table}?{query}",
            headers=headers,
        )
        with urllib.request.urlopen(request) as response:
            page = json.load(response)
            content_range = response.headers.get("Content-Range", "")
        total = int(content_range.rsplit("/", 1)[1]) if "/" in content_range and not content_range.endswith("/*") else None
        return page, total

    first_page, total = fetch_page(0, include_count=True)
    if total is None or total <= PAGE_SIZE:
        return first_page
    starts = range(PAGE_SIZE, total, PAGE_SIZE)
    with ThreadPoolExecutor(max_workers=8) as executor:
        remaining_pages = list(executor.map(lambda start: fetch_page(start)[0], starts))
    return first_page + [row for page in remaining_pages for row in page]


def validate(sets, subsets, cards):
    set_ids = {row["id"] for row in sets}
    if len(set_ids) != len(sets):
        raise ValueError("Duplicate set IDs in Supabase catalogue")

    subset_keys = [(row["set_id"], row["subset_code"]) for row in subsets]
    if len(set(subset_keys)) != len(subset_keys):
        raise ValueError("Duplicate (set_id, subset_code) keys in Supabase catalogue")
    subset_key_set = set(subset_keys)

    card_ids = [row["id"] for row in cards]
    if len(set(card_ids)) != len(card_ids):
        raise ValueError("Duplicate card IDs in Supabase catalogue")
    orphan_cards = [row["id"] for row in cards if (row["set_id"], row["subset_code"]) not in subset_key_set]
    if orphan_cards:
        raise ValueError(f"Cards reference missing subsets: {orphan_cards[:5]}")
    if any(row["set_id"] not in set_ids for row in subsets):
        raise ValueError("Subset references a missing set")

    cards_per_set = {}
    subsets_per_set = {}
    for row in cards:
        cards_per_set[row["set_id"]] = cards_per_set.get(row["set_id"], 0) + 1
    for row in subsets:
        subsets_per_set[row["set_id"]] = subsets_per_set.get(row["set_id"], 0) + 1
    for row in sets:
        if cards_per_set.get(row["id"], 0) != row["card_count"]:
            raise ValueError(f"Card total mismatch for {row['id']}")
        if subsets_per_set.get(row["id"], 0) != row["subset_count"]:
            raise ValueError(f"Subset total mismatch for {row['id']}")


def main():
    base_url, api_key = read_config()
    sets = fetch_all(
        base_url,
        api_key,
        "catalogue_sets",
        "id,name,short_name,year,manufacturer,release_date,accent,card_count,subset_count",
        "release_date.asc,id.asc",
    )
    subsets = fetch_all(
        base_url,
        api_key,
        "catalogue_subsets",
        "set_id,subset_code,category,name,card_count",
        "set_id.asc,subset_code.asc",
    )
    cards = fetch_all(
        base_url,
        api_key,
        "catalogue_cards",
        "id,set_id,checklist_order,card_number,display_name,subject_2,category,subset_code,roster,rookie,parallel_group",
        "set_id.asc,checklist_order.asc",
    )
    validate(sets, subsets, cards)

    subsets_by_set = {}
    subset_names = {}
    for row in subsets:
        subsets_by_set.setdefault(row["set_id"], []).append({
            "category": row["category"],
            "name": row["name"],
            "code": row["subset_code"],
            "count": row["card_count"],
        })
        subset_names[(row["set_id"], row["subset_code"])] = row["name"]

    payload = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "setCount": len(sets),
        "cardCount": len(cards),
        "sets": [
            {
                "id": row["id"],
                "name": row["name"],
                "shortName": row["short_name"],
                "accent": row["accent"],
                "year": row["year"],
                "manufacturer": row["manufacturer"],
                "releaseDate": row["release_date"],
                "cardCount": row["card_count"],
                "subsetCount": row["subset_count"],
                "subsets": subsets_by_set.get(row["id"], []),
            }
            for row in sets
        ],
        "cards": [
            {
                "id": row["id"],
                "setId": row["set_id"],
                "order": row["checklist_order"],
                "number": row["card_number"],
                "name": row["display_name"],
                "subject2": row["subject_2"],
                "category": row["category"],
                "subset": subset_names[(row["set_id"], row["subset_code"])],
                "subsetCode": row["subset_code"],
                "roster": row["roster"],
                "rookie": "Yes" if row["rookie"] else "No",
                "parallelGroup": row["parallel_group"],
            }
            for row in cards
        ],
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Exported {len(cards):,} cards across {len(sets)} sets to {OUTPUT}")


if __name__ == "__main__":
    main()
