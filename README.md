# RingVault

RingVault is a WWE trading card collection tracker built from verified master catalogues.

## MVP features

- Browse 1,619 card identities across four completed WWE sets
- Search by wrestler, card number, subset, code or roster
- Filter by set, category and collection status
- Mark cards as owned or wanted
- See progress by set and across the full catalogue
- Back up and restore collection data
- Installable, responsive and available offline after the first visit
- Rights-aware card and sealed-product image support with lazy loading and placeholders

Collection progress is currently stored in the browser. Account-based cloud sync, market pricing and photo recognition are planned phases.

The active backend project is **RingVault Sydney** in Supabase region `ap-southeast-2` (project reference `jvsvuxgpaqwlcstfuzbd`).

## Reference images

The app loads approved card and sealed-product images from `data/images.json`. Until an asset is approved, RingVault displays a generated placeholder. See `docs/IMAGE_LIBRARY.md` for the Supabase storage layout, rights register and bulk-manifest workflow.

## Run locally

Serve the repository with any static web server, for example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Catalogue source files

The generated app dataset currently includes:

- 2025 Topps Universe WWE
- 2025 Topps WWE x BAPE
- 2025 Topps Finest WWE
- 2025 Topps Chrome WWE Cactus Jack x WrestleMania

Run `scripts/build_catalogue.py` after placing the completed spreadsheets in the configured source folder to rebuild `data/catalogue.json`.
