import { v4 as uuidv4 } from 'uuid';
import { query } from './db/connection';
import { ClaudeCodeAgent, ClaudeResult, StreamChunk, SendMessageOptions, sendMessage } from './agents/claudeCode';
import { ChildProcess } from 'child_process';

export interface AgentRow {
  id: string;
  user_id: string;
  chat_id: string | null;
  name: string;
  cwd: string;
  claude_session_id: string | null;
  system_prompt: string | null;
  model: string;
  effort: string;
  permission_mode: string;
  allowed_tools: string | null;
  disallowed_tools: string | null;
  max_budget_usd: number | null;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  last_duration_ms: number | null;
  is_active: boolean;
  status: 'running' | 'stopped';
  created_at: Date;
  updated_at: Date;
}

export interface CostSummary {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  request_count: number;
  recent: Array<{
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    duration_ms: number;
    created_at: Date;
  }>;
}

// Track running processes so we can kill them
const runningProcesses = new Map<string, ChildProcess>();

export async function createAgent(
  userId: string,
  name: string,
  cwd: string = '/home/bajistic',
  chatId?: string,
  systemPrompt?: string,
): Promise<AgentRow> {
  const id = uuidv4();

  // Deactivate other agents for this user
  await query('UPDATE agent_instances SET is_active = FALSE WHERE user_id = ?', [userId]);

  await query(
    `INSERT INTO agent_instances (id, user_id, chat_id, name, cwd, system_prompt, is_active, status)
     VALUES (?, ?, ?, ?, ?, ?, TRUE, 'running')`,
    [id, userId, chatId || null, name, cwd, systemPrompt || null],
  );

  return getAgent(id) as Promise<AgentRow>;
}

