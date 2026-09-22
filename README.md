# RingVault

RingVault is a WWE trading card collection tracker built from verified master catalogues.

## MVP features

- Browse 7,566 card identities across 16 completed WWE sets
- Search by wrestler, card number, subset, code or roster
- Filter by set, category and collection status
- Mark cards as owned or wanted
- See progress by set and across the full catalogue
- Use the app in local guest mode or sign in with email/password for cross-device cloud sync
- Create test accounts in-app, with one-time email links retained as a backup sign-in method
- Merge an existing on-device collection into a signed-in account
- Back up and restore collection data
- Installable, responsive and available offline after the first visit
- Rights-aware card and sealed-product image support with lazy loading and placeholders

Guest collection progress is stored in the browser. Signed-in collection progress is protected by Supabase Row Level Security and synchronized with RingVault Sydney.

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
- 2025 Topps Chrome WWE x Cactus Jack
- 2025 Topps Chrome WWE Cactus Jack x WrestleMania
- 2025 Topps Chrome Sapphire WWE
- 2025 Topps John Cena Commemorative Collection
- 2025 Topps Exalted WWE
- 2026 Topps Chrome WWE
- 2026 Topps Now WrestleMania Vegas
- 2026 Topps Chrome LogoFractor WWE
- 2025 Topps Royalty WWE
- 2026 Topps Chrome Sapphire WWE
- 2026 Topps Cosmic Chrome WWE
- 2026 Topps Decades WWE - '90s Edition
- 2026 Topps Universe WWE

The ten post-Universe source workbooks and their original checklist files are stored under `sources/new_sets/`. Run `scripts/extract_new_catalogues.py` to re-normalize those checklists, then rebuild the workbooks and run `scripts/build_catalogue.py` to regenerate `data/catalogue.json` and the Supabase SQL batches.

## Authentication setup

The browser uses the public Supabase publishable key in `config.js`; no server secret is shipped to the client. Before production sign-in testing, add every deployed RingVault origin to **Authentication → URL Configuration → Redirect URLs** in the RingVault Sydney Supabase dashboard. Keep localhost entries for local testing and use exact HTTPS deployment URLs in production.

Email/password accounts use Supabase `signUp` and `signInWithPassword`. Hosted projects require email confirmation by default. For closed testing only, confirmation can be temporarily disabled under **Authentication → Providers → Email**. Re-enable confirmation and configure custom SMTP before a public launch.
