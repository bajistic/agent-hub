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

  console.log('[Telegram] Bot started');
  return bot;
}

export function getBot(): TelegramBot | null {
  return bot;
}
