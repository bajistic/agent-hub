import TelegramBot from 'node-telegram-bot-api';
import { query } from '../db/connection';
import { getAgent, sendAgentMessage, AgentRow } from '../manager';
import { StreamChunk } from '../agents/claudeCode';
import { splitMessage } from './helpers';

interface BotRow {
  id: number;
  name: string;
  token: string;
  agent_id: string | null;
  chat_id: string | null;
  is_active: boolean;
}

// Track running sub-bots
const runningBots = new Map<string, TelegramBot>();

export async function registerBot(
  name: string,
  token: string,
  agentId?: string,
  chatId?: string,
): Promise<void> {
  await query(
    `INSERT INTO bot_instances (name, token, agent_id, chat_id, is_active)
     VALUES (?, ?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE token = ?, agent_id = ?, chat_id = ?, is_active = TRUE`,
    [name, token, agentId || null, chatId || null, token, agentId || null, chatId || null],
  );

  // Start the bot immediately
  await startBot(name);
}

export async function listBots(): Promise<BotRow[]> {
  return query('SELECT * FROM bot_instances ORDER BY created_at DESC');
}

export async function removeBot(name: string): Promise<void> {
  // Stop the bot first
  await stopBot(name);
  await query('DELETE FROM bot_instances WHERE name = ?', [name]);
}

export async function startBot(name: string): Promise<void> {
  // Stop if already running
  if (runningBots.has(name)) {
    await stopBot(name);
  }

  const rows = await query('SELECT * FROM bot_instances WHERE name = ? AND is_active = TRUE', [name]);
  const botRow: BotRow = rows[0];
  if (!botRow) {
    console.log(`[BotManager] Bot "${name}" not found or inactive`);
    return;
  }

  try {
    const bot = new TelegramBot(botRow.token, { polling: true });

    bot.on('polling_error', (err) => {
      console.error(`[BotManager] Polling error for "${name}":`, err.message);
    });

    // All messages go to the linked agent
    bot.on('message', async (msg) => {
      if (!msg.text) return;

      // Ignore commands for sub-bots (they only relay to agent)
      if (msg.text === '/start') {
        await bot.sendMessage(msg.chat.id, `Connected to Agent Hub bot: ${name}`);
        // Store chat_id if not set
        if (!botRow.chat_id) {
          await query('UPDATE bot_instances SET chat_id = ? WHERE name = ?', [msg.chat.id.toString(), name]);
          botRow.chat_id = msg.chat.id.toString();
        }
        return;
      }

      if (!botRow.agent_id) {
        await bot.sendMessage(msg.chat.id, 'No agent linked to this bot. Ask the admin to link one.');
        return;
      }

      const agent = await getAgent(botRow.agent_id);
      if (!agent) {
        await bot.sendMessage(msg.chat.id, 'Linked agent not found.');
        return;
      }

      await bot.sendChatAction(msg.chat.id, 'typing');

      const chunks: string[] = [];
      try {
        await sendAgentMessage(agent, msg.text, (chunk: StreamChunk) => {
          if (chunk.type === 'text') chunks.push(chunk.content);
        });

        const response = chunks.join('').trim();
        if (!response) return;

        const parts = splitMessage(response);
        for (const part of parts) {
          try {
            await bot.sendMessage(msg.chat.id, part, { parse_mode: 'Markdown' });
          } catch {
            await bot.sendMessage(msg.chat.id, part);
          }
        }
      } catch (err: any) {
        await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
      }
    });

    runningBots.set(name, bot);
    console.log(`[BotManager] Started bot "${name}"`);
  } catch (err: any) {
    console.error(`[BotManager] Failed to start bot "${name}":`, err.message);
  }
}

export async function stopBot(name: string): Promise<void> {
  const bot = runningBots.get(name);
  if (bot) {
    bot.stopPolling();
    runningBots.delete(name);
    console.log(`[BotManager] Stopped bot "${name}"`);
  }
}

export async function startAllBots(): Promise<void> {
  try {
    const bots: BotRow[] = await query('SELECT * FROM bot_instances WHERE is_active = TRUE');
    console.log(`[BotManager] Starting ${bots.length} registered bot(s)...`);
    for (const botRow of bots) {
      await startBot(botRow.name);
    }
  } catch (err: any) {
    console.error('[BotManager] Failed to start bots:', err.message);
  }
}
