import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import {
  createAgent,
  listAgents,
  getActiveAgent,
  setActiveAgent,
  deleteAgent,
  resetAgent,
  updateAgentCwd,
  sendAgentMessage,
  getAgent,
  AgentRow,
} from '../manager';
import { StreamChunk } from '../agents/claudeCode';

function isAdmin(chatId: number): boolean {
  return chatId.toString() === config.telegram.adminChatId;
}

export function setupHandlers(bot: TelegramBot) {
  // /spawn [name] [cwd]
  bot.onText(/\/spawn(?:\s+(\S+))?(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const name = match?.[1] || `agent-${Date.now()}`;
    const cwd = match?.[2] || config.defaults.cwd;
    const chatId = msg.chat.id.toString();

    try {
      const agent = await createAgent(chatId, name, cwd, chatId);
      await bot.sendMessage(msg.chat.id,
        `✅ Agent spawned: *${agent.name}*\nID: \`${agent.id}\`\nCWD: \`${agent.cwd}\`\nSet as active agent.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /agents
  bot.onText(/\/agents/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agents = await listAgents(msg.chat.id.toString());
      if (agents.length === 0) {
        await bot.sendMessage(msg.chat.id, 'No agents. Use /spawn <name> to create one.');
        return;
      }

      const lines = agents.map((a: AgentRow) =>
        `${a.is_active ? '→ ' : '  '}*${a.name}* \`${a.id.slice(0, 8)}\`\n   CWD: \`${a.cwd}\`${a.claude_session_id ? ' (has session)' : ''}`,
      );
      await bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /switch <name|id>
  bot.onText(/\/switch\s+(.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const target = match?.[1]?.trim();
    if (!target) return;

    try {
      const agents = await listAgents(msg.chat.id.toString());
      const agent = agents.find((a: AgentRow) =>
        a.name === target || a.id === target || a.id.startsWith(target),
      );

      if (!agent) {
        await bot.sendMessage(msg.chat.id, `Agent "${target}" not found.`);
        return;
      }

      await setActiveAgent(msg.chat.id.toString(), agent.id);
      await bot.sendMessage(msg.chat.id,
        `Switched to *${agent.name}*`,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /kill <name|id>
  bot.onText(/\/kill\s+(.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const target = match?.[1]?.trim();
    if (!target) return;

    try {
      const agents = await listAgents(msg.chat.id.toString());
      const agent = agents.find((a: AgentRow) =>
        a.name === target || a.id === target || a.id.startsWith(target),
      );

      if (!agent) {
        await bot.sendMessage(msg.chat.id, `Agent "${target}" not found.`);
        return;
      }

      await deleteAgent(agent.id);
      await bot.sendMessage(msg.chat.id, `Agent *${agent.name}* killed.`, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /reset
  bot.onText(/\/reset/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await getActiveAgent(msg.chat.id.toString());
      if (!agent) {
        await bot.sendMessage(msg.chat.id, 'No active agent. Use /spawn to create one.');
        return;
      }

      await resetAgent(agent.id);
      await bot.sendMessage(msg.chat.id,
        `Conversation reset for *${agent.name}*`,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /cwd <path>
  bot.onText(/\/cwd\s+(.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const newCwd = match?.[1]?.trim();
    if (!newCwd) return;

    try {
      const agent = await getActiveAgent(msg.chat.id.toString());
      if (!agent) {
        await bot.sendMessage(msg.chat.id, 'No active agent.');
        return;
      }

      await updateAgentCwd(agent.id, newCwd);
      await bot.sendMessage(msg.chat.id,
        `CWD for *${agent.name}* → \`${newCwd}\``,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // Plain messages → active agent
  bot.on('message', async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    const agent = await getActiveAgent(msg.chat.id.toString());
    if (!agent) {
      await bot.sendMessage(msg.chat.id, 'No active agent. Use /spawn <name> to create one.');
      return;
    }

    // Send "typing" indicator
    await bot.sendChatAction(msg.chat.id, 'typing');

    const chunks: string[] = [];
    let lastUpdate = 0;
    let sentMessageId: number | null = null;

    try {
      await sendAgentMessage(agent, msg.text, async (chunk: StreamChunk) => {
        if (chunk.type === 'text') {
          chunks.push(chunk.content);
        } else if (chunk.type === 'tool_use') {
          chunks.push(`\n_${chunk.content}_\n`);
        }

        // Periodically update the message (every 3 seconds)
        const now = Date.now();
        if (now - lastUpdate > 3000 && chunks.length > 0) {
          lastUpdate = now;
          const text = chunks.join('').slice(-4000); // Telegram limit
          try {
            if (sentMessageId) {
              await bot.editMessageText(text || '...', {
                chat_id: msg.chat.id,
                message_id: sentMessageId,
                parse_mode: 'Markdown',
              });
            } else {
              const sent = await bot.sendMessage(msg.chat.id, text || '...', { parse_mode: 'Markdown' });
              sentMessageId = sent.message_id;
            }
          } catch {
            // Edit may fail if content unchanged, ignore
          }
          await bot.sendChatAction(msg.chat.id, 'typing');
        }
      });

      // Send final response
      const finalText = chunks.join('').trim();
      if (!finalText) return;

      // Split into chunks of 4096 chars (Telegram limit)
      const maxLen = 4096;
      const parts = [];
      for (let i = 0; i < finalText.length; i += maxLen) {
        parts.push(finalText.slice(i, i + maxLen));
      }

      if (sentMessageId) {
        try {
          await bot.editMessageText(parts[0], {
            chat_id: msg.chat.id,
            message_id: sentMessageId,
            parse_mode: 'Markdown',
          });
        } catch {
          // If edit fails (e.g. content identical), just send new
          await bot.sendMessage(msg.chat.id, parts[0], { parse_mode: 'Markdown' });
        }
        for (let i = 1; i < parts.length; i++) {
          await bot.sendMessage(msg.chat.id, parts[i], { parse_mode: 'Markdown' });
        }
      } else {
        for (const part of parts) {
          await bot.sendMessage(msg.chat.id, part, { parse_mode: 'Markdown' });
        }
      }
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });
}
