import { spawn, ChildProcess, execFile } from 'child_process';
import { config } from '../config';

export interface ClaudeCodeAgent {
  id: string;
  name: string;
  cwd: string;
  claudeSessionId?: string;
  systemPrompt?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  allowedTools?: string;
  disallowedTools?: string;
  maxBudgetUsd?: number;
}

export interface SendMessageOptions {
  continueSession?: boolean;
  forkSession?: boolean;
}

export interface ClaudeResult {
  result: string;
  session_id: string;
  is_error: boolean;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  duration_ms?: number;
  num_turns?: number;
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
  onDone: (sessionId?: string, result?: ClaudeResult) => void,
  options?: SendMessageOptions,
): ChildProcess {
  const args: string[] = [];

  // Continue mode: resume most recent conversation without a new prompt
  if (options?.continueSession) {
    args.push('--continue');
    if (message) {
      args.push('-p', message);
    }
  } else {
    args.push('-p', message);
  }

  args.push('--output-format', 'json');

  // Permission mode
  if (agent.permissionMode === 'bypassPermissions' || !agent.permissionMode) {
    args.push('--dangerously-skip-permissions');
  } else if (agent.permissionMode === 'acceptEdits') {
    args.push('--allowedTools', 'Edit,Write,NotebookEdit');
  }
  // 'default' mode = no special flags

  // Model
  if (agent.model && agent.model !== 'sonnet') {
    args.push('--model', agent.model);
  }

  // Reasoning effort
  if (agent.effort && agent.effort !== 'high') {
    args.push('--effort', agent.effort);
  }

  // Session handling
  if (options?.forkSession && agent.claudeSessionId) {
    args.push('--resume', agent.claudeSessionId);
  } else if (agent.claudeSessionId && !options?.continueSession) {
    args.push('--resume', agent.claudeSessionId);
  }

  // System prompt
  if (agent.systemPrompt) {
    args.push('--append-system-prompt', agent.systemPrompt);
  }

  // Allowed/disallowed tools
  if (agent.allowedTools) {
    args.push('--allowedTools', agent.allowedTools);
  }
  if (agent.disallowedTools) {
    args.push('--disallowedTools', agent.disallowedTools);
  }

  // Budget
  if (agent.maxBudgetUsd) {
    args.push('--max-turns-budget', agent.maxBudgetUsd.toString());
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
    onDone(undefined, undefined);
  });

  let stdout = '';
  let stderr = '';
  const startTime = Date.now();

  proc.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
  });

  proc.stderr.on('data', (data: Buffer) => {
    const text = data.toString();
    if (text.includes('ExperimentalWarning') || text.trim() === '') return;
    stderr += text;
  });

  proc.on('close', (code) => {
    const durationMs = Date.now() - startTime;
    console.log(`[Claude] Process exited with code ${code}, stdout length: ${stdout.length}, stderr length: ${stderr.length}, duration: ${durationMs}ms`);
    let sessionId: string | undefined = agent.claudeSessionId;

    if (stderr && code !== 0) {
      onChunk({ type: 'error', content: stderr });
      onChunk({ type: 'done', content: '' });
      onDone(sessionId, undefined);
      return;
    }

    try {
      const raw = JSON.parse(stdout);

      if (raw.session_id) {
        sessionId = raw.session_id;
      }

      const claudeResult: ClaudeResult = {
        result: raw.result || '',
        session_id: raw.session_id || sessionId || '',
        is_error: !!raw.is_error,
        cost_usd: raw.cost_usd,
        input_tokens: raw.input_tokens,
        output_tokens: raw.output_tokens,
        cache_read_tokens: raw.cache_read_tokens,
        cache_write_tokens: raw.cache_write_tokens,
        duration_ms: durationMs,
        num_turns: raw.num_turns,
      };

      if (raw.is_error) {
        onChunk({ type: 'error', content: raw.result || 'Unknown error' });
      } else if (raw.result) {
        onChunk({ type: 'text', content: raw.result });
      }

      onChunk({ type: 'done', content: '' });
      onDone(sessionId, claudeResult);
    } catch {
      // If JSON parse fails, emit raw output
      if (stdout.trim()) {
        onChunk({ type: 'text', content: stdout.trim() });
      }

      if (code !== 0 && code !== null && !stderr) {
        onChunk({ type: 'error', content: `Process exited with code ${code}` });
      }

      onChunk({ type: 'done', content: '' });
      onDone(sessionId, undefined);
    }
  });

  return proc;
}

/**
 * Get the installed Claude Code CLI version.
 */
export function getVersion(): Promise<string> {
  return new Promise((resolve) => {
    execFile(config.defaults.claudePath, ['--version'], (err, stdout) => {
      if (err) {
        resolve('unknown');
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
