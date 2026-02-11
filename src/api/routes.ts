import { Router, Request, Response } from 'express';
import {
  createAgent,
  listAgents,
  getAgent,
  deleteAgent,
  setActiveAgent,
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
  killRunningProcess,
  getAgentCost,
  forkAgent,
} from '../manager';
import { StreamChunk, getVersion } from '../agents/claudeCode';
import { registerBot, listBots, removeBot } from '../telegram/botManager';

const router = Router();

function paramId(req: Request): string {
  return req.params.id as string;
}

// List agents
router.get('/agents', async (_req: Request, res: Response) => {
  try {
    const userId = 'default';
    const agents = await listAgents(userId);
    res.json(agents);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create agent
router.post('/agents', async (req: Request, res: Response) => {
  try {
    const { name, cwd, system_prompt } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const agent = await createAgent('default', name, cwd, undefined, system_prompt);
    res.status(201).json(agent);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete agent
router.delete('/agents/:id', async (req: Request, res: Response) => {
  try {
    await deleteAgent(paramId(req));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Set active agent
router.patch('/agents/:id/active', async (req: Request, res: Response) => {
  try {
    await setActiveAgent('default', paramId(req));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reset agent conversation
router.post('/agents/:id/reset', async (req: Request, res: Response) => {
  try {
    await resetAgent(paramId(req));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update agent cwd
router.patch('/agents/:id/cwd', async (req: Request, res: Response) => {
  try {
    const { cwd } = req.body;
    if (!cwd) {
      res.status(400).json({ error: 'cwd is required' });
      return;
    }
    await updateAgentCwd(paramId(req), cwd);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Attach/detach session
router.patch('/agents/:id/session', async (req: Request, res: Response) => {
  try {
    const { session_id } = req.body;
    await updateAgentSession(paramId(req), session_id || null);
    const agent = await getAgent(paramId(req));
    res.json(agent);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update agent settings (model, effort, permission, prompt, budget)
router.patch('/agents/:id/settings', async (req: Request, res: Response) => {
  try {
    const id = paramId(req);
    const { model, effort, permission_mode, system_prompt, max_budget_usd } = req.body;

    if (model !== undefined) await updateAgentModel(id, model);
    if (effort !== undefined) await updateAgentEffort(id, effort);
    if (permission_mode !== undefined) await updateAgentPermissionMode(id, permission_mode);
    if (system_prompt !== undefined) await updateAgentSystemPrompt(id, system_prompt || null);
    if (max_budget_usd !== undefined) await updateAgentBudget(id, max_budget_usd);

    const agent = await getAgent(id);
    res.json(agent);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update agent tools
router.patch('/agents/:id/tools', async (req: Request, res: Response) => {
  try {
    const { allowed_tools, disallowed_tools } = req.body;
    await updateAgentTools(paramId(req), allowed_tools ?? null, disallowed_tools ?? null);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get agent cost
router.get('/agents/:id/cost', async (req: Request, res: Response) => {
  try {
    const cost = await getAgentCost(paramId(req));
    res.json(cost);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fork agent
router.post('/agents/:id/fork', async (req: Request, res: Response) => {
  try {
    const forked = await forkAgent(paramId(req), 'default');
    res.status(201).json(forked);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Send message (non-streaming HTTP)
router.post('/agents/:id/message', async (req: Request, res: Response) => {
  try {
    const agent = await getAgent(paramId(req));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const chunks: string[] = [];

    await sendAgentMessage(agent, message, (chunk: StreamChunk) => {
      if (chunk.type === 'text') {
        chunks.push(chunk.content);
      }
    });

    res.json({ response: chunks.join('') });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// SSE streaming endpoint for message
router.post('/agents/:id/message/stream', async (req: Request, res: Response) => {
  try {
    const agent = await getAgent(paramId(req));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await sendAgentMessage(agent, message, (chunk: StreamChunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Kill running process
router.post('/agents/:id/kill', async (req: Request, res: Response) => {
  const killed = killRunningProcess(paramId(req));
  res.json({ ok: true, killed });
});

// Claude version
router.get('/version', async (_req: Request, res: Response) => {
  try {
    const version = await getVersion();
    res.json({ version });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bot management
router.get('/bots', async (_req: Request, res: Response) => {
  try {
    const bots = await listBots();
    // Don't expose tokens
    const safe = bots.map((b: any) => ({
      id: b.id,
      name: b.name,
      agent_id: b.agent_id,
      chat_id: b.chat_id,
      is_active: b.is_active,
    }));
    res.json(safe);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bots', async (req: Request, res: Response) => {
  try {
    const { name, token, agent_id, chat_id } = req.body;
    if (!name || !token) {
      res.status(400).json({ error: 'name and token are required' });
      return;
    }
    await registerBot(name, token, agent_id, chat_id);
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/bots/:name', async (req: Request, res: Response) => {
  try {
    await removeBot(req.params.name as string);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
