-- Audit log immutability triggers
-- Protects audit_log from unauthorized UPDATE/DELETE to close the tamper window.
-- DELETE is only allowed for rows that have already been archived to audit_archive.
-- UPDATE is blocked unconditionally — audit entries are append-only.

-- Block all UPDATEs on audit_log
CREATE OR REPLACE FUNCTION audit_log_block_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows are immutable — UPDATE is not allowed (row id: %)', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_block_update();

-- Block DELETE unless the row has been archived
CREATE OR REPLACE FUNCTION audit_log_guard_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit_archive WHERE id = OLD.id) THEN
    RAISE EXCEPTION 'audit_log row % cannot be deleted — not yet archived', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_guard_delete ON audit_log;
CREATE TRIGGER trg_audit_log_guard_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_guard_delete();
