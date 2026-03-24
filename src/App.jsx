import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Token registry ────────────────────────────────────────────────────────────
const VALID_TOKENS = {
  "CLAY-IOK-2026": { name: "Clay Bruggeman" },
  "JOSE-SEGURA-2026": { name: "Jose Segura" },
};

const ADMIN_PASSWORD = "UndtkR3247K?";

function getTokenFromURL() {
  return new URLSearchParams(window.location.search).get("token");
}
function generateToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ── Default templates ─────────────────────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  {
    id: "cremation",
    name: "Cremation",
    description: "Standard cremation workflow",
    color: "#22d3ee",
    groups: [
      { name: "Portal", tasks: ["Invite Sent", "Accepted", "Packet"] },
      { name: "Death Certificate", tasks: ["Input", "Dr. Sig", "Proof", "Release", "Order"] },
      { name: "Obit", tasks: ["Input", "Draft", "Approval", "Publish"] },
      { name: "Crematory", tasks: ["Fingerprint Collected", "DC", "Auth", "ME Auth (if required)"] },
      { name: "Urn", tasks: ["Photo Received", "Design", "Proof", "Print"] },
    ],
  },
  {
    id: "fullservice",
    name: "Full Service",
    description: "Full service burial workflow",
    color: "#a78bfa",
    groups: [
      { name: "Portal", tasks: ["Invite Sent", "Accepted", "Packet"] },
      { name: "Death Certificate", tasks: ["Input", "Dr. Sig", "Proof", "Release", "Order"] },
      { name: "Obit", tasks: ["Input", "Draft", "Approval", "Publish"] },
      { name: "Casket", tasks: ["Ordered", "Confirmed"] },
      { name: "Vault", tasks: ["Ordered", "Confirmed"] },
      { name: "Cemetery", tasks: ["Called", "Confirmed"] },
      { name: "Service", tasks: ["Route Planned", "Confirmed"] },
    ],
  },
];

