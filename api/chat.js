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

      const extractionPrompt = `You are a task extraction engine for a funeral director app. Your ONLY job is to extract tasks from conversations and return JSON.

IMPORTANT: Be aggressive about task creation. If ANY action item, reminder, or to-do is mentioned anywhere in the conversation, create a task for it.

Current tasks:
${JSON.stringify(currentTasks, null, 2)}

Instructions:
- Return a JSON array of task changes
- Each item: { "action": "create"|"update"|"delete", "task": { task fields } }
- For create: include title, priority, status:"pending", category, due_date (ISO string or null), family_name (or null), case_slug (or null), group_name (or null), phone (or null), is_arrangement_task: false, debrief_done: false
- For update: include id and only the fields that changed
- For delete: include just the id
- If NOTHING needs to change, return exactly: []
- Return ONLY the JSON array — no explanation, no markdown, no backticks, no code fences

Priority rules:
- phone calls = medium
- family/case tasks = high
- DC, crematory, ME auth = high
- everything else = medium

Category rules:
- family name mentioned = Families
- compliance/regulatory = Compliance
- marketing = Marketing
- personal = Personal
- everything else = Operations

Due date rules:
- "tomorrow" = tomorrow at the default time
- "today" = today at the default time
- specific time mentioned = use that time today or tomorrow as context suggests
- no time mentioned = null

Examples of what MUST create a task:
- "remind me to..." → create task
- "I need to call..." → create task
- "don't forget to..." → create task
- "call [name] tomorrow at [time]" → create task with due_date
- "file the DC" → create Families/Compliance task
- "check on [family]" → create Families task
- "pick up the remains" → create Families task
- "need to order [anything]" → create task
- "follow up with..." → create task

Funeral shorthand:
- "prep done on [name]" = update all prep group tasks for that family to status:done
- "DC filed for [name]" = update all Death Certificate group tasks for that family to status:done
- "BPT in hand for [name]" = update burial permit task to status:done
- "ink done on [name]" = update fingerprint collection task to status:done
- "arrangement complete for [name]" = update arrangement task to status:done

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

      // Parse the JSON response
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
          if (change.action === 'create') {
            const { error } = await supabase
              .from('tasks')
              .insert({
                ...change.task,
                user_id: userId,
                created_at: new Date().toISOString(),
                last_activity: new Date().toISOString(),
              });
            if (!error) applied++;
          } else if (change.action === 'update' && change.task?.id) {
            const { id, ...updates } = change.task;
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

      // If profile is being saved
      if (profile && userId) {
        await supabase
          .from('users')
          .update({ profile, onboarded: true })
          .eq('id', userId);
        return res.status(200).json({ saved: true });
      }

      const system = `You are Kare-N setting up a new funeral director's profile. Ask questions ONE AT A TIME in a warm, conversational way. Acknowledge each answer naturally before asking the next.

Questions to ask in order:
1. What state are they licensed in? (If NC, note they use NC DAVE for death certificates)
2. Service mix — cremation, burial, or both?
3. If cremation/mixed: what crematory do they use primarily?
4. If burial/mixed: what casket supplier? What vault supplier?
5. Do they handle their own transfers or use a removal service?
6. In-house memorial products (urns, jewelry) or outsource?
7. Do they handle their own obituaries?
8. What family portal or CRM do they use? (Gather, Passare, etc.)
9. Solo operator or part of a firm?
10. Do they want a separate number for family calls? (mention Google Voice)

When you have enough information (after ~7-8 exchanges), output EXACTLY this and nothing else after it:
PROFILE_COMPLETE
{"state":"...","serviceMix":"...","crematory":"...","casketSupplier":"...","vaultSupplier":"...","transfers":"...","memorialProducts":"...","obituaries":"...","crm":"...","firmType":"...","separateNumber":"..."}
PROFILE_COMPLETE

Then tell them their personal workflow is ready and welcome them to Kare-N.`;

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
            await supabase
              .from('users')
              .update({ profile: profileData, onboarded: true })
              .eq('id', userId);
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
