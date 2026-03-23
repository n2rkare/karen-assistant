import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'PUT') {
    try {
      const { token, tasks } = req.body;
      if (!token) return res.status(400).json({ error: 'Missing token' });
      const blob = await put(`tasks/${token}.json`, JSON.stringify(tasks), {
        access: 'public',
        allowOverwrite: true,
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
      const { blobs } = await list({
        prefix: `tasks/${token}.json`,
      });
      if (!blobs || blobs.length === 0) return res.status(200).json({ tasks: [] });
      const response = await fetch(blobs[0].url);
      if (!response.ok) return res.status(200).json({ tasks: [] });
      const tasks = await response.json();
      return res.status(200).json({ tasks });
    } catch {
      return res.status(200).json({ tasks: [] });
    }
  }

  if (req.method === 'POST') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'API call failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
