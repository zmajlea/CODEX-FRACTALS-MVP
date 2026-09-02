-- Spec B12: Monthly Treasury Review document model
-- treasury_reviews, treasury_review_versions, treasury_review_blocks
-- Board → review data migration (idempotent)

-- ---------------------------------------------------------------------------
-- A1 — treasury_reviews (periodical container)
-- ---------------------------------------------------------------------------
create table if not exists public.treasury_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  period_month date not null,
  label text not null default '',
  title text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  current_version int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, client_user_id, period_month, label)
);

create index if not exists treasury_reviews_client_idx
  on public.treasury_reviews (client_user_id, period_month desc);

create index if not exists treasury_reviews_tenant_client_idx
  on public.treasury_reviews (tenant_id, client_user_id, status);

create trigger treasury_reviews_set_updated_at
before update on public.treasury_reviews
for each row execute function public.set_updated_at();

alter table public.treasury_reviews enable row level security;

create policy treasury_reviews_operator_all
  on public.treasury_reviews
  for all
  to authenticated
  using (public.is_operator(tenant_id) or public.is_global_admin())
  with check (public.is_operator(tenant_id) or public.is_global_admin());

comment on table public.treasury_reviews is
  'Spec B12: monthly treasury review container (draft/published/archived). Clients read versions only.';

-- Published issue metadata visible to client (draft/archived containers stay operator-only).
create policy treasury_reviews_client_select
  on public.treasury_reviews
  for select
  to authenticated
  using (
    client_user_id = auth.uid()
    and status = 'published'
    and public.has_active_treasury_grant()
  );

-- ---------------------------------------------------------------------------
-- A2 — treasury_review_versions (immutable published snapshots)
-- ---------------------------------------------------------------------------
create table if not exists public.treasury_review_versions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.treasury_reviews (id) on delete cascade,
  version int not null,
  reviewed_as_of date not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  change_note text not null default '',
  snapshot jsonb not null,
  superseded_at timestamptz,
  unique (review_id, version)
);

create index if not exists treasury_review_versions_review_idx
  on public.treasury_review_versions (review_id, version desc);

create index if not exists treasury_review_versions_current_idx
  on public.treasury_review_versions (review_id)
  where superseded_at is null;

alter table public.treasury_review_versions enable row level security;

-- Operator access via tenant on parent review
create policy treasury_review_versions_operator_all
  on public.treasury_review_versions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.treasury_reviews r
      where r.id = review_id
        and (public.is_operator(r.tenant_id) or public.is_global_admin())
    )
  )
  with check (
    exists (
      select 1 from public.treasury_reviews r
      where r.id = review_id
        and (public.is_operator(r.tenant_id) or public.is_global_admin())
    )
  );

-- Client SELECT: own reviews + active grant
create policy treasury_review_versions_client_select
  on public.treasury_review_versions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.treasury_reviews r
      where r.id = review_id
        and r.client_user_id = auth.uid()
    )
    and public.has_active_treasury_grant()
  );

-- Immutability: snapshot frozen after insert; superseded_at may be set once
create or replace function public.treasury_review_versions_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.snapshot is distinct from old.snapshot
      or new.version is distinct from old.version
      or new.reviewed_as_of is distinct from old.reviewed_as_of
      or new.published_at is distinct from old.published_at
    then
      raise exception 'Published review versions are immutable';
    end if;
    if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
      raise exception 'superseded_at cannot change after being set';
    end if;
  end if;
  return new;
end;
$$;

create trigger treasury_review_versions_immutable_trg
before update on public.treasury_review_versions
for each row execute function public.treasury_review_versions_immutable();

comment on table public.treasury_review_versions is
  'Spec B12: frozen envelope-only review snapshots; client reads via session RLS.';