// ── Storage helpers ───────────────────────────────────────────────────────────
async function loadTasks(token) {
  try {
    const res = await fetch(`/api/chat?token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.tasks && data.tasks.length > 0) return data.tasks;
    }
  } catch (_) {}
  try {
    const local = localStorage.getItem(`karen-tasks-${token}`);
    if (local) return JSON.parse(local);
  } catch (_) {}
  return [];
}

function loadSettings(token) {
  try {
    const s = localStorage.getItem(`karen-settings-${token}`);
    if (s) return JSON.parse(s);
  } catch (_) {}
  return { darkMode: true, defaultDueTime: "10:00", defaultCategory: "Operations" };
}

function saveSettings(token, settings) {
  try { localStorage.setItem(`karen-settings-${token}`, JSON.stringify(settings)); } catch (_) {}
}

function loadTemplates(token) {
  try {
    const t = localStorage.getItem(`karen-templates-${token}`);
    if (t) return JSON.parse(t);
  } catch (_) {}
  return DEFAULT_TEMPLATES;
}

function saveTemplates(token, templates) {
  try { localStorage.setItem(`karen-templates-${token}`, JSON.stringify(templates)); } catch (_) {}
}

function loadDocuments(token) {
  try {
    const d = localStorage.getItem(`karen-docs-${token}`);
    if (d) return JSON.parse(d);
  } catch (_) {}
  return [];
}

function saveDocuments(token, docs) {
  try { localStorage.setItem(`karen-docs-${token}`, JSON.stringify(docs)); } catch (_) {}
}

// ── Time helpers ──────────────────────────────────────────────────────────────
function getTimeRemaining(dueDate) {
  if (!dueDate) return null;
  return new Date(dueDate) - new Date();
}

function getUrgencyColor(task) {
  if (task.status === "done") return "#1e293b";
  const ms = getTimeRemaining(task.dueDate);
  if (ms === null) return "#6366f1";
  if (ms < 0) return "#ef4444";
  if (ms < 24 * 60 * 60 * 1000) return "#ff006e";
  if (ms < 48 * 60 * 60 * 1000) return "#ffbe0b";
  return "#00b4d8";
}

function formatDueTime(dueDate) {
  if (!dueDate) return null;
  return new Date(dueDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDueDate(dueDate) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function snoozeDate(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function applyDefaultTime(isoDate, defaultTime) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    const [h, m] = defaultTime.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d.toISOString();
}

function isOverdue(task) {
  if (!task.dueDate || task.status === "done") return false;
  return new Date(task.dueDate) < new Date();
}

function detectFamilyName(title) {
  const patterns = [
    /(?:family|the)\s+([A-Z][a-z]+)\s+(?:family)?/i,
    /([A-Z][a-z]+)\s+(?:family|case|arrangement|service|funeral|cremation)/i,
    /(?:Mr|Mrs|Ms|Dr)\.?\s+([A-Z][a-z]+)/i,
    /(?:for|re:?)\s+([A-Z][a-z]+)/i,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function getTimeOfDay() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(taskContext, defaultTime, templates) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const templateNames = templates.map(t => t.name).join(", ");

  return `You are Kare-N — a sharp, no-fluff AI executive assistant for independent funeral directors. Today is ${today}, ${time}.

BEHAVIOR:
- Capture tasks immediately when mentioned.
- Default due time if not specified: ${defaultTime}.
- Be direct, brief, no flattery.
- On first message of the day, give a daily briefing.
- When user says "new family" or gives a family name with service type, collect: full name, DOB, DOD, sex — then spin up the appropriate workflow template.
- Available templates: ${templateNames}.
- When creating a family workflow, create all tasks at once with the family name in the title.
- Support recurring tasks, subtasks, snoozing.
- When user wants to modify a template, acknowledge it and tell them to use the Templates section in Settings.
- If user says "DC" they mean Death Certificate tasks.
- ME Auth is only required on some cases — flag it as conditional.
- Detect family names in task titles automatically.

TASK JSON — include at end of response when tasks change:
%%TASKS_START%%
{"action":"update","tasks":[...full updated array...]}
%%TASKS_END%%

Each task:
{
  id, title, notes, priority ("high"|"medium"|"low"),
  status ("pending"|"done"|"snoozed"),
  category, createdAt, dueDate (ISO or null),
  completedAt (ISO or null), recurring (string or null),
  subtasks ([{id,title,done}]),
  familyName (string or null),
  folder (string or null),
  group (string or null)
}

Categories: Operations, Families, Compliance, Admin, Marketing, Personal

${taskContext}`;
}

// ── Colors ────────────────────────────────────────────────────────────────────
const priorityColors = { high: "#ef4444", medium: "#f59e0b", low: "#94a3b8" };
const categoryColors = {
  Operations: "#22d3ee", Families: "#a78bfa", Compliance: "#f87171",
  Admin: "#94a3b8", Marketing: "#34d399", Personal: "#fb923c",
};

// ── Mascot ────────────────────────────────────────────────────────────────────
function KarenMascot({ size = 48, animated = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none"
      style={animated ? { animation: "float 3s ease-in-out infinite" } : {}}>
      <ellipse cx="50" cy="78" rx="34" ry="10" fill="url(#sg)" opacity="0.7" />
      <rect x="22" y="28" width="56" height="52" rx="28" fill="url(#hg)" />
      <ellipse cx="38" cy="38" rx="10" ry="7" fill="white" opacity="0.25" transform="rotate(-20 38 38)" />
      <rect x="28" y="34" width="44" height="36" rx="20" fill="url(#fg)" />
      <path d="M32 36 Q50 20 68 36" stroke="#22d3ee" strokeWidth="5" strokeLinecap="round" fill="none" />
      <ellipse cx="40" cy="48" rx="5" ry="5.5" fill="#1e3a5f" />
      <ellipse cx="60" cy="48" rx="5" ry="5.5" fill="#1e3a5f" />
      <ellipse cx="41.5" cy="46.5" rx="1.5" ry="1.5" fill="white" />
      <ellipse cx="61.5" cy="46.5" rx="1.5" ry="1.5" fill="white" />
      <path d="M43 57 Q50 63 57 57" stroke="#1e3a5f" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <ellipse cx="36" cy="56" rx="4" ry="2.5" fill="#f9a8d4" opacity="0.5" />
      <ellipse cx="64" cy="56" rx="4" ry="2.5" fill="#f9a8d4" opacity="0.5" />
      <path d="M22 48 Q22 24 50 24 Q78 24 78 48" stroke="#1e40af" strokeWidth="5" fill="none" strokeLinecap="round" />
      <ellipse cx="22" cy="50" rx="7" ry="9" fill="#1e40af" />
      <ellipse cx="22" cy="50" rx="4" ry="6" fill="#22d3ee" />
      <ellipse cx="78" cy="50" rx="7" ry="9" fill="#1e40af" />
      <ellipse cx="78" cy="50" rx="4" ry="6" fill="#22d3ee" />
      <path d="M28 60 Q18 65 20 72" stroke="#1e40af" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="20" cy="73" r="3" fill="#22d3ee" />
      <rect x="30" y="74" width="40" height="8" rx="4" fill="#1e40af" />
      <rect x="42" y="75" width="16" height="5" rx="2.5" fill="#22d3ee" />
      <path d="M50 14 C50 14 46 10 43 12 C40 14 40 18 43 20 L50 26 L57 20 C60 18 60 14 57 12 C54 10 50 14 50 14Z" fill="#22d3ee" opacity="0.9" />
      <path d="M80 20 L81.5 16 L83 20 L87 21.5 L83 23 L81.5 27 L80 23 L76 21.5Z" fill="#a78bfa" opacity="0.8" />
      <path d="M14 32 L15 30 L16 32 L18 33 L16 34 L15 36 L14 34 L12 33Z" fill="#22d3ee" opacity="0.7" />
      <defs>
        <linearGradient id="hg" x1="22" y1="28" x2="78" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1e3a8a" /><stop offset="100%" stopColor="#1e40af" />
        </linearGradient>
        <linearGradient id="fg" x1="28" y1="34" x2="72" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#e0f7fa" /><stop offset="100%" stopColor="#b2ebf2" />
        </linearGradient>
        <linearGradient id="sg" x1="16" y1="78" x2="84" y2="78" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Locked screen ─────────────────────────────────────────────────────────────
function LockedScreen() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "24px", background: "linear-gradient(135deg,#0f172a 0%,#1a1035 50%,#0f172a 100%)", fontFamily: "'Nunito',sans-serif", padding: "40px 20px", textAlign: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap'); @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <KarenMascot size={80} animated />
      <div>
        <div style={{ fontSize: "32px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", marginBottom: "8px" }}>Kare-N</div>
        <div style={{ color: "#64748b", fontSize: "14px" }}>Your AI ops assistant for funeral professionals</div>
      </div>
      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "16px", padding: "24px 32px", maxWidth: "320px" }}>
        <div style={{ fontSize: "24px", marginBottom: "12px" }}>🔒</div>
        <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: "15px", marginBottom: "8px" }}>Access Required</div>
        <div style={{ color: "#64748b", fontSize: "13px", lineHeight: 1.6 }}>Kare-N is a member benefit of The Practitioner community. Your personal access link was sent when you joined.</div>
      </div>
      <div style={{ color: "#334155", fontSize: "12px" }}>Already a member? Check your welcome email for your personal access link.</div>
    </div>
  );
}

// ── Admin panel ───────────────────────────────────────────────────────────────
function AdminPanel() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [members] = useState(Object.entries(VALID_TOKENS).map(([token, data]) => ({ token, ...data })));
  const [newName, setNewName] = useState("");
  const [copied, setCopied] = useState(null);
  const [newTokens, setNewTokens] = useState([]);
  const baseUrl = window.location.origin;

  function handleLogin() {
    if (pw === ADMIN_PASSWORD) { setAuthed(true); setPwError(false); }
    else { setPwError(true); setPw(""); }
  }
  function addMember() {
    if (!newName.trim()) return;
    const token = generateToken();
    setNewTokens(prev => [...prev, { token, name: newName.trim(), createdAt: new Date().toISOString() }]);
    setNewName("");
  }
  function copyUrl(token) {
    navigator.clipboard.writeText(`${baseUrl}?token=${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  const s = {
    page: { minHeight: "100dvh", background: "linear-gradient(135deg,#0f172a 0%,#1a1035 50%,#0f172a 100%)", fontFamily: "'Nunito',sans-serif", color: "#e2e8f0", padding: "24px 20px" },
    card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: "16px", padding: "20px", marginBottom: "16px" },
    input: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "10px", color: "#e2e8f0", padding: "10px 14px", fontSize: "14px", fontFamily: "inherit", outline: "none", width: "100%" },
    label: { fontSize: "11px", color: "#64748b", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, marginBottom: "8px", display: "block" },
  };

  if (!authed) return (
    <div style={{ ...s.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap'); @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <div style={{ width: "100%", maxWidth: "360px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}><KarenMascot size={60} animated /><div style={{ fontSize: "24px", fontWeight: 800, marginTop: "12px", background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Kare-N Admin</div></div>
        <div style={s.card}>
          <label style={s.label}>Admin Password</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Enter password" style={{ ...s.input, marginBottom: "12px", borderColor: pwError ? "#ef4444" : "rgba(167,139,250,0.2)" }} />
          {pwError && <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "12px" }}>Incorrect password.</div>}
          <button onClick={handleLogin} style={{ background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "10px", color: "#fff", padding: "11px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit", fontWeight: 700, width: "100%" }}>Enter</button>
        </div>
      </div>
    </div>
  );

  const allMembers = [...members, ...newTokens];
  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap'); @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}><KarenMascot size={44} /><div><div style={{ fontSize: "20px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Kare-N Admin</div><div style={{ fontSize: "11px", color: "#64748b" }}>{allMembers.length} members</div></div></div>
        <div style={s.card}>
          <label style={s.label}>Add New Member</label>
          <div style={{ display: "flex", gap: "10px" }}><input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addMember()} placeholder="Member name" style={{ ...s.input, flex: 1 }} /><button onClick={addMember} style={{ background: "rgba(34,211,238,0.2)", border: "1px solid rgba(34,211,238,0.4)", borderRadius: "10px", color: "#22d3ee", padding: "9px 18px", cursor: "pointer", fontSize: "13px", fontFamily: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}>+ Add</button></div>
        </div>
        {newTokens.length > 0 && (
          <div style={{ ...s.card, border: "1px solid rgba(34,211,238,0.3)", background: "rgba(34,211,238,0.05)", marginBottom: "16px" }}>
            <label style={{ ...s.label, color: "#22d3ee" }}>⚠ Add to VALID_TOKENS in src/App.jsx</label>
            {newTokens.map(m => <div key={m.token} style={{ fontFamily: "monospace", fontSize: "12px", color: "#94a3b8", marginBottom: "8px", background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "8px" }}>"{m.token}": {"{"} name: "{m.name}" {"}"},</div>)}
          </div>
        )}
        <div style={s.card}>
          <label style={s.label}>All Members</label>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {allMembers.map(member => (
              <div key={member.token} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(167,139,250,0.1)", borderRadius: "12px", padding: "14px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee44,#a78bfa44)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "#a78bfa", flexShrink: 0 }}>{member.name.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: "14px" }}>{member.name}</div><div style={{ fontSize: "10px", color: "#475569", fontFamily: "monospace" }}>{member.token}</div></div>
                <button onClick={() => copyUrl(member.token)} style={{ background: copied === member.token ? "rgba(52,211,153,0.2)" : "rgba(34,211,238,0.1)", border: `1px solid ${copied === member.token ? "#34d399" : "rgba(34,211,238,0.3)"}`, borderRadius: "8px", color: copied === member.token ? "#34d399" : "#22d3ee", padding: "6px 12px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}>{copied === member.token ? "✓ Copied" : "📋 Copy URL"}</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
function KarenMain({ token }) {
  const memberName = VALID_TOKENS[token]?.name?.split(" ")[0] || "there";
  const [tasks, setTasksState] = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [settings, setSettings] = useState(loadSettings(token));
  const [templates, setTemplates] = useState(loadTemplates(token));
  const [documents, setDocuments] = useState(loadDocuments(token));
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [listening, setListening] = useState(false);
  const [expandedTask, setExpandedTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [historyFolder, setHistoryFolder] = useState("all");
  const [movingTask, setMovingTask] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragOverTask, setDragOverTask] = useState(null);
  const [showFamilyIntake, setShowFamilyIntake] = useState(false);
  const [familyIntake, setFamilyIntake] = useState({ name: "", dob: "", dod: "", sex: "", template: "cremation" });
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const startXRef = useRef(null);
  const fileInputRef = useRef(null);

  const darkMode = settings.darkMode;

  // Load tasks
  useEffect(() => {
    loadTasks(token).then(loaded => {
      const withDefaults = loaded.map(t => ({
        ...t,
        dueDate: t.dueDate ? applyDefaultTime(t.dueDate, settings.defaultDueTime) : null,
        subtasks: t.subtasks || [],
        familyName: t.familyName || detectFamilyName(t.title),
        folder: t.folder || null,
        group: t.group || null,
      }));
      setTasksState(withDefaults);
      setTasksLoaded(true);
    });
  }, [token]);

  // Daily briefing
  useEffect(() => {
    if (!tasksLoaded) return;
    const today = new Date().toDateString();
    const lastBriefing = localStorage.getItem(`karen-briefing-${token}`);
    const overdue = tasks.filter(t => t.status === "pending" && isOverdue(t));
    const pending = tasks.filter(t => t.status === "pending");
    const dueToday = tasks.filter(t => {
      if (!t.dueDate || t.status !== "pending") return false;
      return new Date(t.dueDate).toDateString() === today;
    });

    if (lastBriefing === today) {
      setMessages([{ role: "assistant", content: `Hey ${memberName}. What's on your plate?` }]);
      return;
    }
    localStorage.setItem(`karen-briefing-${token}`, today);
    if (tasks.length === 0) {
      setMessages([{ role: "assistant", content: `Good ${getTimeOfDay()} ${memberName}. No tasks yet.\n\nSay "new family" to start a case, or just tell me what you need to do.` }]);
      return;
    }
    let briefing = `Good ${getTimeOfDay()} ${memberName}. Here's where things stand:\n\n`;
    if (overdue.length > 0) briefing += `⚠️ ${overdue.length} overdue — ${overdue.map(t => t.title).join(", ")}\n\n`;
    if (dueToday.length > 0) briefing += `📅 Due today — ${dueToday.map(t => t.title).join(", ")}\n\n`;
    briefing += `${pending.length} total pending. What do you want to tackle first?`;
    setMessages([{ role: "assistant", content: briefing }]);
  }, [tasksLoaded]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // ── Task save/update ──────────────────────────────────────────────────────
  async function saveTasks(t) {
    console.log("SAVING TASKS", token, t.length);
    try {
      const res = await fetch("/api/chat", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, tasks: t }),
      });
      const data = await res.json();
      console.log("SAVE RESULT", data);
    } catch (err) {
      console.log("SAVE ERROR", err);
    }
    try { localStorage.setItem(`karen-tasks-${token}`, JSON.stringify(t)); } catch (_) {}
  }

  function updateTasks(t) {
    const withDefaults = t.map(task => ({
      ...task,
      dueDate: task.dueDate ? applyDefaultTime(task.dueDate, settings.defaultDueTime) : null,
      subtasks: task.subtasks || [],
      familyName: task.familyName || detectFamilyName(task.title),
      folder: task.folder || null,
      group: task.group || null,
    }));
    setTasksState(withDefaults);
    saveTasks(withDefaults);
  }

  // ── Parse AI response ─────────────────────────────────────────────────────
  function parseTasksFromResponse(text) {
    const match = text.match(/%%TASKS_START%%([\s\S]*?)%%TASKS_END%%/);
    if (!match) return null;
    try {
      const p = JSON.parse(match[1].trim());
      if (p.action === "update" && Array.isArray(p.tasks)) return p.tasks;
    } catch (_) {}
    return null;
  }

 function cleanText(text) {
    return text.replace(/%%TASKS_START%%[\s\S]*?%%TASKS_END%%/g, "").trim();
  }
  // ── Send message ──────────────────────────────────────────────────────────
  async function sendMessage(overrideText) {
    const text = (overrideText || input).trim();
    if (!text || loading) return;
    setInput("");
    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);
    const taskContext = tasks.length > 0 ? `Current tasks:\n${JSON.stringify(tasks, null, 2)}` : "No tasks yet.";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: buildSystemPrompt(taskContext, settings.defaultDueTime, templates),
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
     const data = await res.json();
const raw = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "No response.";
setMessages(prev => [...prev, { role: "assistant", content: raw }]);
const reloaded = await loadTasks(token);
if (reloaded.length > 0) updateTasks(reloaded);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Try again." }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  // ── Voice input ───────────────────────────────────────────────────────────
  function toggleVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert("Voice input requires Chrome browser.");
      return;
    }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = "en-US";
    r.onresult = e => { setInput(p => p ? p + " " + e.results[0][0].transcript : e.results[0][0].transcript); setListening(false); };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recognitionRef.current = r;
    r.start();
    setListening(true);
  }

  // ── Task actions ──────────────────────────────────────────────────────────
  function toggleTask(id) {
    updateTasks(tasks.map(t => t.id === id ? { ...t, status: t.status === "done" ? "pending" : "done", completedAt: t.status === "done" ? null : new Date().toISOString() } : t));
  }
  function deleteTask(id) { updateTasks(tasks.filter(t => t.id !== id)); }
  function snoozeTask(id, hours) { updateTasks(tasks.map(t => t.id === id ? { ...t, dueDate: snoozeDate(hours), status: "pending" } : t)); }
  function toggleSubtask(taskId, subId) { updateTasks(tasks.map(t => t.id === taskId ? { ...t, subtasks: t.subtasks.map(s => s.id === subId ? { ...s, done: !s.done } : s) } : t)); }
  function moveToFolder(taskId, folder) { updateTasks(tasks.map(t => t.id === taskId ? { ...t, folder } : t)); setMovingTask(null); }

  // ── Inline editing ────────────────────────────────────────────────────────
  function startEdit(task) {
    setEditingTask(task.id);
    setEditValues({
      title: task.title,
      notes: task.notes || "",
      priority: task.priority,
      category: task.category,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : "",
    });
  }

  function saveEdit(id) {
    updateTasks(tasks.map(t => t.id === id ? {
      ...t,
      title: editValues.title,
      notes: editValues.notes,
      priority: editValues.priority,
      category: editValues.category,
      dueDate: editValues.dueDate ? new Date(editValues.dueDate).toISOString() : null,
    } : t));
    setEditingTask(null);
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────
  function bulkComplete() {
    updateTasks(tasks.map(t => selectedTasks.includes(t.id) ? { ...t, status: "done", completedAt: new Date().toISOString() } : t));
    setSelectedTasks([]); setBulkMode(false);
  }
  function bulkDelete() {
    updateTasks(tasks.filter(t => !selectedTasks.includes(t.id)));
    setSelectedTasks([]); setBulkMode(false);
  }

  // ── Drag to reorder ───────────────────────────────────────────────────────
  function handleDragStart(e, id) { setDraggedTask(id); e.dataTransfer.effectAllowed = "move"; }
  function handleDragOver(e, id) { e.preventDefault(); setDragOverTask(id); }
  function handleDrop(e, id) {
    e.preventDefault();
    if (!draggedTask || draggedTask === id) { setDraggedTask(null); setDragOverTask(null); return; }
    const newTasks = [...tasks];
    const fromIdx = newTasks.findIndex(t => t.id === draggedTask);
    const toIdx = newTasks.findIndex(t => t.id === id);
    const [moved] = newTasks.splice(fromIdx, 1);
    newTasks.splice(toIdx, 0, moved);
    updateTasks(newTasks);
    setDraggedTask(null); setDragOverTask(null);
  }

  // ── Family intake ─────────────────────────────────────────────────────────
  function createFamilyWorkflow() {
    const { name, dob, dod, sex, template: templateId } = familyIntake;
    if (!name.trim()) return;
    const template = templates.find(t => t.id === templateId) || templates[0];
    const newTasks = [];
    let idCounter = Date.now();
    template.groups.forEach(group => {
      group.tasks.forEach(taskTitle => {
        newTasks.push({
          id: String(idCounter++),
          title: `${name} — ${taskTitle}`,
          notes: "",
          priority: group.name === "Death Certificate" || group.name === "Crematory" ? "high" : "medium",
          status: "pending",
          category: "Families",
          createdAt: new Date().toISOString(),
          dueDate: null,
          completedAt: null,
          recurring: null,
          subtasks: [],
          familyName: name.split(" ").pop(),
          folder: null,
          group: group.name,
        });
      });
    });
    updateTasks([...tasks, ...newTasks]);
    setMessages(prev => [...prev,
      { role: "user", content: `New family: ${name}, DOB ${dob}, DOD ${dod}, ${sex}` },
      { role: "assistant", content: `${template.name} workflow created for the ${name.split(" ").pop()} family — ${newTasks.length} tasks logged across ${template.groups.length} groups. Swipe to Tasks to see them.` }
    ]);
    setShowFamilyIntake(false);
    setFamilyIntake({ name: "", dob: "", dod: "", sex: "", template: "cremation" });
    setActiveTab(1);
  }

  // ── Swipe navigation ──────────────────────────────────────────────────────
  function handleTouchStart(e) { startXRef.current = e.touches[0].clientX; }
  function handleTouchEnd(e) {
    if (startXRef.current === null) return;
    const diff = startXRef.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 60) {
      if (diff > 0) setActiveTab(t => Math.min(t + 1, 2));
      else setActiveTab(t => Math.max(t - 1, 0));
    }
    startXRef.current = null;
  }

  // ── Document upload ───────────────────────────────────────────────────────
  function handleDocUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const newDoc = {
        id: String(Date.now()),
        name: file.name,
        type: file.type,
        size: file.size,
        data: ev.target.result,
        uploadedAt: new Date().toISOString(),
        folder: "General",
      };
      const updated = [...documents, newDoc];
      setDocuments(updated);
      saveDocuments(token, updated);
    };
    reader.readAsDataURL(file);
  }

  // ── Computed values ───────────────────────────────────────────────────────
  const pending = tasks.filter(t => t.status === "pending");
  const done = tasks.filter(t => t.status === "done");
  const overdue = pending.filter(isOverdue);
  const categories = [...new Set(tasks.map(t => t.category))];

  let filteredTasks = filter === "all" ? tasks
    : filter === "pending" ? pending
    : filter === "done" ? done
    : filter === "overdue" ? overdue
    : filter === "snoozed" ? tasks.filter(t => t.status === "snoozed")
    : tasks.filter(t => t.category === filter);

  if (search.trim()) filteredTasks = filteredTasks.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    (t.notes || "").toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filteredTasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return 0;
  });

  const doneTasks = tasks.filter(t => t.status === "done");
  const familyFolders = [...new Set(doneTasks.map(t => t.familyName || t.folder).filter(Boolean))];
  const historyFiltered = historyFolder === "all" ? doneTasks
    : historyFolder === "unfiled" ? doneTasks.filter(t => !t.familyName && !t.folder)
    : doneTasks.filter(t => t.familyName === historyFolder || t.folder === historyFolder);

  const thisMonth = new Date().getMonth();
  const thisYear = new Date().getFullYear();
  const monthlyCount = tasks.filter(t => {
    if (t.status !== "done" || !t.completedAt) return false;
    const d = new Date(t.completedAt);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  // ── Theme ─────────────────────────────────────────────────────────────────
  const bg = darkMode ? "linear-gradient(135deg,#0f172a 0%,#1a1035 50%,#0f172a 100%)" : "linear-gradient(135deg,#f0f9ff 0%,#f5f0ff 50%,#f0f9ff 100%)";
  const textColor = darkMode ? "#e2e8f0" : "#1e293b";
  const mutedColor = darkMode ? "#64748b" : "#94a3b8";
  const cardBg = darkMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.8)";
  const cardBorder = darkMode ? "rgba(167,139,250,0.15)" : "rgba(167,139,250,0.3)";
  const inputBg = darkMode ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)";

  const inputStyle = { background: inputBg, border: `1px solid ${cardBorder}`, borderRadius: "10px", color: textColor, padding: "8px 12px", fontSize: "13px", fontFamily: "inherit", outline: "none" };

  return (
    <div style={{ fontFamily: "'Nunito',sans-serif", background: bg, minHeight: "100dvh", color: textColor, display: "flex", flexDirection: "column", maxWidth: "480px", margin: "0 auto", position: "relative", overflow: "hidden" }}
      onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #a78bfa44; border-radius: 2px; }
        textarea, input, select { resize: none; }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        .msg-bubble { animation: fadeUp 0.2s ease-out; }
        .task-row:hover .task-actions { opacity: 1 !important; }
        .send-btn:not(:disabled):hover { transform:scale(1.05); }
        .tab-btn { transition: all 0.15s; }
        .filter-pill { transition: all 0.12s; cursor: pointer; }
        .icon-btn { background:none; border:none; cursor:pointer; padding: 4px; transition: all 0.15s; }
        .icon-btn:hover { transform: scale(1.1); }
        .stat-box { cursor: pointer; transition: all 0.15s; }
        .stat-box:hover { transform: scale(1.04); }
        .drag-over { border-color: #a78bfa !important; background: rgba(167,139,250,0.08) !important; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px", background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)", borderBottom: `1px solid ${cardBorder}`, backdropFilter: "blur(10px)", position: "relative", zIndex: 10, flexShrink: 0 }}>
        <KarenMascot size={40} animated />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "18px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Kare-N</div>
          <div style={{ fontSize: "10px", color: mutedColor }}>Hey {memberName} 👋</div>
        </div>
        <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
          {overdue.length > 0 && (
            <div className="stat-box" onClick={() => { setActiveTab(1); setFilter("overdue"); }} style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "3px 8px", textAlign: "center" }}>
              <div style={{ color: "#ef4444", fontWeight: 700, fontSize: "12px" }}>{overdue.length}</div>
              <div style={{ color: "#ef4444", opacity: 0.7, fontSize: "9px" }}>overdue</div>
            </div>
          )}
          <div className="stat-box" onClick={() => { setActiveTab(1); setFilter("pending"); }} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "8px", padding: "3px 8px", textAlign: "center" }}>
            <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: "12px" }}>{pending.length}</div>
            <div style={{ color: "#a78bfa", opacity: 0.7, fontSize: "9px" }}>pending</div>
          </div>
          <button className="icon-btn" onClick={() => { setShowSettings(true); setSettingsTab("general"); }} style={{ fontSize: "17px" }}>⚙️</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: darkMode ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.5)", borderBottom: `1px solid ${cardBorder}`, position: "relative", zIndex: 10, flexShrink: 0 }}>
        {["Chat", "Tasks", "History"].map((tab, i) => (
          <button key={tab} className="tab-btn" onClick={() => setActiveTab(i)} style={{ flex: 1, padding: "10px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === i ? "#a78bfa" : "transparent"}`, color: activeTab === i ? "#a78bfa" : mutedColor, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", transition: "all 0.2s" }}>
            {tab}{tab === "Tasks" && pending.length > 0 && <span style={{ marginLeft: "4px", background: "rgba(167,139,250,0.2)", color: "#a78bfa", padding: "1px 5px", borderRadius: "10px", fontSize: "9px" }}>{pending.length}</span>}
          </button>
        ))}
        <div style={{ position: "absolute", bottom: "-14px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "4px", zIndex: 5 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ width: i === activeTab ? "14px" : "5px", height: "5px", borderRadius: "3px", background: i === activeTab ? "#a78bfa" : "#334155", transition: "all 0.2s" }} />)}
        </div>
      </div>
      <div style={{ height: "14px", flexShrink: 0 }} />

      {/* ── CHAT ── */}
      {activeTab === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          {/* New family button */}
          <div style={{ padding: "8px 14px 0", flexShrink: 0 }}>
            <button onClick={() => setShowFamilyIntake(true)} style={{ width: "100%", background: "linear-gradient(135deg,#22d3ee22,#a78bfa22)", border: `1px solid ${cardBorder}`, borderRadius: "12px", color: "#a78bfa", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              👨‍👩‍👧 New Family Case
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {messages.map((m, i) => (
              <div key={i} className="msg-bubble" style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: "8px", alignItems: "flex-end" }}>
                {m.role === "assistant" && <div style={{ flexShrink: 0, marginBottom: "2px" }}><KarenMascot size={26} /></div>}
                <div style={{ maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px", background: m.role === "user" ? (darkMode ? "linear-gradient(135deg,#1e3a5f,#1a1045)" : "linear-gradient(135deg,#dbeafe,#ede9fe)") : cardBg, border: `1px solid ${m.role === "user" ? "rgba(34,211,238,0.2)" : cardBorder}`, fontSize: "13px", lineHeight: "1.6", color: m.role === "user" ? (darkMode ? "#bae6fd" : "#1e3a5f") : textColor, whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                <KarenMascot size={26} animated />
                <div style={{ padding: "10px 14px", background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: "4px 18px 18px 18px", display: "flex", gap: "5px", alignItems: "center" }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee,#a78bfa)", animation: `pulse-dot 1.2s ${i * 0.2}s infinite` }} />)}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: "10px 12px", borderTop: `1px solid ${cardBorder}`, background: darkMode ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.9)", backdropFilter: "blur(10px)", display: "flex", gap: "8px", alignItems: "flex-end", flexShrink: 0 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={listening ? "Listening..." : "Tell me what you need to do..."} rows={2}
                style={{ width: "100%", background: inputBg, border: `1px solid ${listening ? "#a78bfa" : cardBorder}`, borderRadius: "14px", color: textColor, padding: "10px 44px 10px 14px", fontSize: "13px", fontFamily: "inherit", outline: "none", lineHeight: "1.5" }} />
              <button onClick={toggleVoice} style={{ position: "absolute", right: "10px", bottom: "10px", width: "26px", height: "26px", borderRadius: "50%", background: listening ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(167,139,250,0.2)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>
                {listening ? "⏹" : "🎙"}
              </button>
            </div>
            <button className="send-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{ width: "40px", height: "40px", borderRadius: "14px", background: loading || !input.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", transition: "all 0.2s", flexShrink: 0 }}>
              {loading ? "⏳" : "✈️"}
            </button>
          </div>
        </div>
      )}

      {/* ── TASKS ── */}
      {activeTab === 1 && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {/* Search + bulk */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search..." style={{ ...inputStyle, flex: 1 }} />
            <button onClick={() => { setBulkMode(!bulkMode); setSelectedTasks([]); }} style={{ ...inputStyle, padding: "8px 10px", cursor: "pointer", color: bulkMode ? "#a78bfa" : mutedColor, fontWeight: 700, fontSize: "11px", whiteSpace: "nowrap", border: `1px solid ${bulkMode ? "#a78bfa" : cardBorder}` }}>
              {bulkMode ? "✕ Cancel" : "☑ Select"}
            </button>
          </div>

          {/* Bulk actions */}
          {bulkMode && selectedTasks.length > 0 && (
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <button onClick={bulkComplete} style={{ flex: 1, background: "rgba(52,211,153,0.2)", border: "1px solid rgba(52,211,153,0.4)", borderRadius: "10px", color: "#34d399", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>✓ Complete ({selectedTasks.length})</button>
              <button onClick={bulkDelete} style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", color: "#ef4444", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>🗑 Delete ({selectedTasks.length})</button>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "10px" }}>
            {["all", "pending", "overdue", "done", ...categories].map(f => (
              <button key={f} className="filter-pill" onClick={() => setFilter(f)} style={{ padding: "3px 10px", background: filter === f ? "linear-gradient(135deg,#22d3ee88,#a78bfa88)" : inputBg, color: filter === f ? "#fff" : mutedColor, border: `1px solid ${filter === f ? "rgba(167,139,250,0.5)" : cardBorder}`, borderRadius: "20px", fontSize: "10px", fontFamily: "inherit", fontWeight: 600, textTransform: "uppercase" }}>
                {f}{f === "overdue" && overdue.length > 0 && <span style={{ marginLeft: "3px", background: "#ef4444", color: "#fff", borderRadius: "10px", padding: "0 4px", fontSize: "8px" }}>{overdue.length}</span>}
              </button>
            ))}
          </div>

          {/* Color legend */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
            {[["#ff006e", "<24h"], ["#ffbe0b", "24-48h"], ["#00b4d8", "48h+"], ["#ef4444", "overdue"], ["#6366f1", "no date"]].map(([c, l]) => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: c }} />
                <span style={{ fontSize: "9px", color: mutedColor, fontWeight: 600 }}>{l}</span>
              </div>
            ))}
          </div>

          {/* Task list */}
          {sorted.length === 0 ? (
            <div style={{ textAlign: "center", marginTop: "40px" }}><KarenMascot size={50} animated /><div style={{ color: mutedColor, fontSize: "13px", marginTop: "12px" }}>{search ? "No match." : tasks.length === 0 ? "No tasks yet.\nSay 'new family' or tell me what you need." : "Nothing here."}</div></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {sorted.map(task => (
                <div key={task.id}
                  draggable
                  onDragStart={e => handleDragStart(e, task.id)}
                  onDragOver={e => handleDragOver(e, task.id)}
                  onDrop={e => handleDrop(e, task.id)}
                  className={`task-row${dragOverTask === task.id ? " drag-over" : ""}`}
                  style={{ background: cardBg, border: `1px solid ${isOverdue(task) ? "rgba(239,68,68,0.2)" : cardBorder}`, borderLeft: `4px solid ${getUrgencyColor(task)}`, borderRadius: "14px", padding: "11px 12px", opacity: task.status === "done" ? 0.45 : draggedTask === task.id ? 0.5 : 1, transition: "all 0.15s", cursor: "grab" }}>

                  {editingTask === task.id ? (
                    // ── Inline edit mode ──
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <input value={editValues.title} onChange={e => setEditValues(v => ({ ...v, title: e.target.value }))} style={{ ...inputStyle, width: "100%", fontWeight: 700 }} />
                      <textarea value={editValues.notes} onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))} placeholder="Notes..." rows={2} style={{ ...inputStyle, width: "100%", lineHeight: "1.4" }} />
                      <div style={{ display: "flex", gap: "6px" }}>
                        <select value={editValues.priority} onChange={e => setEditValues(v => ({ ...v, priority: e.target.value }))} style={{ ...inputStyle, flex: 1 }}>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                        <select value={editValues.category} onChange={e => setEditValues(v => ({ ...v, category: e.target.value }))} style={{ ...inputStyle, flex: 1 }}>
                          {["Operations", "Families", "Compliance", "Admin", "Marketing", "Personal"].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <input type="datetime-local" value={editValues.dueDate} onChange={e => setEditValues(v => ({ ...v, dueDate: e.target.value }))} style={{ ...inputStyle, width: "100%" }} />
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button onClick={() => saveEdit(task.id)} style={{ flex: 1, background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "8px", color: "#fff", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>Save</button>
                        <button onClick={() => setEditingTask(null)} style={{ flex: 1, background: "none", border: `1px solid ${cardBorder}`, borderRadius: "8px", color: mutedColor, padding: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    // ── Normal view ──
                    <div style={{ display: "flex", gap: "9px", alignItems: "flex-start" }}>
                      {bulkMode ? (
                        <button onClick={() => setSelectedTasks(s => s.includes(task.id) ? s.filter(i => i !== task.id) : [...s, task.id])} style={{ width: "19px", height: "19px", minWidth: "19px", borderRadius: "4px", border: `2px solid ${selectedTasks.includes(task.id) ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: selectedTasks.includes(task.id) ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "2px", flexShrink: 0 }}>
                          {selectedTasks.includes(task.id) && <span style={{ fontSize: "9px", color: "#fff", fontWeight: 700 }}>✓</span>}
                        </button>
                      ) : (
                        <button onClick={() => toggleTask(task.id)} style={{ width: "19px", height: "19px", minWidth: "19px", borderRadius: "50%", border: `2px solid ${task.status === "done" ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: task.status === "done" ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "2px", flexShrink: 0 }}>
                          {task.status === "done" && <span style={{ fontSize: "9px", color: "#fff", fontWeight: 700 }}>✓</span>}
                        </button>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: task.status === "done" ? mutedColor : textColor, textDecoration: task.status === "done" ? "line-through" : "none", marginBottom: "2px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}
                          onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                          <span style={{ flex: 1 }}>{task.title}</span>
                          {task.group && <span style={{ fontSize: "8px", color: mutedColor, background: `${cardBorder}`, padding: "1px 5px", borderRadius: "4px" }}>{task.group}</span>}
                          {task.subtasks?.length > 0 && <span style={{ fontSize: "9px", color: mutedColor }}>({task.subtasks.filter(s => s.done).length}/{task.subtasks.length})</span>}
                        </div>

                        {task.dueDate && (
                          <div style={{ fontSize: "11px", fontWeight: 800, color: getUrgencyColor(task), marginBottom: "4px" }}>
                            {formatDueDate(task.dueDate)} at {formatDueTime(task.dueDate)}
                          </div>
                        )}

                        {expandedTask === task.id && (
                          <div style={{ marginBottom: "6px" }}>
                            {task.notes && <div style={{ fontSize: "11px", color: mutedColor, marginBottom: "6px", lineHeight: 1.5 }}>{task.notes}</div>}
                            {task.subtasks?.length > 0 && (
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "6px" }}>
                                {task.subtasks.map(sub => (
                                  <div key={sub.id} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                    <button onClick={() => toggleSubtask(task.id, sub.id)} style={{ width: "14px", height: "14px", minWidth: "14px", borderRadius: "3px", border: `2px solid ${sub.done ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: sub.done ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                      {sub.done && <span style={{ fontSize: "7px", color: "#fff", fontWeight: 700 }}>✓</span>}
                                    </button>
                                    <span style={{ fontSize: "11px", color: sub.done ? mutedColor : textColor, textDecoration: sub.done ? "line-through" : "none" }}>{sub.title}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {task.status === "pending" && (
                              <div style={{ display: "flex", gap: "4px", marginBottom: "4px", flexWrap: "wrap" }}>
                                <span style={{ fontSize: "9px", color: mutedColor, alignSelf: "center" }}>Snooze:</span>
                                {[["1hr", 1], ["4hr", 4], ["12hr", 12]].map(([label, hrs]) => (
                                  <button key={label} onClick={() => snoozeTask(task.id, hrs)} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "6px", color: "#a78bfa", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 700 }}>{label}</button>
                                ))}
                                <button onClick={() => startEdit(task)} style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", borderRadius: "6px", color: "#22d3ee", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 700 }}>✏️ Edit</button>
                              </div>
                            )}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", color: categoryColors[task.category] || mutedColor, background: `${categoryColors[task.category] || mutedColor}18`, border: `1px solid ${categoryColors[task.category] || mutedColor}33`, padding: "1px 6px", borderRadius: "20px" }}>{task.category}</span>
                          <span style={{ fontSize: "9px", fontWeight: 600, color: priorityColors[task.priority], textTransform: "uppercase" }}>{task.priority}</span>
                          {task.familyName && <span style={{ fontSize: "9px", color: "#a78bfa" }}>👨‍👩‍👧 {task.familyName}</span>}
                        </div>
                      </div>

                      <div className="task-actions" style={{ opacity: 0, display: "flex", gap: "2px", flexShrink: 0, transition: "opacity 0.15s", flexDirection: "column", alignItems: "center" }}>
                        <button onClick={() => startEdit(task)} style={{ background: "none", border: "none", color: "#22d3ee", cursor: "pointer", fontSize: "12px", padding: "1px 3px" }}>✏️</button>
                        <button onClick={() => deleteTask(task.id)} style={{ background: "none", border: "none", color: mutedColor, cursor: "pointer", fontSize: "14px", padding: "1px 3px" }}>×</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY ── */}
      {activeTab === 2 && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "12px" }}>
            {["all", "unfiled", ...familyFolders].map(f => (
              <button key={f} className="filter-pill" onClick={() => setHistoryFolder(f)} style={{ padding: "3px 10px", background: historyFolder === f ? "linear-gradient(135deg,#22d3ee88,#a78bfa88)" : inputBg, color: historyFolder === f ? "#fff" : mutedColor, border: `1px solid ${historyFolder === f ? "rgba(167,139,250,0.5)" : cardBorder}`, borderRadius: "20px", fontSize: "10px", fontFamily: "inherit", fontWeight: 600, textTransform: "uppercase" }}>
                {f === "all" ? `All (${doneTasks.length})` : f === "unfiled" ? "Unfiled" : `👨‍👩‍👧 ${f}`}
              </button>
            ))}
          </div>

          {historyFiltered.length === 0 ? (
            <div style={{ textAlign: "center", marginTop: "40px" }}><KarenMascot size={50} animated /><div style={{ color: mutedColor, fontSize: "13px", marginTop: "12px" }}>Nothing here yet.</div></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {historyFiltered.sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt)).map(task => (
                <div key={task.id} style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderLeft: "3px solid #1e293b", borderRadius: "12px", padding: "10px 12px", opacity: 0.65 }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span>✅</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, textDecoration: "line-through", color: mutedColor }}>{task.title}</div>
                      <div style={{ fontSize: "10px", color: mutedColor, marginTop: "2px", display: "flex", gap: "8px" }}>
                        <span>{task.completedAt ? formatDueDate(task.completedAt) : "Completed"}</span>
                        {task.familyName && <span>👨‍👩‍👧 {task.familyName}</span>}
                        {task.folder && <span>📁 {task.folder}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                      <button onClick={() => toggleTask(task.id)} style={{ background: "none", border: `1px solid ${cardBorder}`, borderRadius: "6px", color: "#a78bfa", padding: "2px 6px", cursor: "pointer", fontSize: "9px", fontFamily: "inherit" }}>↩</button>
                      <button onClick={() => setMovingTask(movingTask === task.id ? null : task.id)} style={{ background: "none", border: `1px solid ${cardBorder}`, borderRadius: "6px", color: mutedColor, padding: "2px 6px", cursor: "pointer", fontSize: "9px" }}>📁</button>
                    </div>
                  </div>
                  {movingTask === task.id && (
                    <div style={{ marginTop: "8px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10px", color: mutedColor, alignSelf: "center" }}>Move to:</span>
                      {familyFolders.map(folder => (
                        <button key={folder} onClick={() => moveToFolder(task.id, folder)} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "6px", color: "#a78bfa", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 600 }}>{folder}</button>
                      ))}
                      <div style={{ display: "flex", gap: "3px" }}>
                        <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="New folder..." style={{ ...inputStyle, padding: "2px 7px", fontSize: "10px", width: "90px" }} />
                        {newFolderName && <button onClick={() => moveToFolder(task.id, newFolderName.trim())} style={{ background: "rgba(34,211,238,0.2)", border: "none", borderRadius: "6px", color: "#22d3ee", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 700 }}>✓</button>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS MODAL ── */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ background: darkMode ? "#1a1035" : "#fff", border: `1px solid ${cardBorder}`, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "480px", maxHeight: "88dvh", display: "flex", flexDirection: "column" }}>
            {/* Settings header */}
            <div style={{ padding: "16px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 800, color: textColor }}>⚙️ Settings</div>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: mutedColor, cursor: "pointer", fontSize: "22px" }}>×</button>
            </div>

            {/* Settings tabs */}
            <div style={{ display: "flex", padding: "10px 20px 0", gap: "4px", flexShrink: 0 }}>
              {["general", "templates", "documents"].map(t => (
                <button key={t} onClick={() => setSettingsTab(t)} style={{ flex: 1, padding: "7px", background: settingsTab === t ? "rgba(167,139,250,0.2)" : "none", border: `1px solid ${settingsTab === t ? "#a78bfa" : cardBorder}`, borderRadius: "8px", color: settingsTab === t ? "#a78bfa" : mutedColor, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>
                  {t}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>

              {/* ── General settings ── */}
              {settingsTab === "general" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {/* Monthly count */}
                  <div style={{ background: "linear-gradient(135deg,#22d3ee22,#a78bfa22)", border: `1px solid ${cardBorder}`, borderRadius: "14px", padding: "16px", marginBottom: "8px", textAlign: "center" }}>
                    <div style={{ fontSize: "40px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{monthlyCount}</div>
                    <div style={{ fontSize: "12px", color: mutedColor, fontWeight: 600 }}>tasks completed this month</div>
                  </div>

                  {[
                    {
                      label: "Appearance", sub: "Dark or light theme",
                      control: <button onClick={() => { const s = { ...settings, darkMode: !settings.darkMode }; setSettings(s); saveSettings(token, s); }} style={{ background: settings.darkMode ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(167,139,250,0.2)", border: "none", borderRadius: "20px", padding: "6px 14px", cursor: "pointer", color: settings.darkMode ? "#fff" : "#a78bfa", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{settings.darkMode ? "🌙 Dark" : "☀️ Light"}</button>
                    },
                    {
                      label: "Default Due Time", sub: "Used when no time given",
                      control: <input type="time" value={settings.defaultDueTime} onChange={e => { const s = { ...settings, defaultDueTime: e.target.value }; setSettings(s); saveSettings(token, s); }} style={{ ...inputStyle, padding: "5px 8px" }} />
                    },
                    {
                      label: "Default Category", sub: "Used when none detected",
                      control: <select value={settings.defaultCategory} onChange={e => { const s = { ...settings, defaultCategory: e.target.value }; setSettings(s); saveSettings(token, s); }} style={{ ...inputStyle, padding: "5px 8px" }}>
                        {["Operations", "Families", "Compliance", "Admin", "Marketing", "Personal"].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    },
                  ].map(({ label, sub, control }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${cardBorder}` }}>
                      <div><div style={{ fontSize: "13px", fontWeight: 600, color: textColor }}>{label}</div><div style={{ fontSize: "10px", color: mutedColor }}>{sub}</div></div>
                      {control}
                    </div>
                  ))}

                  {/* Color legend */}
                  <div style={{ padding: "12px 0" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: textColor, marginBottom: "10px" }}>Urgency Colors</div>
                    {[["#ff006e", "Due within 24 hours"], ["#ffbe0b", "Due in 24–48 hours"], ["#00b4d8", "Due in 48+ hours"], ["#ef4444", "Overdue"], ["#6366f1", "No due date"]].map(([color, label]) => (
                      <div key={color} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                        <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: color, flexShrink: 0 }} />
                        <div style={{ fontSize: "11px", color: mutedColor }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Templates ── */}
              {settingsTab === "templates" && (
                <div>
                  <div style={{ fontSize: "12px", color: mutedColor, marginBottom: "14px", lineHeight: 1.5 }}>
                    Tap a template to view or edit. Say "create a [template name] for [family name]" in chat to use one. Talk to Kare-N to create new templates.
                  </div>
                  {templates.map((template, ti) => (
                    <div key={template.id} style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderLeft: `4px solid ${template.color}`, borderRadius: "14px", padding: "14px", marginBottom: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                        <div>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: textColor }}>{template.name}</div>
                          <div style={{ fontSize: "11px", color: mutedColor }}>{template.description}</div>
                        </div>
                        <div style={{ fontSize: "11px", color: template.color, fontWeight: 600 }}>{template.groups.reduce((a, g) => a + g.tasks.length, 0)} tasks</div>
                      </div>
                      {template.groups.map((group, gi) => (
                        <div key={gi} style={{ marginBottom: "8px" }}>
                          <div style={{ fontSize: "10px", fontWeight: 700, color: template.color, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>{group.name}</div>
                          {group.tasks.map((task, tki) => (
                            <div key={tki} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: cardBorder, flexShrink: 0 }} />
                              <input value={task} onChange={e => {
                                const updated = templates.map((t, idx) => idx === ti ? { ...t, groups: t.groups.map((g, gidx) => gidx === gi ? { ...g, tasks: g.tasks.map((tk, tkidx) => tkidx === tki ? e.target.value : tk) } : g) } : t);
                                setTemplates(updated); saveTemplates(token, updated);
                              }} style={{ ...inputStyle, padding: "3px 8px", fontSize: "11px", flex: 1 }} />
                              <button onClick={() => {
                                const updated = templates.map((t, idx) => idx === ti ? { ...t, groups: t.groups.map((g, gidx) => gidx === gi ? { ...g, tasks: g.tasks.filter((_, tkidx) => tkidx !== tki) } : g) } : t);
                                setTemplates(updated); saveTemplates(token, updated);
                              }} style={{ background: "none", border: "none", color: mutedColor, cursor: "pointer", fontSize: "14px", padding: "0 2px" }}>×</button>
                            </div>
                          ))}
                          <button onClick={() => {
                            const updated = templates.map((t, idx) => idx === ti ? { ...t, groups: t.groups.map((g, gidx) => gidx === gi ? { ...g, tasks: [...g.tasks, "New task"] } : g) } : t);
                            setTemplates(updated); saveTemplates(token, updated);
                          }} style={{ background: "none", border: `1px dashed ${cardBorder}`, borderRadius: "6px", color: mutedColor, padding: "2px 8px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", marginTop: "4px" }}>+ Add task</button>
                        </div>
                      ))}
                      <button onClick={() => {
                        const updated = templates.map((t, idx) => idx === ti ? { ...t, groups: [...t.groups, { name: "New Group", tasks: ["Task 1"] }] } : t);
                        setTemplates(updated); saveTemplates(token, updated);
                      }} style={{ background: `${template.color}18`, border: `1px solid ${template.color}44`, borderRadius: "8px", color: template.color, padding: "5px 12px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, marginTop: "4px" }}>+ Add Group</button>
                    </div>
                  ))}
                  <button onClick={() => {
                    const newTemplate = { id: `template-${Date.now()}`, name: "New Template", description: "Custom workflow", color: "#34d399", groups: [{ name: "Group 1", tasks: ["Task 1", "Task 2"] }] };
                    const updated = [...templates, newTemplate];
                    setTemplates(updated); saveTemplates(token, updated);
                  }} style={{ width: "100%", background: "rgba(52,211,153,0.1)", border: "1px dashed rgba(52,211,153,0.4)", borderRadius: "12px", color: "#34d399", padding: "10px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>+ Create New Template</button>
                </div>
              )}

              {/* ── Documents ── */}
              {settingsTab === "documents" && (
                <div>
                  <div style={{ fontSize: "12px", color: mutedColor, marginBottom: "14px", lineHeight: 1.5 }}>
                    Upload your forms, checklists, and documents. Access them anytime from here.
                  </div>
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={handleDocUpload} style={{ display: "none" }} />
                  <button onClick={() => fileInputRef.current?.click()} style={{ width: "100%", background: "rgba(34,211,238,0.1)", border: "1px dashed rgba(34,211,238,0.4)", borderRadius: "12px", color: "#22d3ee", padding: "12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px", marginBottom: "14px" }}>
                    📎 Upload Document
                  </button>

                  {documents.length === 0 ? (
                    <div style={{ textAlign: "center", color: mutedColor, fontSize: "13px", padding: "20px" }}>No documents yet. Upload your first one above.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {documents.map(doc => (
                        <div key={doc.id} style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: "12px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                          <div style={{ fontSize: "22px" }}>{doc.type?.includes("pdf") ? "📄" : doc.type?.includes("image") ? "🖼" : "📝"}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "13px", fontWeight: 600, color: textColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                            <div style={{ fontSize: "10px", color: mutedColor }}>{new Date(doc.uploadedAt).toLocaleDateString()}</div>
                          </div>
                          <div style={{ display: "flex", gap: "4px" }}>
                            <a href={doc.data} download={doc.name} style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", borderRadius: "6px", color: "#22d3ee", padding: "4px 8px", fontSize: "10px", fontWeight: 700, textDecoration: "none" }}>↓</a>
                            <button onClick={() => { const updated = documents.filter(d => d.id !== doc.id); setDocuments(updated); saveDocuments(token, updated); }} style={{ background: "none", border: `1px solid ${cardBorder}`, borderRadius: "6px", color: mutedColor, padding: "4px 8px", cursor: "pointer", fontSize: "12px" }}>×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── FAMILY INTAKE MODAL ── */}
      {showFamilyIntake && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: darkMode ? "#1a1035" : "#fff", border: `1px solid ${cardBorder}`, borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "380px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div style={{ fontSize: "16px", fontWeight: 800, color: textColor }}>👨‍👩‍👧 New Family Case</div>
              <button onClick={() => setShowFamilyIntake(false)} style={{ background: "none", border: "none", color: mutedColor, cursor: "pointer", fontSize: "22px" }}>×</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "10px", color: mutedColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "4px" }}>Full Name *</label>
                <input value={familyIntake.name} onChange={e => setFamilyIntake(f => ({ ...f, name: e.target.value }))} placeholder="First Last" style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "10px", color: mutedColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "4px" }}>Date of Birth</label>
                  <input type="date" value={familyIntake.dob} onChange={e => setFamilyIntake(f => ({ ...f, dob: e.target.value }))} style={{ ...inputStyle, width: "100%" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "10px", color: mutedColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "4px" }}>Date of Death</label>
                  <input type="date" value={familyIntake.dod} onChange={e => setFamilyIntake(f => ({ ...f, dod: e.target.value }))} style={{ ...inputStyle, width: "100%" }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: "10px", color: mutedColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "4px" }}>Sex</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {["Male", "Female", "Other"].map(s => (
                    <button key={s} onClick={() => setFamilyIntake(f => ({ ...f, sex: s }))} style={{ flex: 1, padding: "7px", background: familyIntake.sex === s ? "linear-gradient(135deg,#22d3ee44,#a78bfa44)" : inputBg, border: `1px solid ${familyIntake.sex === s ? "#a78bfa" : cardBorder}`, borderRadius: "8px", color: familyIntake.sex === s ? "#a78bfa" : mutedColor, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: "10px", color: mutedColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "4px" }}>Workflow Template</label>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {templates.map(t => (
                    <button key={t.id} onClick={() => setFamilyIntake(f => ({ ...f, template: t.id }))} style={{ flex: 1, padding: "7px", background: familyIntake.template === t.id ? `${t.color}33` : inputBg, border: `1px solid ${familyIntake.template === t.id ? t.color : cardBorder}`, borderRadius: "8px", color: familyIntake.template === t.id ? t.color : mutedColor, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{t.name}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button onClick={() => setShowFamilyIntake(false)} style={{ flex: 1, background: "none", border: `1px solid ${cardBorder}`, borderRadius: "12px", color: mutedColor, padding: "11px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: "13px" }}>Cancel</button>
              <button onClick={createFamilyWorkflow} disabled={!familyIntake.name.trim()} style={{ flex: 2, background: familyIntake.name.trim() ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: "none", borderRadius: "12px", color: familyIntake.name.trim() ? "#fff" : mutedColor, padding: "11px", cursor: familyIntake.name.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>
                Create Workflow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("loading");
  const [token, setToken] = useState(null);

  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/admin") { setView("admin"); return; }
    const urlToken = getTokenFromURL();
    if (!urlToken) { setView("locked"); return; }
    if (VALID_TOKENS[urlToken]) { setToken(urlToken); setView("app"); }
    else { setView("locked"); }
  }, []);

  if (view === "loading") return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" }}>
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <KarenMascot size={60} animated />
    </div>
  );
  if (view === "admin") return <AdminPanel />;
  if (view === "locked") return <LockedScreen />;
  return <KarenMain token={token} />;
}
