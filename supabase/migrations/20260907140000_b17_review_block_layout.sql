-- Spec B17 M1 — presentation layout on review blocks (12-col canvas).
-- { w: 1–12, h: 1–3 }; null = full-width legacy. Never affects compute.

alter table public.treasury_review_blocks
  add column if not exists layout jsonb null;

comment on column public.treasury_review_blocks.layout is
  'B17 presentation only: {w:1-12,h:1-3}. null = full-width legacy. No compute effect.';
