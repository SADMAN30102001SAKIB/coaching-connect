ALTER TABLE messages ADD COLUMN student_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN source_signature TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN center_name TEXT NOT NULL DEFAULT '';
UPDATE campaigns SET center_name=(SELECT name FROM centers WHERE id=campaigns.center_id);
CREATE INDEX messages_student ON messages(center_id,student_id,state,campaign_id);
