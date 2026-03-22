import React, { useState, useEffect, useRef } from "react";

const VALID_TOKENS = {
  "CLAY-IOK-2026": { name: "Clay Bruggeman" },"JOSE-SEGURA-2026": { name: "Jose Segura" },
};

const ADMIN_PASSWORD = "UndtkR3247K?";

function getTokenFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

function generateToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

const SYSTEM_PROMPT = `You are Kare-N — a sharp, no-fluff AI executive assistant built for independent funeral directors. You help them track tasks, remember follow-ups, and stay organized.

Your behavior:
- When the user mentions something to do, capture it immediately as a task.
- Be direct, candid, and brief. No flattery. No softening. No filler.
- When tasks change, ALWAYS include a JSON block at the end of your response:

\`\`\`tasks
{"action":"update","tasks":[...full updated task array...]}
\`\`\`

If no task changes are needed, do NOT include a tasks block.

Each task: { id, title, notes, priority ("high"/"medium"/"low"), status ("pending"/"done"), category, createdAt, dueDate (ISO string or null) }
Categories: Operations, Families, Compliance, Admin, Marketing, Personal`;

const priorityColors = { high: "#ef4444", medium: "#f59e0b", low: "#94a3b8" };
const categoryColors = {
  Operations: "#22d3ee", Families: "#a78bfa", Compliance: "#f87171",
  Admin: "#94a3b8", Marketing: "#34d399", Personal: "#fb923c",
};

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(task) {
  if (!task.dueDate || task.status === "done") return false;
  return new Date(task.dueDate) < new Date();
}

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

function LockedScreen() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "24px", background: "linear-gradient(135deg, #0f172a 0%, #1a1035 50%, #0f172a 100%)", fontFamily: "'Nunito', sans-serif", padding: "40px 20px", textAlign: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap'); @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }`}</style>
      <KarenMascot size={80} animated />
      <div>
        <div style={{ fontSize: "32px", fontWeight: 800, background: "linear-gradient(90deg, #22d3ee, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", marginBottom: "8px" }}>Kare-N</div>
        <div style={{ color: "#64748b", fontSize: "14px" }}>Your AI ops assistant for funeral professionals</div>
      </div>
      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "16px", padding: "24px 32px", maxWidth: "320px" }}>
        <div style={{ fontSize: "24px", marginBottom: "12px" }}>🔒</div>
        <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: "15px", marginBottom: "8px" }}>Access Required</div>
        <div style={{ color: "#64748b", fontSize: "13px", lineHeight: 1.6 }}>Kare-N is a member benefit of The Practitioner community. Your access link should have been sent when you joined.</div>
      </div>
      <div style={{ color: "#334155", fontSize: "12px" }}>Already a member? Check your welcome email for your personal access link.</div>
    </div>
  );
}

