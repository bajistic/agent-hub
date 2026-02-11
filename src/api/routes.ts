import { Router, Request, Response } from 'express';
import {
  createAgent,
  listAgents,
  getAgent,
  deleteAgent,
  setActiveAgent,
  resetAgent,
  updateAgentCwd,
  sendAgentMessage,
  killRunningProcess,
} from '../manager';
import { StreamChunk } from '../agents/claudeCode';

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

export default router;
