-- ============================================================
-- Migration 003 — Add new credential_source values
-- New sources discovered in Stage 0:
--   cashalot   — Cashälot ПРРО (Смирнова)
--   poster     — Poster ПРРО (Голубов)
--   casta      — Casta маркетплейс (TBD)
--   dps_cabinet — ДПС Електронний кабінет (Куденко)
-- ============================================================

alter type credential_source add value if not exists 'cashalot';
alter type credential_source add value if not exists 'poster';
alter type credential_source add value if not exists 'casta';
alter type credential_source add value if not exists 'dps_cabinet';
