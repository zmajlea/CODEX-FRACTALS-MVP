-- Spec B19 Phase A — Studies/Editions additive columns (no table renames).
-- Study = treasury_reviews; Edition = treasury_review_versions; Model = treasury_studies.
-- Note: "window" is a reserved word — always quote the identifier.

-- Study live from–to (preview + default publish window). null = default/all until resolved.
ALTER TABLE public.treasury_reviews
  ADD COLUMN IF NOT EXISTS "window" jsonb NULL;

COMMENT ON COLUMN public.treasury_reviews."window" IS
  'B19 Study live date window {from,to} YYYY-MM-DD; null = default/all';

-- Edition name + frozen window (metadata in Phase A; compute cascade in Phase B).
ALTER TABLE public.treasury_review_versions
  ADD COLUMN IF NOT EXISTS label text NULL;

ALTER TABLE public.treasury_review_versions
  ADD COLUMN IF NOT EXISTS "window" jsonb NULL;

COMMENT ON COLUMN public.treasury_review_versions.label IS
  'B19 Edition name typed at publish';

COMMENT ON COLUMN public.treasury_review_versions."window" IS
  'B19 Edition frozen from–to {from,to}; Phase A stores metadata only — compute cascade is Phase B';

-- Existing reviews are already Studies; window stays null (default).
-- Existing versions become Editions: backfill label from review title / period_month.
UPDATE public.treasury_review_versions AS v
SET label = COALESCE(
  NULLIF(BTRIM(r.title), ''),
  NULLIF(BTRIM(r.label), ''),
  to_char(r.period_month::date, 'YYYY-MM'),
  'Edition'
)
FROM public.treasury_reviews AS r
WHERE v.review_id = r.id
  AND v.label IS NULL;
