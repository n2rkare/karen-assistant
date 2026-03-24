import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'PUT') {
    try {
      const { token, tasks } = req.body;
      if (!token) return res.status(400).json({ error: 'Missing token' });
      const blob = await put(`tasks-${token}.json`, JSON.stringify(tasks), {
        access: 'public',
        allowOverwrite: true,
        addRandomSuffix: false,
      });
      return res.status(200).json({ ok: true, url: blob.url });
    } catch (err) {
      return res.status(500).json({ error: 'Save failed', detail: err.message });
    }
  }

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
    } catch (err) {
      return res.status(200).json({ tasks: [], error: err.message });
    }
  }

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
      
      // Extract and save tasks server-side
      const fullText = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
      const taskMatch = fullText.match(/%%TASKS_START%%([\s\S]*?)%%TASKS_END%%/) || 
                        fullText.match(/```tasks([\s\S]*?)```/);
      
      if (taskMatch && token) {
        try {
          const parsed = JSON.parse(taskMatch[1].trim());
          if (parsed.action === 'update' && Array.isArray(parsed.tasks)) {
            await put(`tasks-${token}.json`, JSON.stringify(parsed.tasks), {
              access: 'public',
              allowOverwrite: true,
              addRandomSuffix: false,
            });
          }
        } catch (_) {}
      }

      // Strip task block from response before sending to client
      const cleanedText = fullText
        .replace(/%%TASKS_START%%[\s\S]*?%%TASKS_END%%/g, '')
        .replace(/```tasks[\s\S]*?```/g, '')
        .trim();

      // Replace content with cleaned text
      if (data.content) {
        data.content = [{ type: 'text', text: cleanedText }];
      }

      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'API call failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
