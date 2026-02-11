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
      model VARCHAR(50) DEFAULT 'sonnet',
      effort VARCHAR(10) DEFAULT 'high',
      permission_mode VARCHAR(50) DEFAULT 'bypassPermissions',
      allowed_tools TEXT,
      disallowed_tools TEXT,
      max_budget_usd DECIMAL(10,4),
      total_cost_usd DECIMAL(10,4) DEFAULT 0,
      total_input_tokens BIGINT DEFAULT 0,
      total_output_tokens BIGINT DEFAULT 0,
      last_duration_ms INT,
      is_active BOOLEAN DEFAULT FALSE,
      status ENUM('running','stopped') DEFAULT 'running',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_chat (chat_id)
    )
  `);

  // Add columns idempotently for existing installations
  const alterColumns = [
    "model VARCHAR(50) DEFAULT 'sonnet'",
    "effort VARCHAR(10) DEFAULT 'high'",
    "permission_mode VARCHAR(50) DEFAULT 'bypassPermissions'",
    "allowed_tools TEXT",
    "disallowed_tools TEXT",
    "max_budget_usd DECIMAL(10,4)",
    "total_cost_usd DECIMAL(10,4) DEFAULT 0",
    "total_input_tokens BIGINT DEFAULT 0",
    "total_output_tokens BIGINT DEFAULT 0",
    "last_duration_ms INT",
  ];

  for (const col of alterColumns) {
    const colName = col.split(' ')[0];
    try {
      await query(`ALTER TABLE agent_instances ADD COLUMN ${col}`);
      console.log(`[DB] Added column ${colName}`);
    } catch {
      // Column already exists, ignore
    }
  }

  await query(`
    CREATE TABLE IF NOT EXISTS bot_instances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      token VARCHAR(200) NOT NULL,
      agent_id VARCHAR(36),
      chat_id VARCHAR(64),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agent_instances(id) ON DELETE SET NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS cost_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id VARCHAR(36) NOT NULL,
      cost_usd DECIMAL(10,6),
      input_tokens BIGINT DEFAULT 0,
      output_tokens BIGINT DEFAULT 0,
      cache_read_tokens BIGINT DEFAULT 0,
      cache_write_tokens BIGINT DEFAULT 0,
      duration_ms INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agent_instances(id) ON DELETE CASCADE,
      INDEX idx_agent (agent_id)
    )
  `);

  console.log('[DB] Schema ready (agent_instances, bot_instances, cost_history)');
}