-- ---------------------------------------------------------------------------
-- A3 — treasury_review_blocks (draft blocks; operator-only)
-- ---------------------------------------------------------------------------
create table if not exists public.treasury_review_blocks (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.treasury_reviews (id) on delete cascade,
  position int not null,
  role text not null,
  metric_id uuid references public.treasury_metrics (id) on delete set null,
  recommendation_id uuid references public.treasury_recommendations (id) on delete cascade,
  pinned_window jsonb,
  placed_snapshot jsonb,
  caption text not null default '',
  body text not null default '',
  proposal_state text not null default 'none'
    check (proposal_state in ('none', 'proposed', 'confirmed')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treasury_review_blocks_role_check check (
    (role in ('figure', 'exhibit') and metric_id is not null and recommendation_id is null)
    or (role = 'note' and metric_id is null and recommendation_id is null)
    or (role = 'narrative' and recommendation_id is not null and metric_id is null)
  )
);

create index if not exists treasury_review_blocks_review_pos_idx
  on public.treasury_review_blocks (review_id, position);

create trigger treasury_review_blocks_set_updated_at
before update on public.treasury_review_blocks
for each row execute function public.set_updated_at();

alter table public.treasury_review_blocks enable row level security;

create policy treasury_review_blocks_operator_all
  on public.treasury_review_blocks
  for all
  to authenticated
  using (
    exists (
      select 1 from public.treasury_reviews r
      where r.id = review_id
        and (public.is_operator(r.tenant_id) or public.is_global_admin())
    )
  )
  with check (
    exists (
      select 1 from public.treasury_reviews r
      where r.id = review_id
        and (public.is_operator(r.tenant_id) or public.is_global_admin())
    )
  );

comment on table public.treasury_review_blocks is
  'Spec B12: draft review blocks (figure/exhibit/note/narrative); never client-visible until publish.';

-- ---------------------------------------------------------------------------
-- Part F — board → review data migration (idempotent)
-- ---------------------------------------------------------------------------
do $$
declare
  b record;
  rid uuid;
  pos int;
  item jsonb;
  mid uuid;
  cap text;
  snap jsonb;
  blocks jsonb := '[]'::jsonb;
  pm date;
begin
  for b in
    select *
    from public.treasury_analytics
    where not exists (
      select 1 from public.treasury_reviews r
      where r.tenant_id = treasury_analytics.tenant_id
        and r.client_user_id = treasury_analytics.client_user_id
        and r.label = ('migrated:' || treasury_analytics.id::text)
    )
  loop
    pm := date_trunc('month', coalesce(b.shared_at, b.created_at))::date;

    insert into public.treasury_reviews (
      tenant_id, client_user_id, period_month, label, title, status,
      current_version, created_by
    ) values (
      b.tenant_id,
      b.client_user_id,
      pm,
      'migrated:' || b.id::text,
      coalesce(nullif(b.title, ''), 'Treasury Review'),
      case b.status
        when 'shared' then 'published'
        when 'archived' then 'archived'
        else 'draft'
      end,
      case when b.status = 'shared' then 1 else 0 end,
      b.created_by
    )
    returning id into rid;

    pos := 0;
    blocks := '[]'::jsonb;

    if jsonb_typeof(b.items) = 'array' then
      for item in select * from jsonb_array_elements(b.items)
      loop
        mid := nullif(item->>'metric_id', '')::uuid;
        cap := coalesce(item->>'note', '');
        if mid is not null then
          pos := pos + 1;
          insert into public.treasury_review_blocks (
            review_id, position, role, metric_id, caption
          ) values (
            rid, pos, 'exhibit', mid, cap
          );
          blocks := blocks || jsonb_build_object(
            'role', 'exhibit',
            'metric_id', mid,
            'caption', cap,
            'name', 'Metric',
            'computed', null
          );
        end if;
      end loop;
    end if;

    if b.status = 'shared' then
      snap := jsonb_build_object(
        'meta', jsonb_build_object(
          'title', coalesce(nullif(b.title, ''), 'Treasury Review'),
          'period_month', pm,
          'reviewed_as_of', coalesce(b.shared_at, b.updated_at)::date,
          'version', 1,
          'change_note', 'Migrated from shared analytics board.'
        ),
        'cover_figures', '[]'::jsonb,
        'live_strip', jsonb_build_object('enabled', false),
        'blocks', blocks,
        'disclosures', jsonb_build_object(
          'advisory', 'Advisory only. This dashboard summarizes curated metrics from your book; it is not investment, tax, or legal advice.',
          'accuracy', 'Figures reflect your ledger as of the last import / sync shown below.',
          'review', 'Reviewed and shared by your Summit operator.'
        )
      );

      insert into public.treasury_review_versions (
        review_id, version, reviewed_as_of, published_at, published_by,
        change_note, snapshot
      ) values (
        rid, 1,
        coalesce(b.shared_at, b.updated_at)::date,
        coalesce(b.shared_at, now()),
        b.shared_by,
        'Migrated from shared analytics board.',
        snap
      );
    end if;
  end loop;
end $$;
