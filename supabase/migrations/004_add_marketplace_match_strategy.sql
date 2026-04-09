-- ============================================================
-- Migration 004 — Add marketplace match strategies + email_imap source
-- Two-stage marketplace matching:
--   marketplace_order    — Step A: order (payment date) → fiscal receipt (full amount)
--   marketplace_register — Step B: email payout register → bank transaction (net amount)
-- Email IMAP connector for automated payout register processing:
--   email_imap — IMAP mailbox polling for Prom/Rozetka/Casta register emails
-- ============================================================

alter type match_strategy add value if not exists 'marketplace_order';
alter type match_strategy add value if not exists 'marketplace_register';

alter type credential_source add value if not exists 'email_imap';
