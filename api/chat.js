import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CONVERSATION ───────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.body.type === 'chat') {
    try {
      const { messages, system } = req.body;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.VITE_ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system, messages }),
      });
      const data = await response.json();
      const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || "I didn't catch that — try again.";
      return res.status(200).json({ text });
    } catch (err) {
      return res.status(500).json({ error: 'Chat failed', detail: err.message });
    }
  }

  // ── TASK EXTRACTION ────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.body.type === 'extract') {
    try {
      const { messages, currentTasks, userId, timezone } = req.body;
      const userTz = timezone || 'America/New_York';

      const extractionPrompt = `You are a task extraction engine for a funeral director app. Your ONLY job is to extract tasks from conversations and return JSON.

IMPORTANT: Be aggressive about task creation. If ANY action item, reminder, or to-do is mentioned, create a task for it.

Current tasks:
${JSON.stringify(currentTasks, null, 2)}

Instructions:
- Return a JSON array of task changes
- Each item: { "action": "create"|"update"|"delete", "task": { task fields } }
- For create: include ONLY: title, priority, status, category, due_date, family_name, group_name, phone, is_arrangement_task, debrief_done
- Do NOT include case_id, user_id, id, created_at, last_activity
- status must be "pending" for new tasks
- due_date must be a full ISO string or null
- If NOTHING needs to change, return exactly: []
- Return ONLY the JSON array — no explanation, no markdown, no backticks

Priority: phone calls=medium, family/case tasks=high, DC/crematory/ME=high, else=medium
Category options: Operations, Families, Compliance, Admin, Marketing, Personal

Today's date and time in user's timezone: ${new Date().toLocaleString("en-US", { timeZone: userTz })}
Today's UTC date and time: ${new Date().toISOString()}
User's local timezone: ${userTz}
IMPORTANT: "Tomorrow" means the next calendar day in the user's local timezone. Convert local time to UTC once only. Do not double-offset.

Examples that MUST create tasks:
- "remind me to..." → create task
- "I need to call..." → create task
- "call [name] tomorrow at [time]" → create task with due_date
- "file the DC" → Compliance task
- "check on [family]" → Families task
- "pick up the remains" → Families task

Funeral shorthand — update existing tasks:
- "prep done on [name]" = update all prep group tasks for that family to status:done
- "DC filed for [name]" = update all Death Certificate group tasks to status:done
- "BPT in hand for [name]" = update burial permit task to status:done
- "ink done on [name]" = update fingerprint task to status:done

Also check: if a task involves calling someone by name and a phone number is mentioned, include phone field.

Conversation:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

Return the JSON array now:`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.VITE_ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, messages: [{ role: 'user', content: extractionPrompt }] }),
      });

      const data = await response.json();
      const raw = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '[]';

      let changes = [];
      try {
        const clean = raw.replace(/```json|```/g, '').trim();
        changes = JSON.parse(clean);
        if (!Array.isArray(changes)) changes = [];
      } catch (_) { changes = []; }

      let applied = 0;
      let newCallTask = null;

      for (const change of changes) {
        try {
          if (change.action === 'create' && change.task) {
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
            const { data: created, error } = await supabase.from('tasks').insert(safeTask).select().single();
            if (!error) {
              applied++;
              // Check if this is a call task with a name — prompt to save contact
              if (safeTask.phone) {
                const nameMatch = safeTask.title.match(/call\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
                if (nameMatch) newCallTask = { taskId: created?.id, name: nameMatch[1], phone: safeTask.phone };
              }
            }
          } else if (change.action === 'update' && change.task?.id) {
            const { id, user_id, created_at, ...updates } = change.task;
            const { error } = await supabase.from('tasks').update({ ...updates, last_activity: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
            if (!error) applied++;
          } else if (change.action === 'delete' && change.task?.id) {
            const { error } = await supabase.from('tasks').delete().eq('id', change.task.id).eq('user_id', userId);
            if (!error) applied++;
          }
        } catch (_) {}
      }

      return res.status(200).json({ changes, applied, newCallTask });
    } catch (err) {
      return res.status(500).json({ error: 'Extraction failed', detail: err.message });
    }
  }

  // ── ONBOARDING ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.body.type === 'onboarding') {
    try {
      const { messages, userId, questionCount } = req.body;

      const system = `You are Kare-N setting up a new funeral director's profile. Ask questions ONE AT A TIME. Acknowledge each answer warmly before asking the next.

You must ask ALL of these questions before completing setup. Do not skip any:
0. What should I call you? (get their preferred name first)
1. What state are they licensed in?
2. Service mix — cremation, burial, or both?
3. If cremation/mixed: what crematory do they use primarily?
4. If burial/mixed: casket supplier? Vault supplier?
5. Do they handle their own transfers or use a removal service?
6. In-house memorial products (urns, jewelry) or outsource?
7. Do they handle their own obituaries?
8. What family portal or CRM do they use? (Gather, Passare, etc.)
9. Solo operator or part of a firm?
10. Do they want a separate number for family calls? Mention Google Voice as a free option for keeping personal and work numbers separate. Make sure to fully address this question before completing.

IMPORTANT: Only output PROFILE_COMPLETE after you have received answers to ALL questions including question 10 about the separate number. Do not complete early.

When ALL questions are answered, output EXACTLY:
PROFILE_COMPLETE
{"displayName":"...","state":"...","serviceMix":"...","crematory":"...","casketSupplier":"...","vaultSupplier":"...","transfers":"...","memorialProducts":"...","obituaries":"...","crm":"...","firmType":"...","separateNumber":"..."}
PROFILE_COMPLETE

Then welcome them warmly to Kare-N by name.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.VITE_ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, system, messages }),
      });

      const data = await response.json();
      const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';

      const match = text.match(/PROFILE_COMPLETE\s*([\s\S]*?)\s*PROFILE_COMPLETE/);
      if (match) {
        try {
          const profileData = JSON.parse(match[1].trim());
          const displayName = profileData.displayName || null;
          if (userId) {
            await supabase.from('users').update({ profile: profileData, onboarded: true, display_name: displayName }).eq('id', userId);
          }
          const cleanText = text.replace(/PROFILE_COMPLETE[\s\S]*?PROFILE_COMPLETE/g, '').trim();
          return res.status(200).json({ text: cleanText, profileComplete: true, profile: profileData, displayName });
        } catch (_) {}
      }

      return res.status(200).json({ text, profileComplete: false });
    } catch (err) {
      return res.status(500).json({ error: 'Onboarding failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
