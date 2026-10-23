PRAGMA defer_foreign_keys = ON;
CREATE TABLE student_contacts_new (center_id TEXT NOT NULL, student_id TEXT NOT NULL, contact_id TEXT NOT NULL, audience TEXT NOT NULL CHECK(audience IN ('student','guardian')), permitted INTEGER NOT NULL CHECK(permitted IN (0,1)), PRIMARY KEY(center_id,student_id,contact_id,audience), FOREIGN KEY(center_id,student_id) REFERENCES students(center_id,id), FOREIGN KEY(center_id,contact_id) REFERENCES contacts(center_id,id));
INSERT INTO student_contacts_new (center_id, student_id, contact_id, audience, permitted) SELECT center_id, student_id, contact_id, audience, permitted FROM student_contacts;
DROP TABLE student_contacts;
ALTER TABLE student_contacts_new RENAME TO student_contacts;
CREATE TRIGGER student_contact_revision_insert AFTER INSERT ON student_contacts BEGIN UPDATE centers SET revision=revision+1 WHERE id=NEW.center_id; END;
CREATE TRIGGER student_contact_revision_delete AFTER DELETE ON student_contacts BEGIN UPDATE centers SET revision=revision+1 WHERE id=OLD.center_id; END;
PRAGMA defer_foreign_keys = OFF;
