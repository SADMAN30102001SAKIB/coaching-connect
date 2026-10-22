import { now, one, statement } from './db';

export async function cleanup(db: D1Database): Promise<void> {
  const timestamp = now();
  await db.batch([
    statement(
      db,
      'DELETE FROM audit WHERE id IN (SELECT id FROM audit WHERE created_at<? ORDER BY created_at LIMIT 1000)',
      timestamp - 7 * 86400000,
    ),
    statement(
      db,
      'DELETE FROM sessions WHERE token IN (SELECT token FROM sessions WHERE expires_at<? LIMIT 100)',
      timestamp,
    ),
    statement(
      db,
      'DELETE FROM throttle WHERE key IN (SELECT key FROM throttle WHERE expires_at<? LIMIT 100)',
      timestamp,
    ),
    statement(
      db,
      'DELETE FROM invitations WHERE hash IN (SELECT hash FROM invitations WHERE expires_at<? LIMIT 100)',
      timestamp,
    ),
    statement(
      db,
      'DELETE FROM recovery_codes WHERE hash IN (SELECT hash FROM recovery_codes WHERE expires_at IS NOT NULL AND expires_at<=? LIMIT 100)',
      timestamp,
    ),
    statement(
      db,
      'DELETE FROM auth_claims WHERE hash IN (SELECT a.hash FROM auth_claims a WHERE NOT EXISTS(SELECT 1 FROM invitations i WHERE i.hash=a.hash AND i.expires_at>?) AND NOT EXISTS(SELECT 1 FROM recovery_codes r WHERE r.hash=a.hash AND (r.expires_at IS NULL OR r.expires_at>?)) LIMIT 100)',
      timestamp,
      timestamp,
    ),
    statement(
      db,
      'DELETE FROM balances WHERE rowid IN (SELECT b.rowid FROM balances b JOIN provider_configs p ON p.id=b.config_id AND p.center_id=b.center_id WHERE p.active=0 AND b.refreshing_until<? LIMIT 100)',
      timestamp,
    ),
    statement(
      db,
      'DELETE FROM provider_configs WHERE id IN (SELECT p.id FROM provider_configs p INDEXED BY provider_inactive_retention WHERE p.active=0 AND NOT EXISTS(SELECT 1 FROM campaigns c WHERE c.config_id=p.id) AND NOT EXISTS(SELECT 1 FROM balances b WHERE b.center_id=p.center_id AND b.config_id=p.id) LIMIT 100)',
    ),
    statement(
      db,
      `UPDATE campaigns SET state='purging' WHERE id=(SELECT c.id FROM campaigns c INDEXED BY campaigns_retention WHERE c.state IN ('completed','cancelled') AND c.finished_at<? AND NOT EXISTS(SELECT 1 FROM messages m INDEXED BY messages_retention_blockers WHERE m.center_id=c.center_id AND m.campaign_id=c.id AND m.state NOT IN ('delivered','failed','skipped','cancelled')) AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.center_id=c.center_id AND j.campaign_id=c.id) AND NOT EXISTS(SELECT 1 FROM campaigns dependent WHERE dependent.source_campaign_id=c.id) ORDER BY c.finished_at,c.id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM campaigns WHERE state='purging')`,
      timestamp - 30 * 86400000,
    ),
  ]);
  const campaign = await one<{ id: string; center_id: string }>(
    db,
    "SELECT id,center_id FROM campaigns WHERE state='purging' ORDER BY id LIMIT 1",
  );
  if (!campaign) return;
  await db.batch([
    statement(
      db,
      'DELETE FROM attempts WHERE id IN (SELECT id FROM attempts WHERE center_id=? AND campaign_id=? ORDER BY id LIMIT 1000)',
      campaign.center_id,
      campaign.id,
    ),
    statement(
      db,
      'DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE center_id=? AND campaign_id=? LIMIT 1000)',
      campaign.center_id,
      campaign.id,
    ),
    statement(
      db,
      'DELETE FROM campaign_exclusions WHERE rowid IN (SELECT rowid FROM campaign_exclusions WHERE center_id=? AND campaign_id=? LIMIT 1000)',
      campaign.center_id,
      campaign.id,
    ),
    statement(db, 'DELETE FROM campaign_transitions WHERE campaign_id=?', campaign.id),
    statement(
      db,
      `DELETE FROM campaigns WHERE id=? AND state='purging' AND NOT EXISTS(SELECT 1 FROM messages WHERE center_id=? AND campaign_id=?) AND NOT EXISTS(SELECT 1 FROM attempts WHERE center_id=? AND campaign_id=?) AND NOT EXISTS(SELECT 1 FROM campaign_exclusions WHERE center_id=? AND campaign_id=?)`,
      campaign.id,
      campaign.center_id,
      campaign.id,
      campaign.center_id,
      campaign.id,
      campaign.center_id,
      campaign.id,
    ),
  ]);
}
