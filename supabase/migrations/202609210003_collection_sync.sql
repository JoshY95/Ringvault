create table if not exists public.collection_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null references public.catalogue_cards(id) on delete restrict,
  status text not null check (status in ('owned', 'wanted')),
  quantity integer not null default 1 check (quantity between 1 and 999),
  condition text check (condition is null or char_length(condition) <= 64),
  purchase_price numeric(12, 2) check (purchase_price is null or purchase_price >= 0),
  purchase_currency text not null default 'AUD' check (purchase_currency ~ '^[A-Z]{3}$'),
  acquired_at date,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create index if not exists collection_items_card_id_idx
  on public.collection_items(card_id);

alter table public.collection_items enable row level security;

drop policy if exists "Users can read their collection" on public.collection_items;
create policy "Users can read their collection"
  on public.collection_items for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add to their collection" on public.collection_items;
create policy "Users can add to their collection"
  on public.collection_items for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their collection" on public.collection_items;
create policy "Users can update their collection"
  on public.collection_items for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove from their collection" on public.collection_items;
create policy "Users can remove from their collection"
  on public.collection_items for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.collection_items from anon, authenticated;
grant select, insert, update, delete on public.collection_items to authenticated;

comment on table public.collection_items is
  'Private per-user RingVault collection state. RLS restricts every row to its owner.';
