import { v4 as uuidv4 } from 'uuid';
import { query } from './db/connection';
import { ClaudeCodeAgent, StreamChunk, sendMessage } from './agents/claudeCode';
import { ChildProcess } from 'child_process';

export interface AgentRow {
  id: string;
  user_id: string;
  chat_id: string | null;
  name: string;
  cwd: string;
  claude_session_id: string | null;
  system_prompt: string | null;
  is_active: boolean;
  status: 'running' | 'stopped';
  created_at: Date;
  updated_at: Date;
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
  // Kill any running process
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

export function sendAgentMessage(
  agent: AgentRow,
  message: string,
  onChunk: (chunk: StreamChunk) => void,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const claudeAgent: ClaudeCodeAgent = {
      id: agent.id,
      name: agent.name,
      cwd: agent.cwd,
      claudeSessionId: agent.claude_session_id || undefined,
      systemPrompt: agent.system_prompt || undefined,
    };

    const proc = sendMessage(claudeAgent, message, onChunk, async (sessionId) => {
      runningProcesses.delete(agent.id);
      // Persist session ID for --resume
      if (sessionId) {
        await query('UPDATE agent_instances SET claude_session_id = ? WHERE id = ?', [sessionId, agent.id]);
      }
      resolve(sessionId);
    });

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
