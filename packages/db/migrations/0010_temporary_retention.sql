CREATE INDEX provider_inactive_retention ON provider_configs(id,center_id) WHERE active=0;
CREATE INDEX campaigns_provider ON campaigns(config_id);
CREATE INDEX recovery_codes_expiry ON recovery_codes(expires_at) WHERE expires_at IS NOT NULL;
