import { spawn, ChildProcess } from 'child_process';
import { config } from '../config';

export interface ClaudeCodeAgent {
  id: string;
  name: string;
  cwd: string;
  claudeSessionId?: string;
  systemPrompt?: string;
}

export interface StreamChunk {
  type: 'text' | 'error' | 'done' | 'tool_use' | 'tool_result';
  content: string;
}

/**
 * Send a message to a Claude Code agent using `claude -p` with `--output-format json`.
 *
 * stream-json + verbose hangs without a TTY, so we use json mode which returns
 * a single JSON result. For streaming UX we emit the full text once available.
 */
export function sendMessage(
  agent: ClaudeCodeAgent,
  message: string,
  onChunk: (chunk: StreamChunk) => void,
  onDone: (sessionId?: string) => void,
): ChildProcess {
  const args = [
    '-p', message,
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ];

  if (agent.claudeSessionId) {
    args.push('--resume', agent.claudeSessionId);
  }

  if (agent.systemPrompt) {
    args.push('--append-system-prompt', agent.systemPrompt);
  }

  console.log(`[Claude] Spawning: ${config.defaults.claudePath} ${args.join(' ')}`);
  console.log(`[Claude] CWD: ${agent.cwd}`);

  const proc = spawn(config.defaults.claudePath, args, {
    cwd: agent.cwd,
    env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
  });

  // Close stdin immediately so claude doesn't wait for input
  proc.stdin?.end();

  proc.on('error', (err) => {
    console.error(`[Claude] Spawn error:`, err.message);
    onChunk({ type: 'error', content: `Failed to start claude: ${err.message}` });
    onChunk({ type: 'done', content: '' });
    onDone(undefined);
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
  });

  proc.stderr.on('data', (data: Buffer) => {
    const text = data.toString();
    if (text.includes('ExperimentalWarning') || text.trim() === '') return;
    stderr += text;
  });

  proc.on('close', (code) => {
    console.log(`[Claude] Process exited with code ${code}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`);
    let sessionId: string | undefined = agent.claudeSessionId;

    if (stderr && code !== 0) {
      onChunk({ type: 'error', content: stderr });
      onChunk({ type: 'done', content: '' });
      onDone(sessionId);
      return;
    }

    try {
      const result = JSON.parse(stdout);

      if (result.session_id) {
        sessionId = result.session_id;
      }

      if (result.is_error) {
        onChunk({ type: 'error', content: result.result || 'Unknown error' });
      } else if (result.result) {
        onChunk({ type: 'text', content: result.result });
      }
    } catch {
      // If JSON parse fails, emit raw output
      if (stdout.trim()) {
        onChunk({ type: 'text', content: stdout.trim() });
      }
    }

    if (code !== 0 && code !== null && !stderr) {
      onChunk({ type: 'error', content: `Process exited with code ${code}` });
    }

    onChunk({ type: 'done', content: '' });
    onDone(sessionId);
  });

  return proc;
}
