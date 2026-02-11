import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'finance',
  },

  telegram: {
    token: process.env.AGENT_HUB_TELEGRAM_TOKEN || '',
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || '',
  },

  apiKey: process.env.API_KEY || '',

  defaults: {
    cwd: '/home/bajistic',
    claudePath: process.env.CLAUDE_PATH || '/home/bajistic/.local/bin/claude',
  },
};
