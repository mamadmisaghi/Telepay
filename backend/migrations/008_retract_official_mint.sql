-- This mint was created on-chain, but its project launch was withdrawn.
-- Preserve its historical record while removing it from public listings.
ALTER TABLE launches DROP CONSTRAINT IF EXISTS launches_status_check;
ALTER TABLE launches ADD CONSTRAINT launches_status_check
 CHECK (status IN ('preparing','prepared','submitted','confirmed','failed','expired','retracted'));

UPDATE launches SET status='retracted',error='Official launch withdrawn from TelePay listings'
 WHERE id='official-telepay-v1'
   AND mint='G3odGzwyaYgjzwh5yUizB5WEh8MEdW1wg4TpjGVnTeLe'
   AND source='official';

DELETE FROM official_mints
 WHERE mint='G3odGzwyaYgjzwh5yUizB5WEh8MEdW1wg4TpjGVnTeLe'
   AND launch_id='official-telepay-v1';
