import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CONVERSATION — Call 1 ──────────────────────────────────────────────────
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

  // ── TASK EXTRACTION — Call 2 ───────────────────────────────────────────────
  if (req.method === 'POST' && req.body.type === 'extract') {
    try {
      const { messages, currentTasks, userId, timezone } = req.body;
      const userTz = timezone || 'America/New_York';

      const extractionPrompt = `You are a task extraction engine for a funeral director app. Your ONLY job is to extract tasks from conversations and return JSON.

IMPORTANT: Be aggressive about task creation. If ANY action item, reminder, or to-do is mentioned anywhere in the conversation, create a task for it.

Current tasks:
${JSON.stringify(currentTasks, null, 2)}

Instructions:
- Return a JSON array of task changes
- Each item: { "action": "create"|"update"|"delete", "task": { task fields } }
- For create: include ONLY these fields: title, priority, status, category, due_date, family_name, group_name, phone, is_arrangement_task, debrief_done
- Do NOT include case_id, user_id, id, created_at, last_activity — these are handled server-side
- status must be "pending" for new tasks
- due_date must be a full ISO string like "2026-03-27T10:00:00.000Z" or null
- If NOTHING needs to change, return exactly: []
- Return ONLY the JSON array — no explanation, no markdown, no backticks, no code fences

Priority rules:
- phone calls = medium
- family/case tasks = high
- DC, crematory, ME auth = high
- everything else = medium

Category options: Operations, Families, Compliance, Admin, Marketing, Personal

Due date rules:
- "tomorrow" = tomorrow's date at 10:00 AM
- "today" = today at 10:00 AM
- specific time mentioned = use that time
- no time mentioned = null

Today's date and time: ${new Date().toISOString()}
User's local timezone: ${userTz}
IMPORTANT: When user says a time like "9am" or "tomorrow at 2pm", interpret it in their local timezone (${userTz}) and convert correctly to UTC for the ISO string. For example if user is in America/New_York (UTC-4) and says "9am tomorrow", the UTC time would be "13:00:00Z" the next day.

Examples of what MUST create a task:
- "remind me to..." → create task
- "I need to call..." → create task
- "don't forget to..." → create task
- "call [name] tomorrow at [time]" → create task with due_date
- "file the DC" → create task, category Compliance
- "check on [family]" → create task, category Families
- "pick up the remains" → create task, category Families
- "need to order [anything]" → create task
- "follow up with..." → create task

Funeral shorthand — for these, update existing tasks:
- "prep done on [name]" = update all prep group tasks for that family to status:done
- "DC filed for [name]" = update all Death Certificate group tasks for that family to status:done
- "BPT in hand for [name]" = update burial permit task to status:done
- "ink done on [name]" = update fingerprint collection task to status:done

Conversation to analyze:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

Return the JSON array now:`;

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

      // Parse JSON
      let changes = [];
      try {
        const clean = raw.replace(/```json|```/g, '').trim();
        changes = JSON.parse(clean);
        if (!Array.isArray(changes)) changes = [];
      } catch (_) {
        changes = [];
      }

      // Apply changes to Supabase
      let applied = 0;
      for (const change of changes) {
        try {
          if (change.action === 'create' && change.task) {
            // Whitelist only safe columns — no case_id, no id
            const safeTask = {
              user_id: userId,
              title: change.task.title || 'Untitled task',
              notes: change.task.notes || null,
              priority: ['high','medium','low'].includes(change.task.priority) ? change.task.priority : 'medium',
              status: 'pending',
              category: ['Operations','Families','Compliance','Admin','Marketing','Personal'].includes(change.task.category) ? change.task.category : 'Operations',
              due_date: change.task.due_date || null,
              family_name: change.task.family_name || null,
              group_name: change.task.group_name || null,
              phone: change.task.phone || null,
              is_arrangement_task: change.task.is_arrangement_task || false,
              debrief_done: false,
              created_at: new Date().toISOString(),
              last_activity: new Date().toISOString(),
            };
            const { error } = await supabase.from('tasks').insert(safeTask);
            if (!error) applied++;
          } else if (change.action === 'update' && change.task?.id) {
            const { id, user_id, created_at, ...updates } = change.task;
            const { error } = await supabase
              .from('tasks')
              .update({ ...updates, last_activity: new Date().toISOString() })
              .eq('id', id)
              .eq('user_id', userId);
            if (!error) applied++;
          } else if (change.action === 'delete' && change.task?.id) {
            const { error } = await supabase
              .from('tasks')
              .delete()
              .eq('id', change.task.id)
              .eq('user_id', userId);
            if (!error) applied++;
          }
        } catch (_) {}
      }

      return res.status(200).json({ changes, applied });
    } catch (err) {
      return res.status(500).json({ error: 'Extraction failed', detail: err.message });
    }
  }

  // ── ONBOARDING ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.body.type === 'onboarding') {
    try {
      const { messages, userId, profile } = req.body;

      if (profile && userId) {
        await supabase.from('users').update({ profile, onboarded: true }).eq('id', userId);
        return res.status(200).json({ saved: true });
      }

      const system = `You are Kare-N setting up a new funeral director's profile. Ask questions ONE AT A TIME in a warm, conversational way. Acknowledge each answer naturally before asking the next.

Questions to ask in order:
1. What state are they licensed in?
2. Service mix — cremation, burial, or both?
3. If cremation/mixed: what crematory do they use primarily?
4. If burial/mixed: casket supplier? Vault supplier?
5. Do they handle their own transfers or use a removal service?
6. In-house memorial products (urns, jewelry) or outsource?
7. Do they handle their own obituaries?
8. What family portal or CRM do they use?
9. Solo operator or part of a firm?
10. Separate number for family calls? (mention Google Voice)

When you have enough information, output EXACTLY:
PROFILE_COMPLETE
{"state":"...","serviceMix":"...","crematory":"...","casketSupplier":"...","vaultSupplier":"...","transfers":"...","memorialProducts":"...","obituaries":"...","crm":"...","firmType":"...","separateNumber":"..."}
PROFILE_COMPLETE

Then welcome them to Kare-N.`;

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
