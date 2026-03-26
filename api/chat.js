import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CONVERSATION — Call 1: pure chat, no task data ─────────────────────────
  if (req.method === 'POST' && req.body.type === 'chat') {
    try {
      const { messages, system } = req.body;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system,
          messages,
        }),
      });
      const data = await response.json();
      const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
      return res.status(200).json({ text });
    } catch (err) {
      return res.status(500).json({ error: 'Chat failed', detail: err.message });
    }
  }

  // ── TASK EXTRACTION — Call 2: structured JSON only ─────────────────────────
  if (req.method === 'POST' && req.body.type === 'extract') {
    try {
      const { messages, currentTasks, userId } = req.body;

      const extractionPrompt = `You are a task extraction engine for a funeral director operations app.

Based on the conversation below, determine what tasks need to be created, updated, or completed.

Current tasks in the system:
${JSON.stringify(currentTasks, null, 2)}

Rules:
- Only output a JSON array of task changes
- Each item must have: action ("create"|"update"|"delete"), and task data
- For "update" and "delete" include the task id
- For "create" include all required fields
- If no task changes are needed, output an empty array: []
- Never output anything except valid JSON
- Do not include any explanation, preamble, or markdown

Task fields: { id, title, notes, priority ("high"|"medium"|"low"), status ("pending"|"done"), category, due_date (ISO string or null), family_name (or null), case_slug (or null), group_name (or null), phone (or null), is_arrangement_task (bool), debrief_done (bool) }

Categories: Operations, Families, Compliance, Admin, Marketing, Personal

Funeral industry shorthand:
- "prep done on [name]" = mark all prep group tasks for that family done
- "DC filed for [name]" = mark all Death Certificate group tasks done  
- "arrangement complete for [name]" = mark arrangement task done, debrief_done stays false
- "ME hold on [name]" = add note to case tasks "ME hold - pending authorization"
- "BPT in hand for [name]" = mark burial permit task done
- "ink done on [name]" = mark fingerprint collection task done

Conversation:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: extractionPrompt }],
        }),
      });

      const data = await response.json();
      const raw = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '[]';

      let changes = [];
      try {
        const clean = raw.replace(/```json|```/g, '').trim();
        changes = JSON.parse(clean);
        if (!Array.isArray(changes)) changes = [];
      } catch (_) {
        changes = [];
      }

      // Apply changes to Supabase
      const results = [];
      for (const change of changes) {
        if (change.action === 'create') {
          const { data: task, error } = await supabase
            .from('tasks')
            .insert({ ...change.task, user_id: userId })
            .select()
            .single();
          if (!error) results.push(task);
        } else if (change.action === 'update') {
          const { id, ...updates } = change.task;
          const { data: task, error } = await supabase
            .from('tasks')
            .update({ ...updates, last_activity: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();
          if (!error) results.push(task);
        } else if (change.action === 'delete') {
          await supabase.from('tasks').delete().eq('id', change.task.id).eq('user_id', userId);
        }
      }

      return res.status(200).json({ changes, applied: results.length });
    } catch (err) {
      return res.status(500).json({ error: 'Extraction failed', detail: err.message });
    }
  }

  // ── ONBOARDING CHAT ────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.body.type === 'onboarding') {
    try {
      const { messages, userId, profile } = req.body;

      // If profile is complete, save it
      if (profile && userId) {
        await supabase
          .from('users')
          .update({ profile, onboarded: true })
          .eq('id', userId);
        return res.status(200).json({ saved: true });
      }

      const system = `You are Kare-N setting up a new funeral director's profile. Ask questions ONE AT A TIME in a warm, conversational way.

Questions to ask in order:
1. What state are they licensed in?
2. Service mix — cremation, burial, or both?
3. If cremation/mixed: what crematory do they use?
4. If burial/mixed: casket supplier? Vault supplier?
5. Do they handle their own transfers or use a removal service?
6. In-house memorial products or outsource?
7. Do they handle their own obituaries?
8. What CRM or family portal do they use?
9. Solo operator or part of a firm?
10. Separate number for family calls? (mention Google Voice)

When you have enough info, output EXACTLY:
PROFILE_COMPLETE
{"state":"...","serviceMix":"...","crematory":"...","casketSupplier":"...","vaultSupplier":"...","transfers":"...","memorialProducts":"...","obituaries":"...","crm":"...","firmType":"...","separateNumber":"..."}
PROFILE_COMPLETE`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system,
          messages,
        }),
      });

      const data = await response.json();
      const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';

      // Check if profile is complete
      const match = text.match(/PROFILE_COMPLETE\s*([\s\S]*?)\s*PROFILE_COMPLETE/);
      if (match) {
        try {
          const profileData = JSON.parse(match[1].trim());
          if (userId) {
            await supabase.from('users').update({ profile: profileData, onboarded: true }).eq('id', userId);
          }
          const cleanText = text.replace(/PROFILE_COMPLETE[\s\S]*?PROFILE_COMPLETE/g, '').trim();
          return res.status(200).json({ text: cleanText, profileComplete: true, profile: profileData });
        } catch (_) {}
      }

      return res.status(200).json({ text, profileComplete: false });
    } catch (err) {
      return res.status(500).json({ error: 'Onboarding failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
