import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { getActiveAgent, AgentRow } from '../manager';

const TELEGRAM_MAX_LENGTH = 4096;

export function isAdmin(chatId: number): boolean {
  return chatId.toString() === config.telegram.adminChatId;
}

export async function requireActiveAgent(
  bot: TelegramBot,
  chatId: number,
): Promise<AgentRow | null> {
  const agent = await getActiveAgent(chatId.toString());
  if (!agent) {
    await bot.sendMessage(chatId, 'No active agent. Use /spawn <name> to create one.');
    return null;
  }
  return agent;
}

/**
 * Split text into Telegram-safe chunks (max 4096 chars).
 */
export function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

  const parts: string[] = [];
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_LENGTH) {
    parts.push(text.slice(i, i + TELEGRAM_MAX_LENGTH));
  }
  return parts;
}

/**
 * Send a long message, splitting if needed.
 */
export async function sendLongMessage(
  bot: TelegramBot,
  chatId: number,
  text: string,
  parseMode?: 'Markdown' | 'HTML',
): Promise<void> {
  const parts = splitMessage(text);
  for (const part of parts) {
    try {
      await bot.sendMessage(chatId, part, parseMode ? { parse_mode: parseMode } : undefined);
    } catch {
      // If markdown parse fails, send without formatting
      await bot.sendMessage(chatId, part);
    }
  }
}
