import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { setupHandlers } from './handlers';

let bot: TelegramBot | null = null;

export function startTelegramBot(): TelegramBot | null {
  if (!config.telegram.token) {
    console.log('[Telegram] No token configured, skipping bot startup');
    return null;
  }

  bot = new TelegramBot(config.telegram.token, { polling: true });

  bot.on('polling_error', (err) => {
    console.error('[Telegram] Polling error:', err.message);
  });

  setupHandlers(bot);

  // Register slash commands with Telegram
  bot.setMyCommands([
    { command: 'help', description: 'List all commands' },
    { command: 'spawn', description: 'Create new agent [name] [cwd]' },
    { command: 'agents', description: 'List all agents' },
    { command: 'switch', description: 'Switch active agent <name|id>' },
    { command: 'kill', description: 'Delete agent <name|id>' },
    { command: 'reset', description: 'Clear conversation' },
    { command: 'status', description: 'Full agent details' },
    { command: 'model', description: 'View/set model (opus, sonnet, haiku)' },
    { command: 'effort', description: 'View/set effort (low, medium, high)' },
    { command: 'permission', description: 'View/set permission mode' },
    { command: 'tools', description: 'Manage allowed/denied tools' },
    { command: 'system', description: 'View/set system prompt' },
    { command: 'cwd', description: 'Change working directory' },
    { command: 'session', description: 'View/attach Claude session ID' },
    { command: 'cost', description: 'Show cost & token usage' },
    { command: 'context', description: 'Token/context usage' },
    { command: 'version', description: 'Claude CLI version' },
    { command: 'diff', description: 'git diff in agent CWD' },
    { command: 'compact', description: 'Compress conversation context' },
    { command: 'continue', description: 'Resume most recent conversation' },
    { command: 'fork', description: 'Fork session into new agent' },
    { command: 'newbot', description: 'Register new bot <name> <token>' },
    { command: 'bots', description: 'List registered bots' },
    { command: 'removebot', description: 'Remove a bot <name>' },
  ]).catch((err) => {
    console.error('[Telegram] Failed to set commands:', err.message);
  });

  console.log('[Telegram] Bot started');
  return bot;
}

export function getBot(): TelegramBot | null {
  return bot;
}
