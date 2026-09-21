create table if not exists public.catalogue_sets (
  id text primary key, name text not null, short_name text not null,
  year integer not null check (year between 1900 and 2100), manufacturer text not null,
  release_date date, source_file text not null, accent text,
  card_count integer not null check (card_count >= 0), subset_count integer not null check (subset_count >= 0),
  variant_count integer not null check (variant_count >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.catalogue_subsets (
  set_id text not null references public.catalogue_sets(id) on delete cascade,
  subset_code text not null, category text, name text not null,
  card_count integer check (card_count is null or card_count >= 0), parallel_group text, source_url text,
  primary key (set_id, subset_code)
);

create table if not exists public.catalogue_cards (
  id text primary key, set_id text not null references public.catalogue_sets(id) on delete cascade,
  checklist_order integer not null check (checklist_order > 0), category text, subset_code text not null,
  card_number text not null, display_name text not null, subject_1 text, subject_2 text, roster text,
  rookie boolean not null default false, parallel_group text, image_status text, pricing_status text, source_url text, notes text,
  unique (set_id, checklist_order),
  foreign key (set_id, subset_code) references public.catalogue_subsets(set_id, subset_code)
);
create index if not exists catalogue_cards_set_id_idx on public.catalogue_cards(set_id);
create index if not exists catalogue_cards_subset_idx on public.catalogue_cards(set_id, subset_code);
create index if not exists catalogue_cards_name_idx on public.catalogue_cards(display_name);

create table if not exists public.catalogue_parallel_rules (
  id text primary key, set_id text not null references public.catalogue_sets(id) on delete cascade,
  parallel_group text, applies_to text, parallel text not null,
  serial_cap integer check (serial_cap is null or serial_cap > 0), serial_exact text,
  exclusive_note text, numbering_note text, verification_status text
);
create index if not exists catalogue_parallel_rules_set_idx on public.catalogue_parallel_rules(set_id);

create table if not exists public.catalogue_variants (
  id text primary key, set_id text not null references public.catalogue_sets(id) on delete cascade,
  card_id text not null references public.catalogue_cards(id) on delete cascade,
  variant_order integer not null check (variant_order > 0), subset text, card_number text not null,
  display_name text not null, parallel text not null,
  serial_cap integer check (serial_cap is null or serial_cap > 0), serial_exact text,
  exclusive_note text, numbering_note text, verification_status text,
  unique (set_id, variant_order)
);
create index if not exists catalogue_variants_card_idx on public.catalogue_variants(card_id);
create index if not exists catalogue_variants_set_idx on public.catalogue_variants(set_id);

create table if not exists public.catalogue_sources (
  id text primary key, set_id text not null references public.catalogue_sets(id) on delete cascade,
  source text, purpose text, url text, notes text
);
create index if not exists catalogue_sources_set_idx on public.catalogue_sources(set_id);

do $$
declare table_name text;
begin
  foreach table_name in array array['catalogue_sets','catalogue_subsets','catalogue_cards','catalogue_parallel_rules','catalogue_variants','catalogue_sources']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = table_name and policyname = 'Public catalogue is readable') then
      execute format('create policy "Public catalogue is readable" on public.%I for select to anon, authenticated using (true)', table_name);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to anon, authenticated', table_name);
  end loop;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reference_images_set_id_fkey') then
    alter table public.reference_images add constraint reference_images_set_id_fkey foreign key (set_id) references public.catalogue_sets(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reference_images_card_uid_fkey') then
    alter table public.reference_images add constraint reference_images_card_uid_fkey foreign key (card_uid) references public.catalogue_cards(id);
  end if;
end
$$;

comment on table public.catalogue_sets is 'Public RingVault trading-card set registry.';
comment on table public.catalogue_cards is 'Canonical checklist card identities; variants are stored separately.';
comment on table public.catalogue_variants is 'Parallel and numbered variants generated from the authoritative workbooks.';
