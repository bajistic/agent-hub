import TelegramBot from 'node-telegram-bot-api';
import { execFile } from 'child_process';
import { config } from '../config';
import {
  createAgent,
  listAgents,
  getActiveAgent,
  setActiveAgent,
  deleteAgent,
  resetAgent,
  updateAgentCwd,
  updateAgentModel,
  updateAgentEffort,
  updateAgentPermissionMode,
  updateAgentTools,
  updateAgentSystemPrompt,
  updateAgentBudget,
  sendAgentMessage,
  getAgent,
  getAgentCost,
  forkAgent,
  AgentRow,
} from '../manager';
import { StreamChunk, getVersion } from '../agents/claudeCode';
import { isAdmin, requireActiveAgent, splitMessage, sendLongMessage } from './helpers';
import { registerBot, listBots, removeBot } from './botManager';

export function setupHandlers(bot: TelegramBot) {
  // /help
  bot.onText(/\/help/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    const help = `*Agent Hub Commands*

*Agent Management*
/spawn \\[name] \\[cwd] — Create new agent
/agents — List all agents
/switch <name|id> — Switch active agent
/kill <name|id> — Delete agent
/reset — Clear conversation
/cwd <path> — Change working directory
/status — Full agent details
/fork — Fork session into new agent

*Model & Settings*
/model \\[model] — View/set model (opus, sonnet, haiku)
/effort \\[level] — View/set effort (low, medium, high)
/permission \\[mode] — View/set permission mode
/tools \\[allow|deny|clear] \\[list] — Manage tools
/system \\[prompt] — View/set system prompt

*Session*
/continue — Resume most recent conversation
/compact — Compress conversation context
/cost — Show cost & token usage

*Utilities*
/version — Claude CLI version
/diff — git diff in agent CWD

*Multi-Bot*
/newbot <name> <token> \\[agent] — Register new bot
/bots — List registered bots
/removebot <name> — Remove a bot`;

    await sendLongMessage(bot, msg.chat.id, help, 'Markdown');
  });

  // /spawn [name] [cwd]
  bot.onText(/\/spawn(?:\s+(\S+))?(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const name = match?.[1] || `agent-${Date.now()}`;
    const cwd = match?.[2] || config.defaults.cwd;
    const chatId = msg.chat.id.toString();

    try {
      const agent = await createAgent(chatId, name, cwd, chatId);
      await bot.sendMessage(msg.chat.id,
        `Agent spawned: *${agent.name}*\nID: \`${agent.id}\`\nCWD: \`${agent.cwd}\`\nSet as active agent.`,
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
        `${a.is_active ? '→ ' : '  '}*${a.name}* \`${a.id.slice(0, 8)}\` (${a.model})\n   CWD: \`${a.cwd}\`${a.claude_session_id ? ' (session)' : ''}`,
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
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

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
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      await updateAgentCwd(agent.id, newCwd);
      await bot.sendMessage(msg.chat.id,
        `CWD for *${agent.name}* → \`${newCwd}\``,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /model [model]
  bot.onText(/\/model(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const model = match?.[1]?.trim();
      if (!model) {
        await bot.sendMessage(msg.chat.id, `Model for *${agent.name}*: \`${agent.model}\``, { parse_mode: 'Markdown' });
        return;
      }

      const valid = ['opus', 'sonnet', 'haiku'];
      if (!valid.includes(model)) {
        await bot.sendMessage(msg.chat.id, `Invalid model. Choose: ${valid.join(', ')}`);
        return;
      }

      await updateAgentModel(agent.id, model);
      await bot.sendMessage(msg.chat.id, `Model set to \`${model}\` for *${agent.name}*`, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /effort [level]
  bot.onText(/\/effort(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const effort = match?.[1]?.trim();
      if (!effort) {
        await bot.sendMessage(msg.chat.id, `Effort for *${agent.name}*: \`${agent.effort}\``, { parse_mode: 'Markdown' });
        return;
      }

      const valid = ['low', 'medium', 'high'];
      if (!valid.includes(effort)) {
        await bot.sendMessage(msg.chat.id, `Invalid effort. Choose: ${valid.join(', ')}`);
        return;
      }

      await updateAgentEffort(agent.id, effort);
      await bot.sendMessage(msg.chat.id, `Effort set to \`${effort}\` for *${agent.name}*`, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /permission [mode]
  bot.onText(/\/permission(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const mode = match?.[1]?.trim();
      if (!mode) {
        await bot.sendMessage(msg.chat.id,
          `Permission mode for *${agent.name}*: \`${agent.permission_mode}\`\nOptions: bypassPermissions, acceptEdits, default`,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const valid = ['bypassPermissions', 'acceptEdits', 'default'];
      if (!valid.includes(mode)) {
        await bot.sendMessage(msg.chat.id, `Invalid mode. Choose: ${valid.join(', ')}`);
        return;
      }

      await updateAgentPermissionMode(agent.id, mode);
      await bot.sendMessage(msg.chat.id, `Permission mode set to \`${mode}\``, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /tools [allow|deny|clear] [list]
  bot.onText(/\/tools(?:\s+(allow|deny|clear))?(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const action = match?.[1];
      const toolList = match?.[2]?.trim();

      if (!action) {
        const allowed = agent.allowed_tools || 'none';
        const denied = agent.disallowed_tools || 'none';
        await bot.sendMessage(msg.chat.id,
          `*Tools for ${agent.name}*\nAllowed: \`${allowed}\`\nDenied: \`${denied}\``,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      if (action === 'clear') {
        await updateAgentTools(agent.id, null, null);
        await bot.sendMessage(msg.chat.id, 'Tool filters cleared.');
        return;
      }

      if (!toolList) {
        await bot.sendMessage(msg.chat.id, `Usage: /tools ${action} Tool1,Tool2,...`);
        return;
      }

      if (action === 'allow') {
        await updateAgentTools(agent.id, toolList, agent.disallowed_tools);
      } else {
        await updateAgentTools(agent.id, agent.allowed_tools, toolList);
      }

      await bot.sendMessage(msg.chat.id, `Tools updated: ${action} → \`${toolList}\``, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /system [prompt]
  bot.onText(/\/system(?:\s+([\s\S]+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const prompt = match?.[1]?.trim();
      if (!prompt) {
        const current = agent.system_prompt || '(none)';
        await bot.sendMessage(msg.chat.id,
          `*System prompt for ${agent.name}:*\n${current}`,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      if (prompt === 'clear') {
        await updateAgentSystemPrompt(agent.id, null);
        await bot.sendMessage(msg.chat.id, 'System prompt cleared.');
        return;
      }

      await updateAgentSystemPrompt(agent.id, prompt);
      await bot.sendMessage(msg.chat.id, 'System prompt updated.');
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /cost
  bot.onText(/\/cost/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const cost = await getAgentCost(agent.id);
      const text = `*Cost for ${agent.name}*
Total: $${cost.total_cost_usd.toFixed(4)}
Requests: ${cost.request_count}
Input tokens: ${cost.total_input_tokens.toLocaleString()}
Output tokens: ${cost.total_output_tokens.toLocaleString()}`;

      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /status
  bot.onText(/\/status/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const cost = await getAgentCost(agent.id);
      const text = `*${agent.name}* \`${agent.id.slice(0, 8)}\`
Model: \`${agent.model}\`
Effort: \`${agent.effort}\`
Permission: \`${agent.permission_mode}\`
CWD: \`${agent.cwd}\`
Session: \`${agent.claude_session_id ? agent.claude_session_id.slice(0, 12) + '...' : 'none'}\`
System prompt: ${agent.system_prompt ? 'set' : 'none'}
Allowed tools: \`${agent.allowed_tools || 'all'}\`
Disallowed tools: \`${agent.disallowed_tools || 'none'}\`
Budget: ${agent.max_budget_usd ? '$' + Number(agent.max_budget_usd).toFixed(2) : 'unlimited'}
Total cost: $${cost.total_cost_usd.toFixed(4)}
Requests: ${cost.request_count}
Last duration: ${agent.last_duration_ms ? (agent.last_duration_ms / 1000).toFixed(1) + 's' : 'n/a'}`;

      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /context — show token/context usage
  bot.onText(/\/context/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const cost = await getAgentCost(agent.id);
      const text = `*Context for ${agent.name}*
Session: \`${agent.claude_session_id ? 'active' : 'none'}\`
Total input tokens: ${cost.total_input_tokens.toLocaleString()}
Total output tokens: ${cost.total_output_tokens.toLocaleString()}
Total tokens: ${(cost.total_input_tokens + cost.total_output_tokens).toLocaleString()}`;

      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /version
  bot.onText(/\/version/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const version = await getVersion();
      await bot.sendMessage(msg.chat.id, `Claude CLI: \`${version}\``, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /diff — git diff --stat in agent CWD
  bot.onText(/\/diff/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const result = await new Promise<string>((resolve) => {
        execFile('git', ['diff', '--stat'], { cwd: agent.cwd }, (err, stdout, stderr) => {
          if (err) {
            resolve(stderr || err.message);
          } else {
            resolve(stdout.trim() || 'No changes.');
          }
        });
      });

      await sendLongMessage(bot, msg.chat.id, `\`\`\`\n${result}\n\`\`\``, 'Markdown');
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /compact — compress conversation context
  bot.onText(/\/compact/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      if (!agent.claude_session_id) {
        await bot.sendMessage(msg.chat.id, 'No active session to compact.');
        return;
      }

      await bot.sendChatAction(msg.chat.id, 'typing');

      // Send /compact as a message to the agent
      const chunks: string[] = [];
      await sendAgentMessage(agent, '/compact', (chunk: StreamChunk) => {
        if (chunk.type === 'text') chunks.push(chunk.content);
      });

      const response = chunks.join('').trim() || 'Context compacted.';
      await sendLongMessage(bot, msg.chat.id, response);
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /continue — resume most recent conversation
  bot.onText(/\/continue(?:\s+([\s\S]+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      if (!agent.claude_session_id) {
        await bot.sendMessage(msg.chat.id, 'No session to continue.');
        return;
      }

      await bot.sendChatAction(msg.chat.id, 'typing');
      const extraMessage = match?.[1]?.trim() || '';

      const chunks: string[] = [];
      await sendAgentMessage(agent, extraMessage, (chunk: StreamChunk) => {
        if (chunk.type === 'text') chunks.push(chunk.content);
      }, { continueSession: true });

      const response = chunks.join('').trim();
      if (response) {
        await sendLongMessage(bot, msg.chat.id, response, 'Markdown');
      } else {
        await bot.sendMessage(msg.chat.id, 'Session continued (no new output).');
      }
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /fork — fork session into new agent
  bot.onText(/\/fork/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const agent = await requireActiveAgent(bot, msg.chat.id);
      if (!agent) return;

      const chatId = msg.chat.id.toString();
      const forked = await forkAgent(agent.id, chatId, chatId);

      await bot.sendMessage(msg.chat.id,
        `Forked *${agent.name}* → *${forked.name}*\nID: \`${forked.id}\`\nSession cloned. Now active.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /newbot <name> <token> [agent_name_or_id]
  bot.onText(/\/newbot\s+(\S+)\s+(\S+)(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const name = match?.[1];
    const token = match?.[2];
    const agentTarget = match?.[3]?.trim();

    if (!name || !token) {
      await bot.sendMessage(msg.chat.id, 'Usage: /newbot <name> <token> [agent_name_or_id]');
      return;
    }

    // Delete the message containing the token for security
    try {
      await bot.deleteMessage(msg.chat.id, msg.message_id);
    } catch {
      // May fail if bot lacks permissions
    }

    try {
      let agentId: string | undefined;
      if (agentTarget) {
        const agents = await listAgents(msg.chat.id.toString());
        const found = agents.find((a: AgentRow) =>
          a.name === agentTarget || a.id === agentTarget || a.id.startsWith(agentTarget),
        );
        if (found) agentId = found.id;
      }

      await registerBot(name, token, agentId, msg.chat.id.toString());
      await bot.sendMessage(msg.chat.id,
        `Bot *${name}* registered and started.${agentId ? '' : ' No agent linked — link one with /switch on the sub-bot.'}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /bots
  bot.onText(/\/bots/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const bots = await listBots();
      if (bots.length === 0) {
        await bot.sendMessage(msg.chat.id, 'No registered bots. Use /newbot <name> <token> to add one.');
        return;
      }

      const lines = bots.map((b: any) =>
        `${b.is_active ? '●' : '○'} *${b.name}*${b.agent_id ? ` → agent \`${b.agent_id.slice(0, 8)}\`` : ' (no agent)'}`,
      );
      await bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
  });

  // /removebot <name>
  bot.onText(/\/removebot\s+(.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const name = match?.[1]?.trim();
    if (!name) return;

    try {
      await removeBot(name);
      await bot.sendMessage(msg.chat.id, `Bot *${name}* removed.`, { parse_mode: 'Markdown' });
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
          const text = chunks.join('').slice(-4000);
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

      const parts = splitMessage(finalText);

      if (sentMessageId) {
        try {
          await bot.editMessageText(parts[0], {
            chat_id: msg.chat.id,
            message_id: sentMessageId,
            parse_mode: 'Markdown',
          });
        } catch {
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
