CREATE TABLE exam_groups (center_id TEXT NOT NULL, exam_id TEXT NOT NULL, group_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(center_id,exam_id,group_id), FOREIGN KEY(center_id,exam_id) REFERENCES exams(center_id,id) ON DELETE CASCADE);
CREATE TABLE exam_group_members (center_id TEXT NOT NULL, exam_id TEXT NOT NULL, group_id TEXT NOT NULL, student_id TEXT NOT NULL, PRIMARY KEY(center_id,exam_id,group_id,student_id), FOREIGN KEY(center_id,exam_id,group_id) REFERENCES exam_groups(center_id,exam_id,group_id) ON DELETE CASCADE, FOREIGN KEY(center_id,exam_id,student_id) REFERENCES participants(center_id,exam_id,student_id) ON DELETE CASCADE);
CREATE INDEX exam_group_members_student ON exam_group_members(center_id,exam_id,student_id);

INSERT INTO exam_groups SELECT DISTINCT p.center_id,p.exam_id,g.id,g.name FROM participants p JOIN group_members gm ON gm.center_id=p.center_id AND gm.student_id=p.student_id AND gm.left_at IS NULL JOIN catalog g ON g.center_id=gm.center_id AND g.id=gm.group_id AND g.kind='group';
INSERT INTO exam_group_members SELECT p.center_id,p.exam_id,gm.group_id,p.student_id FROM participants p JOIN group_members gm ON gm.center_id=p.center_id AND gm.student_id=p.student_id AND gm.left_at IS NULL JOIN exam_groups eg ON eg.center_id=p.center_id AND eg.exam_id=p.exam_id AND eg.group_id=gm.group_id;

INSERT INTO exam_groups SELECT DISTINCT p.center_id,p.exam_id,'','' FROM participants p WHERE NOT EXISTS(SELECT 1 FROM exam_group_members m WHERE m.center_id=p.center_id AND m.exam_id=p.exam_id AND m.student_id=p.student_id);
INSERT INTO exam_group_members SELECT p.center_id,p.exam_id,'',p.student_id FROM participants p WHERE NOT EXISTS(SELECT 1 FROM exam_group_members m WHERE m.center_id=p.center_id AND m.exam_id=p.exam_id AND m.student_id=p.student_id);

CREATE TRIGGER exam_participant_marks_guard BEFORE DELETE ON participants WHEN EXISTS(SELECT 1 FROM results r JOIN papers p ON p.center_id=r.center_id AND p.id=r.paper_id WHERE r.center_id=OLD.center_id AND p.exam_id=OLD.exam_id AND r.student_id=OLD.student_id AND r.status='scored') BEGIN SELECT RAISE(ABORT,'EXAM_GROUP_HAS_MARKS'); END;
CREATE TRIGGER exam_group_member_revision_insert AFTER INSERT ON exam_group_members BEGIN UPDATE centers SET revision=revision+1 WHERE id=NEW.center_id; END;
CREATE TRIGGER exam_group_member_revision_delete AFTER DELETE ON exam_group_members BEGIN UPDATE centers SET revision=revision+1 WHERE id=OLD.center_id; END;
