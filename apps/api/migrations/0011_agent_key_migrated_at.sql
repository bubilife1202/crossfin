-- v1.10.1: Track when legacy plaintext API keys are auto-migrated to SHA-256 hash
-- The key_migrated_at column is set by the agentAuth middleware when a plaintext key is used
ALTER TABLE agents ADD COLUMN key_migrated_at TEXT;