function AdminPanel() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [members, setMembers] = useState(Object.entries(VALID_TOKENS).map(([token, data]) => ({ token, ...data })));
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
    const newMember = { token, name: newName.trim(), createdAt: new Date().toISOString() };
    setMembers(prev => [...prev, newMember]);
    setNewTokens(prev => [...prev, newMember]);
    setNewName("");
  }

  function copyUrl(token) {
    navigator.clipboard.writeText(`${baseUrl}?token=${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  const s = {
    page: { minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1a1035 50%, #0f172a 100%)", fontFamily: "'Nunito', sans-serif", color: "#e2e8f0", padding: "24px 20px" },
    card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: "16px", padding: "20px", marginBottom: "16px" },
    input: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "10px", color: "#e2e8f0", padding: "10px 14px", fontSize: "14px", fontFamily: "inherit", outline: "none", width: "100%" },
    label: { fontSize: "11px", color: "#64748b", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, marginBottom: "8px", display: "block" },
  };

  if (!authed) return (
    <div style={{ ...s.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap'); @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }`}</style>
      <div style={{ width: "100%", maxWidth: "360px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <KarenMascot size={60} animated />
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "12px", background: "linear-gradient(90deg, #22d3ee, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Kare-N Admin</div>
        </div>
        <div style={s.card}>
          <label style={s.label}>Admin Password</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Enter password" style={{ ...s.input, marginBottom: "12px", borderColor: pwError ? "#ef4444" : "rgba(167,139,250,0.2)" }} />
          {pwError && <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "12px" }}>Incorrect password.</div>}
          <button onClick={handleLogin} style={{ background: "linear-gradient(135deg, #22d3ee, #a78bfa)", border: "none", borderRadius: "10px", color: "#fff", padding: "11px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit", fontWeight: 700, width: "100%" }}>Enter</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap'); @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }`}</style>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
          <KarenMascot size={44} />
          <div>
            <div style={{ fontSize: "20px", fontWeight: 800, background: "linear-gradient(90deg, #22d3ee, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Kare-N Admin</div>
            <div style={{ fontSize: "11px", color: "#64748b" }}>{members.length} members</div>
          </div>
        </div>

        <div style={s.card}>
          <label style={s.label}>Add New Member</label>
          <div style={{ display: "flex", gap: "10px" }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addMember()} placeholder="Member name" style={{ ...s.input, flex: 1 }} />
            <button onClick={addMember} style={{ background: "rgba(34,211,238,0.2)", border: "1px solid rgba(34,211,238,0.4)", borderRadius: "10px", color: "#22d3ee", padding: "9px 18px", cursor: "pointer", fontSize: "13px", fontFamily: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}>+ Add</button>
          </div>
        </div>

        {newTokens.length > 0 && (
          <div style={{ ...s.card, border: "1px solid rgba(34,211,238,0.3)", background: "rgba(34,211,238,0.05)", marginBottom: "16px" }}>
            <label style={{ ...s.label, color: "#22d3ee" }}>⚠ New Members — Add these tokens to App.jsx in GitHub</label>
            {newTokens.map(m => (
              <div key={m.token} style={{ fontFamily: "monospace", fontSize: "12px", color: "#94a3b8", marginBottom: "8px", background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "8px" }}>
                "{m.token}": {"{"} name: "{m.name}", createdAt: "{m.createdAt}" {"}"},
              </div>
            ))}
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "8px" }}>Add these lines to the VALID_TOKENS object at the top of src/App.jsx in GitHub, then redeploy.</div>
          </div>
        )}

        <div style={s.card}>
          <label style={s.label}>All Members</label>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {members.map(member => (
              <div key={member.token} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(167,139,250,0.1)", borderRadius: "12px", padding: "14px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg, #22d3ee44, #a78bfa44)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "#a78bfa", flexShrink: 0 }}>
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>{member.name}</div>
                  <div style={{ fontSize: "10px", color: "#475569", fontFamily: "monospace" }}>{member.token}</div>
                </div>
                <button onClick={() => copyUrl(member.token)} style={{ background: copied === member.token ? "rgba(52,211,153,0.2)" : "rgba(34,211,238,0.1)", border: `1px solid ${copied === member.token ? "#34d399" : "rgba(34,211,238,0.3)"}`, borderRadius: "8px", color: copied === member.token ? "#34d399" : "#22d3ee", padding: "6px 12px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}>
                  {copied === member.token ? "✓ Copied" : "📋 Copy URL"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KarenMain({ token }) {
  const TASK_KEY = `karen-tasks-${token}`;
  const [tasks, setTasks] = useState([]);
  const [messages, setMessages] = useState([{ role: "assistant", content: "Hey. What's on your plate — or want me to pull up what's pending?" }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [filter, setFilter] = useState("all");
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TASK_KEY);
      if (saved) setTasks(JSON.parse(saved));
    } catch (_) {}
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  function saveTasks(t) {
    setTasks(t);
    try { localStorage.setItem(TASK_KEY, JSON.stringify(t)); } catch (_) {}
  }

  function parseTasksFromResponse(text) {
    const match = text.match(/```tasks\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      const p = JSON.parse(match[1].trim());
      if (p.action === "update" && Array.isArray(p.tasks)) return p.tasks;
    } catch (_) {}
    return null;
  }

  function cleanText(text) { return text.replace(/```tasks[\s\S]*?```/g, "").trim(); }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);
    const taskContext = tasks.length > 0 ? `\n\nCurrent task list:\n${JSON.stringify(tasks, null, 2)}` : "\n\nNo tasks logged yet.";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT + taskContext,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const raw = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "No response.";
      const updatedTasks = parseTasksFromResponse(raw);
      if (updatedTasks) saveTasks(updatedTasks);
      setMessages(prev => [...prev, { role: "assistant", content: cleanText(raw) }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Try again." }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function toggleTask(id) { saveTasks(tasks.map(t => t.id === id ? { ...t, status: t.status === "done" ? "pending" : "done" } : t)); }
  function deleteTask(id) { saveTasks(tasks.filter(t => t.id !== id)); }

  const pending = tasks.filter(t => t.status === "pending");
  const done = tasks.filter(t => t.status === "done");
  const overdue = pending.filter(isOverdue);
  const categories = [...new Set(tasks.map(t => t.category))];
  const filteredTasks = filter === "all" ? tasks : filter === "pending" ? pending : filter === "done" ? done : filter === "overdue" ? overdue : tasks.filter(t => t.category === filter);
  const sorted = [...filteredTasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return ({ high: 0, medium: 1, low: 2 }[a.priority] || 0) - ({ high: 0, medium: 1, low: 2 }[b.priority] || 0);
  });

  return (
    <div style={{ fontFamily: "'Nunito', sans-serif", background: "linear-gradient(135deg, #0f172a 0%, #1a1035 50%, #0f172a 100%)", minHeight: "100vh", color: "#e2e8f0", display: "flex", flexDirection: "column", maxWidth: "480px", margin: "0 auto", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #a78bfa44; border-radius: 2px; }
        textarea { resize: none; }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        .msg-bubble { animation: fadeUp 0.25s ease-out; }
        .task-row:hover .del-btn { opacity: 1 !important; }
        .send-btn:not(:disabled):hover { transform:scale(1.05); box-shadow:0 0 20px #a78bfa66; }
        .tab-btn:hover { background: rgba(167,139,250,0.08); }
        .filter-pill { transition: all 0.15s; }
        .filter-pill:hover { transform: translateY(-1px); }
      `}</style>

      <div style={{ padding: "16px 20px 12px", display: "flex", alignItems: "center", gap: "12px", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(167,139,250,0.15)", backdropFilter: "blur(10px)", position: "relative", zIndex: 10 }}>
        <KarenMascot size={52} animated />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "22px", fontWeight: 800, background: "linear-gradient(90deg, #22d3ee, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Kare-N</div>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>Your AI ops assistant</div>
        </div>
        <div style={{ display: "flex", gap: "8px", fontSize: "11px", textAlign: "center" }}>
          {overdue.length > 0 && <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "4px 10px" }}><div style={{ color: "#ef4444", fontWeight: 700, fontSize: "14px" }}>{overdue.length}</div><div style={{ color: "#ef4444", opacity: 0.7 }}>overdue</div></div>}
          <div style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "8px", padding: "4px 10px" }}><div style={{ color: "#a78bfa", fontWeight: 700, fontSize: "14px" }}>{pending.length}</div><div style={{ color: "#a78bfa", opacity: 0.7 }}>pending</div></div>
        </div>
      </div>

      <div style={{ display: "flex", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(167,139,250,0.1)", position: "relative", zIndex: 10 }}>
        {["chat", "tasks"].map(tab => (
          <button key={tab} className="tab-btn" onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "12px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === tab ? "#a78bfa" : "transparent"}`, color: activeTab === tab ? "#a78bfa" : "#64748b", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", transition: "all 0.15s" }}>
            {tab}{tab === "tasks" && tasks.length > 0 && <span style={{ marginLeft: "6px", background: "rgba(167,139,250,0.2)", color: "#a78bfa", padding: "1px 7px", borderRadius: "10px", fontSize: "10px" }}>{tasks.length}</span>}
          </button>
        ))}
      </div>

      {activeTab === "chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 5 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
            {messages.map((m, i) => (
              <div key={i} className="msg-bubble" style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: "10px", alignItems: "flex-end" }}>
                {m.role === "assistant" && <div style={{ flexShrink: 0, marginBottom: "2px" }}><KarenMascot size={32} /></div>}
                <div style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px", background: m.role === "user" ? "linear-gradient(135deg, #1e3a5f, #1a1045)" : "rgba(255,255,255,0.05)", border: m.role === "user" ? "1px solid rgba(34,211,238,0.2)" : "1px solid rgba(167,139,250,0.15)", fontSize: "14px", lineHeight: "1.6", color: m.role === "user" ? "#bae6fd" : "#cbd5e1", whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                <KarenMascot size={32} animated />
                <div style={{ padding: "14px 18px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: "4px 18px 18px 18px", display: "flex", gap: "6px", alignItems: "center" }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: "7px", height: "7px", borderRadius: "50%", background: "linear-gradient(135deg, #22d3ee, #a78bfa)", animation: `pulse-dot 1.2s ${i * 0.2}s infinite` }} />)}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(167,139,250,0.1)", background: "rgba(15,23,42,0.8)", backdropFilter: "blur(10px)", display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Tell me what you need to do..." rows={2} style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "14px", color: "#e2e8f0", padding: "10px 14px", fontSize: "14px", fontFamily: "inherit", outline: "none", lineHeight: "1.5" }} />
            <button className="send-btn" onClick={sendMessage} disabled={loading || !input.trim()} style={{ width: "44px", height: "44px", borderRadius: "14px", background: loading || !input.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #22d3ee, #a78bfa)", border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", transition: "all 0.2s", flexShrink: 0 }}>
              {loading ? "⏳" : "✈️"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "tasks" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", position: "relative", zIndex: 5 }}>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
            {["all", "pending", "overdue", "done", ...categories].map(f => (
              <button key={f} className="filter-pill" onClick={() => setFilter(f)} style={{ padding: "5px 14px", background: filter === f ? "linear-gradient(135deg, #22d3ee88, #a78bfa88)" : "rgba(255,255,255,0.04)", color: filter === f ? "#fff" : "#64748b", border: `1px solid ${filter === f ? "rgba(167,139,250,0.5)" : "rgba(255,255,255,0.08)"}`, borderRadius: "20px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                {f}{f === "overdue" && overdue.length > 0 && <span style={{ marginLeft: "5px", background: "#ef4444", color: "#fff", borderRadius: "10px", padding: "0 5px", fontSize: "9px" }}>{overdue.length}</span>}
              </button>
            ))}
          </div>
          {sorted.length === 0 ? (
            <div style={{ textAlign: "center", marginTop: "60px" }}>
              <KarenMascot size={64} animated />
              <div style={{ color: "#334155", fontSize: "13px", marginTop: "16px", fontWeight: 500 }}>{tasks.length === 0 ? "No tasks yet — tell me what you need to do." : "Nothing in this filter."}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {sorted.map(task => (
                <div key={task.id} className="task-row" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${isOverdue(task) ? "rgba(239,68,68,0.3)" : "rgba(167,139,250,0.1)"}`, borderLeft: `3px solid ${task.status === "done" ? "#1e293b" : priorityColors[task.priority]}`, borderRadius: "14px", padding: "14px", display: "flex", gap: "12px", alignItems: "flex-start", opacity: task.status === "done" ? 0.45 : 1, transition: "opacity 0.2s" }}>
                  <button onClick={() => toggleTask(task.id)} style={{ width: "22px", height: "22px", minWidth: "22px", borderRadius: "50%", border: `2px solid ${task.status === "done" ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: task.status === "done" ? "linear-gradient(135deg, #22d3ee, #a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "1px", flexShrink: 0 }}>
                    {task.status === "done" && <span style={{ fontSize: "11px", color: "#fff", fontWeight: 700 }}>✓</span>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: task.status === "done" ? "#475569" : "#f1f5f9", textDecoration: task.status === "done" ? "line-through" : "none", marginBottom: task.notes ? "5px" : "6px" }}>{task.title}</div>
                    {task.notes && <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "8px", lineHeight: 1.5 }}>{task.notes}</div>}
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: categoryColors[task.category] || "#64748b", background: `${categoryColors[task.category] || "#64748b"}18`, border: `1px solid ${categoryColors[task.category] || "#64748b"}33`, padding: "2px 9px", borderRadius: "20px" }}>{task.category}</span>
                      <span style={{ fontSize: "10px", fontWeight: 600, color: priorityColors[task.priority], textTransform: "uppercase" }}>{task.priority}</span>
                      {task.dueDate && <span style={{ fontSize: "10px", color: isOverdue(task) ? "#ef4444" : "#64748b", fontWeight: 600 }}>{isOverdue(task) ? "⚠ " : "📅 "}{formatDate(task.dueDate)}</span>}
                    </div>
                  </div>
                  <button className="del-btn" onClick={() => deleteTask(task.id)} style={{ opacity: 0, background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "16px", padding: "0 4px", transition: "opacity 0.15s", flexShrink: 0 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

  if (view === "loading") return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" }}><KarenMascot size={60} animated /></div>;
  if (view === "admin") return <AdminPanel />;
  if (view === "locked") return <LockedScreen />;
  return <KarenMain token={token} />;
}