export async function getAgent(id: string): Promise<AgentRow | null> {
  const rows = await query('SELECT * FROM agent_instances WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function listAgents(userId?: string): Promise<AgentRow[]> {
  if (userId) {
    return query('SELECT * FROM agent_instances WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  }
  return query('SELECT * FROM agent_instances ORDER BY created_at DESC');
}

export async function getActiveAgent(userId: string): Promise<AgentRow | null> {
  const rows = await query(
    'SELECT * FROM agent_instances WHERE user_id = ? AND is_active = TRUE LIMIT 1',
    [userId],
  );
  return rows[0] || null;
}

export async function setActiveAgent(userId: string, agentId: string): Promise<void> {
  await query('UPDATE agent_instances SET is_active = FALSE WHERE user_id = ?', [userId]);
  await query('UPDATE agent_instances SET is_active = TRUE WHERE id = ? AND user_id = ?', [agentId, userId]);
}

export async function deleteAgent(id: string): Promise<void> {
  const proc = runningProcesses.get(id);
  if (proc) {
    proc.kill('SIGTERM');
    runningProcesses.delete(id);
  }
  await query('DELETE FROM agent_instances WHERE id = ?', [id]);
}

export async function resetAgent(id: string): Promise<void> {
  const proc = runningProcesses.get(id);
  if (proc) {
    proc.kill('SIGTERM');
    runningProcesses.delete(id);
  }
  await query('UPDATE agent_instances SET claude_session_id = NULL WHERE id = ?', [id]);
}

export async function updateAgentCwd(id: string, cwd: string): Promise<void> {
  await query('UPDATE agent_instances SET cwd = ? WHERE id = ?', [cwd, id]);
}

export async function updateAgentModel(id: string, model: string): Promise<void> {
  await query('UPDATE agent_instances SET model = ? WHERE id = ?', [model, id]);
}

export async function updateAgentEffort(id: string, effort: string): Promise<void> {
  await query('UPDATE agent_instances SET effort = ? WHERE id = ?', [effort, id]);
}

export async function updateAgentPermissionMode(id: string, mode: string): Promise<void> {
  await query('UPDATE agent_instances SET permission_mode = ? WHERE id = ?', [mode, id]);
}

export async function updateAgentTools(
  id: string,
  allowed: string | null,
  disallowed: string | null,
): Promise<void> {
  await query(
    'UPDATE agent_instances SET allowed_tools = ?, disallowed_tools = ? WHERE id = ?',
    [allowed, disallowed, id],
  );
}

export async function updateAgentSystemPrompt(id: string, prompt: string | null): Promise<void> {
  await query('UPDATE agent_instances SET system_prompt = ? WHERE id = ?', [prompt, id]);
}

export async function updateAgentBudget(id: string, budget: number | null): Promise<void> {
  await query('UPDATE agent_instances SET max_budget_usd = ? WHERE id = ?', [budget, id]);
}

export async function recordCost(agentId: string, result: ClaudeResult): Promise<void> {
  // Insert into cost_history
  await query(
    `INSERT INTO cost_history (agent_id, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      agentId,
      result.cost_usd || 0,
      result.input_tokens || 0,
      result.output_tokens || 0,
      result.cache_read_tokens || 0,
      result.cache_write_tokens || 0,
      result.duration_ms || 0,
    ],
  );

  // Update running totals on agent
  await query(
    `UPDATE agent_instances SET
      total_cost_usd = total_cost_usd + ?,
      total_input_tokens = total_input_tokens + ?,
      total_output_tokens = total_output_tokens + ?,
      last_duration_ms = ?
     WHERE id = ?`,
    [
      result.cost_usd || 0,
      result.input_tokens || 0,
      result.output_tokens || 0,
      result.duration_ms || 0,
      agentId,
    ],
  );
}

export async function getAgentCost(agentId: string): Promise<CostSummary> {
  const agent = await getAgent(agentId);
  const recent = await query(
    'SELECT cost_usd, input_tokens, output_tokens, duration_ms, created_at FROM cost_history WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10',
    [agentId],
  );
  const countRows = await query(
    'SELECT COUNT(*) as cnt FROM cost_history WHERE agent_id = ?',
    [agentId],
  );

  return {
    total_cost_usd: Number(agent?.total_cost_usd || 0),
    total_input_tokens: Number(agent?.total_input_tokens || 0),
    total_output_tokens: Number(agent?.total_output_tokens || 0),
    request_count: Number(countRows[0]?.cnt || 0),
    recent,
  };
}

export async function forkAgent(originalId: string, userId: string, chatId?: string): Promise<AgentRow> {
  const original = await getAgent(originalId);
  if (!original) throw new Error('Original agent not found');

  const id = uuidv4();

  // Deactivate other agents for this user
  await query('UPDATE agent_instances SET is_active = FALSE WHERE user_id = ?', [userId]);

  await query(
    `INSERT INTO agent_instances (id, user_id, chat_id, name, cwd, claude_session_id, system_prompt, model, effort, permission_mode, allowed_tools, disallowed_tools, max_budget_usd, is_active, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'running')`,
    [
      id,
      userId,
      chatId || original.chat_id,
      `${original.name}-fork`,
      original.cwd,
      original.claude_session_id, // fork will use --resume to fork from this session
      original.system_prompt,
      original.model,
      original.effort,
      original.permission_mode,
      original.allowed_tools,
      original.disallowed_tools,
      original.max_budget_usd,
    ],
  );

  return getAgent(id) as Promise<AgentRow>;
}

function buildClaudeAgent(agent: AgentRow): ClaudeCodeAgent {
  return {
    id: agent.id,
    name: agent.name,
    cwd: agent.cwd,
    claudeSessionId: agent.claude_session_id || undefined,
    systemPrompt: agent.system_prompt || undefined,
    model: agent.model || 'sonnet',
    effort: agent.effort || 'high',
    permissionMode: agent.permission_mode || 'bypassPermissions',
    allowedTools: agent.allowed_tools || undefined,
    disallowedTools: agent.disallowed_tools || undefined,
    maxBudgetUsd: agent.max_budget_usd ? Number(agent.max_budget_usd) : undefined,
  };
}

export function sendAgentMessage(
  agent: AgentRow,
  message: string,
  onChunk: (chunk: StreamChunk) => void,
  options?: SendMessageOptions,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const claudeAgent = buildClaudeAgent(agent);

    const proc = sendMessage(claudeAgent, message, onChunk, async (sessionId, result) => {
      runningProcesses.delete(agent.id);
      // Persist session ID for --resume
      if (sessionId) {
        await query('UPDATE agent_instances SET claude_session_id = ? WHERE id = ?', [sessionId, agent.id]);
      }
      // Record cost if we got a result
      if (result) {
        try {
          await recordCost(agent.id, result);
        } catch (err) {
          console.error('[Manager] Failed to record cost:', err);
        }
      }
      resolve(sessionId);
    }, options);

    runningProcesses.set(agent.id, proc);
  });
}

export function killRunningProcess(agentId: string): boolean {
  const proc = runningProcesses.get(agentId);
  if (proc) {
    proc.kill('SIGTERM');
    runningProcesses.delete(agentId);
    return true;
  }
  return false;
}
