import { query } from './connection';

export async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS agent_instances (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      chat_id VARCHAR(64),
      name VARCHAR(100) NOT NULL,
      cwd VARCHAR(500) DEFAULT '/home/bajistic',
      claude_session_id VARCHAR(100),
      system_prompt TEXT,
      is_active BOOLEAN DEFAULT FALSE,
      status ENUM('running','stopped') DEFAULT 'running',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_chat (chat_id)
    )
  `);
  console.log('[DB] agent_instances table ready');
}
