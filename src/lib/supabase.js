import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── AUTH ──────────────────────────────────────────────────────────────────────
export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
  });
  return { error };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// ── USER PROFILE ──────────────────────────────────────────────────────────────
export async function getUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  return { data, error };
}

export async function upsertUser(userId, email, updates = {}) {
  const { data, error } = await supabase
    .from('users')
    .upsert({ id: userId, email, ...updates, last_active: new Date().toISOString() })
    .select()
    .single();
  return { data, error };
}

export async function updateUserProfile(userId, profile) {
  const { error } = await supabase
    .from('users')
    .update({ profile, onboarded: true })
    .eq('id', userId);
  return { error };
}

// ── SETTINGS ─────────────────────────────────────────────────────────────────
export async function getSettings(userId) {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  return { data, error };
}

export async function upsertSettings(userId, settings) {
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: userId, ...settings, updated_at: new Date().toISOString() });
  return { error };
}

// ── TASKS ─────────────────────────────────────────────────────────────────────
export async function getTasks(userId) {
  const { data, error } = await supabase
    .from('tasks')
    .select(`*, subtasks(*)`)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function upsertTask(userId, task) {
  const { id, subtasks, ...taskData } = task;
  const { data, error } = await supabase
    .from('tasks')
    .upsert({ id, user_id: userId, ...taskData })
    .select()
    .single();

  // Handle subtasks separately
  if (subtasks?.length > 0 && data) {
    await supabase.from('subtasks').delete().eq('task_id', data.id);
    await supabase.from('subtasks').insert(
      subtasks.map((s, i) => ({ task_id: data.id, title: s.title, done: s.done, order_index: i }))
    );
  }
  return { data, error };
}

export async function upsertTasks(userId, tasks) {
  // Bulk upsert all tasks
  const taskRows = tasks.map(({ subtasks, ...t }) => ({ ...t, user_id: userId }));
  const { data, error } = await supabase
    .from('tasks')
    .upsert(taskRows)
    .select();

  if (error) return { error };

  // Handle subtasks for each task
  for (const task of tasks) {
    if (task.subtasks?.length > 0) {
      await supabase.from('subtasks').delete().eq('task_id', task.id);
      await supabase.from('subtasks').insert(
        task.subtasks.map((s, i) => ({ task_id: task.id, title: s.title, done: s.done, order_index: i }))
      );
    }
  }
  return { data, error };
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  return { error };
}

export async function updateSubtask(subtaskId, done) {
  const { error } = await supabase
    .from('subtasks')
    .update({ done })
    .eq('id', subtaskId);
  return { error };
}

// ── CASES ─────────────────────────────────────────────────────────────────────
export async function getCases(userId) {
  const { data, error } = await supabase
    .from('cases')
    .select('*')
    .eq('user_id', userId)
    .order('last_activity', { ascending: false });
  return { data, error };
}

export async function upsertCase(userId, caseData) {
  const { data, error } = await supabase
    .from('cases')
    .upsert({ ...caseData, user_id: userId })
    .select()
    .single();
  return { data, error };
}

export async function closeCase(caseId) {
  const { error } = await supabase
    .from('cases')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', caseId);
  return { error };
}

export async function deleteCase(caseId) {
  const { error } = await supabase.from('cases').delete().eq('id', caseId);
  return { error };
}

// ── CASE NOTES ────────────────────────────────────────────────────────────────
export async function getCaseNotes(caseId, userId) {
  const { data, error } = await supabase
    .from('case_notes')
    .select('*')
    .eq('case_id', caseId)
    .eq('user_id', userId)
    .single();
  return { data, error };
}

export async function upsertCaseNotes(caseId, userId, content) {
  const { error } = await supabase
    .from('case_notes')
    .upsert({ case_id: caseId, user_id: userId, content, updated_at: new Date().toISOString() });
  return { error };
}

// ── ACTIVITY LOG ──────────────────────────────────────────────────────────────
export async function logActivity(caseId, userId, action, detail = '') {
  const { error } = await supabase
    .from('activity_log')
    .insert({ case_id: caseId, user_id: userId, action, detail });
  return { error };
}

export async function getActivityLog(caseId) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });
  return { data, error };
}

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
export async function getTemplates(userId) {
  const { data, error } = await supabase
    .from('templates')
    .select(`*, template_groups(*, template_tasks(*))`)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return { data, error };
}

export async function upsertTemplate(userId, template) {
  const { groups, ...templateData } = template;
  const { data, error } = await supabase
    .from('templates')
    .upsert({ ...templateData, user_id: userId })
    .select()
    .single();

  if (error || !data) return { error };

  // Rebuild groups and tasks
  await supabase.from('template_groups').delete().eq('template_id', data.id);
  for (let gi = 0; gi < (groups || []).length; gi++) {
    const group = groups[gi];
    const { data: gData } = await supabase
      .from('template_groups')
      .insert({ template_id: data.id, name: group.name, order_index: gi })
      .select()
      .single();
    if (gData) {
      await supabase.from('template_tasks').insert(
        (group.tasks || []).map((title, ti) => ({ group_id: gData.id, title, order_index: ti }))
      );
    }
  }
  return { data, error: null };
}

// ── CONTACTS ──────────────────────────────────────────────────────────────────
export async function getContacts(userId) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  return { data, error };
}

export async function upsertContact(userId, contact) {
  const { error } = await supabase
    .from('contacts')
    .upsert({ ...contact, user_id: userId });
  return { error };
}

export async function deleteContact(contactId) {
  const { error } = await supabase.from('contacts').delete().eq('id', contactId);
  return { error };
}

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────
export async function getDocuments(userId) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false });
  return { data, error };
}

export async function uploadDocument(userId, file) {
  const path = `${userId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(path, file);
  if (uploadError) return { error: uploadError };

  const { error } = await supabase.from('documents').insert({
    user_id: userId,
    name: file.name,
    file_type: file.type,
    storage_path: path,
  });
  return { error };
}

export async function getDocumentUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, 3600);
  if (error) return null;
  return data.signedUrl;
}

export async function deleteDocument(docId, storagePath) {
  await supabase.storage.from('documents').remove([storagePath]);
  const { error } = await supabase.from('documents').delete().eq('id', docId);
  return { error };
}

// ── FEEDBACK ──────────────────────────────────────────────────────────────────
export async function saveFeedback(userId, content) {
  const { error } = await supabase.from('feedback').insert({ user_id: userId, content });
  return { error };
}

// ── TESTIMONIALS ──────────────────────────────────────────────────────────────
export async function saveTestimonial(userId, content) {
  const { error } = await supabase.from('testimonials').insert({ user_id: userId, content });
  return { error };
}

export async function hasGivenTestimonial(userId) {
  const { data } = await supabase
    .from('testimonials')
    .select('id')
    .eq('user_id', userId)
    .limit(1);
  return data && data.length > 0;
}
