import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── Load tasks ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: 'Missing token' });
      const { blobs } = await list({ prefix: `tasks-${token}.json` });
      if (!blobs || blobs.length === 0) return res.status(200).json({ tasks: [] });
      const response = await fetch(blobs[0].url);
      if (!response.ok) return res.status(200).json({ tasks: [] });
      const tasks = await response.json();
      return res.status(200).json({ tasks });
    } catch {
      return res.status(200).json({ tasks: [] });
    }
  }

  // ── Save tasks directly ─────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    try {
      const { token, tasks } = req.body;
      if (!token) return res.status(400).json({ error: 'Missing token' });
      await put(`tasks-${token}.json`, JSON.stringify(tasks), {
        access: 'public',
        allowOverwrite: true,
        addRandomSuffix: false,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Save failed', detail: err.message });
    }
  }

  // ── AI chat with server-side task extraction ────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { token, ...body } = req.body;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const fullText = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';

      // Try to extract tasks from the response
      let tasksSaved = false;
      const taskMatch = fullText.match(/TASK_DATA_START\s*([\s\S]*?)\s*TASK_DATA_END/);
      
      if (taskMatch && token) {
        try {
          const parsed = JSON.parse(taskMatch[1].trim());
          if (parsed.action === 'update' && Array.isArray(parsed.tasks)) {
            await put(`tasks-${token}.json`, JSON.stringify(parsed.tasks), {
              access: 'public',
              allowOverwrite: true,
              addRandomSuffix: false,
            });
            tasksSaved = true;
          }
        } catch (_) {}
      }

      // Clean the response text - remove task data block
      const cleanedText = fullText
        .replace(/TASK_DATA_START[\s\S]*?TASK_DATA_END/g, '')
        .trim();

      return res.status(200).json({
        content: [{ type: 'text', text: cleanedText }],
        cleanedText,
        tasksSaved,
      });
    } catch (err) {
      return res.status(500).json({ error: 'API call failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
