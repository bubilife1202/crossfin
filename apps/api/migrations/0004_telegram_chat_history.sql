-- Telegram chat history for multi-turn conversation support
CREATE TABLE IF NOT EXISTS telegram_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,        -- 'user' | 'assistant' | 'tool'
  content TEXT,
  tool_calls TEXT,           -- JSON stringified tool_calls from assistant
  tool_call_id TEXT,         -- for tool role messages
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat_id ON telegram_messages(chat_id, created_at DESC);
