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
  updateAgentSession,
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

type CommandHandler = (bot: TelegramBot, msg: TelegramBot.Message, args: string) => Promise<void>;

const commands: Record<string, CommandHandler> = {};

function cmd(name: string, handler: CommandHandler) {
  commands[name] = handler;
}

// ── /help ──
cmd('help', async (bot, msg) => {
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
/session \\[id] — View/attach Claude session ID
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

// ── /spawn [name] [cwd] ──
cmd('spawn', async (bot, msg, args) => {
  const parts = args.split(/\s+/);
  const name = parts[0] || `agent-${Date.now()}`;
  const cwd = parts.slice(1).join(' ') || config.defaults.cwd;
  const chatId = msg.chat.id.toString();

  const agent = await createAgent(chatId, name, cwd, chatId);
  await bot.sendMessage(msg.chat.id,
    `Agent spawned: *${agent.name}*\nID: \`${agent.id}\`\nCWD: \`${agent.cwd}\`\nSet as active agent.`,
    { parse_mode: 'Markdown' },
  );
});

// ── /agents ──
cmd('agents', async (bot, msg) => {
  const agents = await listAgents(msg.chat.id.toString());
  if (agents.length === 0) {
    await bot.sendMessage(msg.chat.id, 'No agents. Use /spawn <name> to create one.');
    return;
  }

  const lines = agents.map((a: AgentRow) =>
    `${a.is_active ? '→ ' : '  '}*${a.name}* \`${a.id.slice(0, 8)}\` (${a.model})\n   CWD: \`${a.cwd}\`${a.claude_session_id ? ' (session)' : ''}`,
  );
  await bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
});

// ── /switch <name|id> ──
cmd('switch', async (bot, msg, args) => {
  const target = args.trim();
  if (!target) {
    await bot.sendMessage(msg.chat.id, 'Usage: /switch <name|id>');
    return;
  }

  const agents = await listAgents(msg.chat.id.toString());
  const agent = agents.find((a: AgentRow) =>
    a.name === target || a.id === target || a.id.startsWith(target),
  );

  if (!agent) {
    await bot.sendMessage(msg.chat.id, `Agent "${target}" not found.`);
    return;
  }

  await setActiveAgent(msg.chat.id.toString(), agent.id);
  await bot.sendMessage(msg.chat.id, `Switched to *${agent.name}*`, { parse_mode: 'Markdown' });
});

// ── /kill <name|id> ──
cmd('kill', async (bot, msg, args) => {
  const target = args.trim();
  if (!target) {
    await bot.sendMessage(msg.chat.id, 'Usage: /kill <name|id>');
    return;
  }

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
});

// ── /reset ──
cmd('reset', async (bot, msg) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  await resetAgent(agent.id);
  await bot.sendMessage(msg.chat.id, `Conversation reset for *${agent.name}*`, { parse_mode: 'Markdown' });
});

// ── /cwd <path> ──
cmd('cwd', async (bot, msg, args) => {
  const newCwd = args.trim();
  if (!newCwd) {
    await bot.sendMessage(msg.chat.id, 'Usage: /cwd <path>');
    return;
  }

  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  await updateAgentCwd(agent.id, newCwd);
  await bot.sendMessage(msg.chat.id, `CWD for *${agent.name}* → \`${newCwd}\``, { parse_mode: 'Markdown' });
});

// ── /model [model] ──
cmd('model', async (bot, msg, args) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const model = args.trim();
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
});

// ── /effort [level] ──
cmd('effort', async (bot, msg, args) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const effort = args.trim();
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
});

// ── /permission [mode] ──
cmd('permission', async (bot, msg, args) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const mode = args.trim();
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
});

// ── /tools [allow|deny|clear] [list] ──
cmd('tools', async (bot, msg, args) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const parts = args.trim().split(/\s+/);
  const action = parts[0];
  const toolList = parts.slice(1).join(' ');

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

  if ((action === 'allow' || action === 'deny') && !toolList) {
    await bot.sendMessage(msg.chat.id, `Usage: /tools ${action} Tool1,Tool2,...`);
    return;
  }

  if (action === 'allow') {
    await updateAgentTools(agent.id, toolList, agent.disallowed_tools);
  } else if (action === 'deny') {
    await updateAgentTools(agent.id, agent.allowed_tools, toolList);
  } else {
    await bot.sendMessage(msg.chat.id, 'Usage: /tools [allow|deny|clear] [list]');
    return;
  }

  await bot.sendMessage(msg.chat.id, `Tools updated: ${action} → \`${toolList}\``, { parse_mode: 'Markdown' });
});

// ── /system [prompt] ──
cmd('system', async (bot, msg, args) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const prompt = args.trim();
  if (!prompt) {
    const current = agent.system_prompt || '(none)';
    await bot.sendMessage(msg.chat.id, `*System prompt for ${agent.name}:*\n${current}`, { parse_mode: 'Markdown' });
    return;
  }

  if (prompt === 'clear') {
    await updateAgentSystemPrompt(agent.id, null);
    await bot.sendMessage(msg.chat.id, 'System prompt cleared.');
    return;
  }

  await updateAgentSystemPrompt(agent.id, prompt);
  await bot.sendMessage(msg.chat.id, 'System prompt updated.');
});

