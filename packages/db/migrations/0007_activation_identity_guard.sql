ALTER TABLE auth_claims ADD COLUMN new_identity INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER activation_identity_guard BEFORE INSERT ON auth_claims WHEN NEW.new_identity=1 AND EXISTS(SELECT 1 FROM invitations i JOIN users u ON u.id=i.user_id WHERE i.hash=NEW.hash AND u.password IS NOT NULL) BEGIN SELECT RAISE(ABORT,'IDENTITY_ALREADY_ACTIVATED'); END;
