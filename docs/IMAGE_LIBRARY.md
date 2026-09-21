# RingVault image library

RingVault separates public catalogue images from private photographs uploaded by collectors.

## Public reference images

Public card and sealed-product images live in a dedicated Supabase Storage bucket named `reference-images`. The application only displays assets whose `rightsStatus` is `approved` in `data/images.json`.

Every approved asset must have:

- a matching card UID or set ID from `data/catalogue.json`
- a source type and source URL where available
- the rights holder
- a written permission or licence reference
- photographer credit where required

Do not upload marketplace, social-media or third-party catalogue images without written permission.

## Storage paths

Use predictable immutable paths:

```text
cards/<card-uid>/front.webp
cards/<card-uid>/back.webp
cards/<card-uid>/thumbnail.webp
sets/<set-id>/sealed-product.webp
```

Replacing an image should use a versioned filename so CDN caches cannot continue serving an old asset.

## Rights register

Maintain a CSV with these columns:

```text
asset_key,asset_type,set_id,card_uid,filename,rights_status,source_type,source_url,rights_holder,permission_reference,photographer_credit
```

Allowed asset types are `card_front`, `card_back`, `card_thumbnail`, and `sealed_product`. Only rows marked `approved` are published.

Generate the manifest after the files have been uploaded:

```bash
python scripts/build_image_manifest.py \
  --rights reference-images/rights.csv \
  --base-url https://PROJECT.supabase.co/storage/v1/object/public/reference-images
```

## Supabase setup

1. Create a separate RingVault Supabase project.
2. Create a public bucket named `reference-images` with JPEG, PNG and WebP MIME types only.
3. Apply `supabase/migrations/202609210001_reference_images.sql`.
4. Upload approved assets using trusted server-side tooling. Never expose a service-role or secret key in the web application.

User collection photos will use a different private bucket and ownership-based RLS policies when accounts are added.