// ── /cost ──
cmd('cost', async (bot, msg) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const cost = await getAgentCost(agent.id);
  const text = `*Cost for ${agent.name}*
Total: $${cost.total_cost_usd.toFixed(4)}
Requests: ${cost.request_count}
Input tokens: ${cost.total_input_tokens.toLocaleString()}
Output tokens: ${cost.total_output_tokens.toLocaleString()}`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// ── /status ──
cmd('status', async (bot, msg) => {
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
});

// ── /context ──
cmd('context', async (bot, msg) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const cost = await getAgentCost(agent.id);
  const text = `*Context for ${agent.name}*
Session: \`${agent.claude_session_id ? 'active' : 'none'}\`
Total input tokens: ${cost.total_input_tokens.toLocaleString()}
Total output tokens: ${cost.total_output_tokens.toLocaleString()}
Total tokens: ${(cost.total_input_tokens + cost.total_output_tokens).toLocaleString()}`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// ── /version ──
cmd('version', async (bot, msg) => {
  const version = await getVersion();
  await bot.sendMessage(msg.chat.id, `Claude CLI: \`${version}\``, { parse_mode: 'Markdown' });
});

// ── /diff ──
cmd('diff', async (bot, msg) => {
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
});

// ── /session [id] ──
cmd('session', async (bot, msg, args) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const sessionId = args.trim();
  if (!sessionId) {
    await bot.sendMessage(msg.chat.id,
      `*Session for ${agent.name}:*\n\`${agent.claude_session_id || 'none'}\`\n\nTo attach: /session <session\\_id>`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  if (sessionId === 'clear') {
    await updateAgentSession(agent.id, null);
    await bot.sendMessage(msg.chat.id, 'Session detached.');
    return;
  }

  await updateAgentSession(agent.id, sessionId);
  await bot.sendMessage(msg.chat.id, `Session attached: \`${sessionId}\``, { parse_mode: 'Markdown' });
});

// ── /compact ──
cmd('compact', async (bot, msg) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  if (!agent.claude_session_id) {
    await bot.sendMessage(msg.chat.id, 'No active session to compact.');
    return;
  }

  await bot.sendChatAction(msg.chat.id, 'typing');

  const chunks: string[] = [];
  await sendAgentMessage(agent, '/compact', (chunk: StreamChunk) => {
    if (chunk.type === 'text') chunks.push(chunk.content);
  });

  const response = chunks.join('').trim() || 'Context compacted.';
  await sendLongMessage(bot, msg.chat.id, response);
});

// ── /continue [message] ──
cmd('continue', async (bot, msg, args) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  if (!agent.claude_session_id) {
    await bot.sendMessage(msg.chat.id, 'No session to continue.');
    return;
  }

  await bot.sendChatAction(msg.chat.id, 'typing');
  const extraMessage = args.trim();

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
});

// ── /fork ──
cmd('fork', async (bot, msg) => {
  const agent = await requireActiveAgent(bot, msg.chat.id);
  if (!agent) return;

  const chatId = msg.chat.id.toString();
  const forked = await forkAgent(agent.id, chatId, chatId);

  await bot.sendMessage(msg.chat.id,
    `Forked *${agent.name}* → *${forked.name}*\nID: \`${forked.id}\`\nSession cloned. Now active.`,
    { parse_mode: 'Markdown' },
  );
});

// ── /newbot <name> <token> [agent] ──
cmd('newbot', async (bot, msg, args) => {
  const parts = args.trim().split(/\s+/);
  const name = parts[0];
  const token = parts[1];
  const agentTarget = parts[2];

  if (!name || !token) {
    await bot.sendMessage(msg.chat.id, 'Usage: /newbot <name> <token> [agent\\_name\\_or\\_id]');
    return;
  }

  // Delete the message containing the token for security
  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
  } catch {
    // May fail if bot lacks permissions
  }

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
});

// ── /bots ──
cmd('bots', async (bot, msg) => {
  const bots = await listBots();
  if (bots.length === 0) {
    await bot.sendMessage(msg.chat.id, 'No registered bots. Use /newbot <name> <token> to add one.');
    return;
  }

  const lines = bots.map((b: any) =>
    `${b.is_active ? '●' : '○'} *${b.name}*${b.agent_id ? ` → agent \`${b.agent_id.slice(0, 8)}\`` : ' (no agent)'}`,
  );
  await bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
});

// ── /removebot <name> ──
cmd('removebot', async (bot, msg, args) => {
  const name = args.trim();
  if (!name) {
    await bot.sendMessage(msg.chat.id, 'Usage: /removebot <name>');
    return;
  }

  await removeBot(name);
  await bot.sendMessage(msg.chat.id, `Bot *${name}* removed.`, { parse_mode: 'Markdown' });
});

// ── Main dispatcher ──
export function setupHandlers(bot: TelegramBot) {
  bot.on('message', async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    if (!msg.text) return;

    // Parse command
    const cmdMatch = msg.text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);

    if (cmdMatch) {
      const name = cmdMatch[1].toLowerCase();
      const args = cmdMatch[2] || '';
      const handler = commands[name];
      if (!handler) return; // Unknown command, ignore

      try {
        await handler(bot, msg, args);
      } catch (err: any) {
        await bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
      }
      return;
    }

    // Plain text → active agent
    const agent = await getActiveAgent(msg.chat.id.toString());
    if (!agent) {
      await bot.sendMessage(msg.chat.id, 'No active agent. Use /spawn <name> to create one.');
      return;
    }

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
            // Edit may fail if content unchanged
          }
          await bot.sendChatAction(msg.chat.id, 'typing');
        }
      });

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
