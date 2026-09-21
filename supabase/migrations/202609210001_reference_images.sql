create table if not exists public.reference_images (
  id uuid primary key default gen_random_uuid(),
  card_uid text,
  set_id text not null,
  asset_type text not null check (asset_type in ('card_front', 'card_back', 'card_thumbnail', 'sealed_product')),
  object_path text not null unique,
  source_type text not null check (source_type in ('publisher', 'licensed_provider', 'retailer_permission', 'owned_photograph', 'community_submission')),
  source_url text,
  rights_status text not null default 'pending' check (rights_status in ('pending', 'approved', 'rejected', 'removed')),
  rights_holder text,
  permission_reference text,
  photographer_credit text,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  checksum_sha256 text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (asset_type = 'sealed_product' and card_uid is null)
    or (asset_type <> 'sealed_product' and card_uid is not null)
  )
);

create index if not exists reference_images_card_uid_idx on public.reference_images (card_uid);
create index if not exists reference_images_set_id_idx on public.reference_images (set_id);
create unique index if not exists reference_images_one_primary_idx
  on public.reference_images (coalesce(card_uid, set_id), asset_type)
  where is_primary and rights_status = 'approved';

alter table public.reference_images enable row level security;

create policy "Approved reference images are readable"
on public.reference_images
for select
to anon, authenticated
using (rights_status = 'approved');

grant select on public.reference_images to anon, authenticated;

comment on table public.reference_images is
  'Provenance and usage approval for RingVault public catalogue images. Uploads are performed only by trusted server-side tooling.';
