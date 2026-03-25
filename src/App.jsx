import React, { useState, useEffect, useRef } from "react";

// ── Token registry ────────────────────────────────────────────────────────────
const VALID_TOKENS = {
  "CLAY-IOK-2026": { name: "Clay Bruggeman" },
  "JOSE-SEGURA-2026": { name: "Jose Segura" },
};
const ADMIN_PASSWORD = "UndtkR3247K?";

function getTokenFromURL() { return new URLSearchParams(window.location.search).get("token"); }
function generateToken() { const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; return Array.from({ length: 10 }, () => c[Math.floor(Math.random() * c.length)]).join(""); }

// ── Default templates ─────────────────────────────────────────────────────────
const FIRM_TEMPLATES = [
  {
    id: "cremation", name: "Cremation", description: "Standard cremation workflow", color: "#22d3ee",
    groups: [
      { name: "Portal", tasks: ["Invite Sent", "Accepted", "Packet"] },
      { name: "Death Certificate", tasks: ["Input", "Dr. Sig", "Proof", "Release", "Order"] },
      { name: "Obit", tasks: ["Input", "Draft", "Approval", "Publish"] },
      { name: "Crematory", tasks: ["Fingerprint Collected", "DC", "Auth", "ME Auth (if required)"] },
      { name: "Urn", tasks: ["Photo Received", "Design", "Proof", "Print"] },
    ],
  },
  {
    id: "fullservice", name: "Full Service", description: "Full service burial workflow", color: "#a78bfa",
    groups: [
      { name: "Portal", tasks: ["Invite Sent", "Accepted", "Packet"] },
      { name: "Death Certificate", tasks: ["Input", "Dr. Sig", "Proof", "Release", "Order"] },
      { name: "Obit", tasks: ["Input", "Draft", "Approval", "Publish"] },
      { name: "Prep", tasks: ["Embalming", "Cosmetizing", "Dressing", "Casketing"] },
      { name: "Church / Venue", tasks: ["Location Confirmed", "Officiant Contacted", "Officiant Confirmed", "Service Time Agreed", "Facility Access Confirmed"] },
      { name: "Casket", tasks: ["Ordered", "Confirmed"] },
      { name: "Vault", tasks: ["Ordered", "Confirmed"] },
      { name: "Cemetery", tasks: ["Called", "Confirmed"] },
      { name: "Service", tasks: ["Route Planned", "Confirmed"] },
    ],
  },
];

// ── Storage ───────────────────────────────────────────────────────────────────
async function loadTasks(token) {
  try { const r = await fetch(`/api/chat?token=${encodeURIComponent(token)}`); if (r.ok) { const d = await r.json(); if (d.tasks?.length > 0) return d.tasks; } } catch (_) {}
  try { const l = localStorage.getItem(`karen-tasks-${token}`); if (l) return JSON.parse(l); } catch (_) {}
  return [];
}
function getLs(token, key, def) { try { const v = localStorage.getItem(`karen-${key}-${token}`); if (v) return JSON.parse(v); } catch (_) {} return def; }
function setLs(token, key, val) { try { localStorage.setItem(`karen-${key}-${token}`, JSON.stringify(val)); } catch (_) {} }

const defaultSettings = { darkMode: true, defaultDueTime: "10:00", defaultCategory: "Operations", quietMode: false, quietUntil: null, pinEnabled: false, pin: null, endOfDayTime: "18:00", endOfDayEnabled: false, voiceEnabled: true, selectedVoice: null, deadlineReminderMin: 30 };

// ── Time helpers ──────────────────────────────────────────────────────────────
function getUrgencyColor(task) {
  if (task.status === "done") return "#1e293b";
  if (!task.dueDate) return "#6366f1";
  const ms = new Date(task.dueDate) - new Date();
  if (ms < 0) return "#ef4444";
  if (ms < 24 * 3600000) return "#ff006e";
  if (ms < 48 * 3600000) return "#ffbe0b";
  return "#00b4d8";
}
function isUrgent(task) { if (!task.dueDate || task.status !== "pending") return false; return (new Date(task.dueDate) - new Date()) < 24 * 3600000; }
function isOverdue(task) { if (!task.dueDate || task.status === "done") return false; return new Date(task.dueDate) < new Date(); }
function fmtTime(d) { if (!d) return null; return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d), t = new Date(), tom = new Date(t); tom.setDate(t.getDate() + 1);
  if (dt.toDateString() === t.toDateString()) return "Today";
  if (dt.toDateString() === tom.toDateString()) return "Tomorrow";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function snoozeDate(h) { const d = new Date(); d.setHours(d.getHours() + h, 0, 0, 0); return d.toISOString(); }
function applyDefaultTime(iso, dt) {
  if (!iso) return null;
  const d = new Date(iso);
  if (d.getHours() === 0 && d.getMinutes() === 0) { const [h, m] = dt.split(":").map(Number); d.setHours(h, m, 0, 0); }
  return d.toISOString();
}
function detectFamily(title) {
  const p = [/([A-Z][a-z]+)\s+(?:family|case|arrangement|service|funeral|cremation)/i, /(?:Mr|Mrs|Ms|Dr)\.?\s+([A-Z][a-z]+)/i, /(?:for|re:?)\s+([A-Z][a-z]+)/i];
  for (const r of p) { const m = title.match(r); if (m) return m[1]; }
  return null;
}
function getTimeOfDay() { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; }

// ── Voice helper ──────────────────────────────────────────────────────────────
function speak(text, voiceName, quietMode) {
  if (quietMode || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  if (voiceName) { const v = voices.find(v => v.name === voiceName); if (v) utt.voice = v; }
  else { const female = voices.find(v => /female|woman|girl|zira|susan|karen|samantha|victoria|allison|ava|nova/i.test(v.name)); if (female) utt.voice = female; }
  utt.rate = 0.95; utt.pitch = 1.0;
  window.speechSynthesis.speak(utt);
}

function startVoiceInput(onResult, onEnd) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert("Voice input requires Chrome or a Chromium-based browser.");
    return null;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR(); r.continuous = false; r.interimResults = false; r.lang = "en-US";
  r.onresult = e => { onResult(e.results[0][0].transcript); };
  r.onerror = () => onEnd();
  r.onend = () => onEnd();
  r.start();
  return r;
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildPrompt(taskContext, settings, templates, vendorContacts, userProfile) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const profileStr = userProfile ? `\nDIRECTOR PROFILE:\n${JSON.stringify(userProfile, null, 2)}` : "";
  const vendorStr = vendorContacts?.length ? `\nSAVED CONTACTS:\n${vendorContacts.map(v => `${v.name}: ${v.phone}`).join("\n")}` : "";
  return `You are Kare-N — a sharp, no-fluff AI executive assistant for independent funeral directors. Today is ${today}, ${time}.
${profileStr}${vendorStr}

FUNERAL INDUSTRY VOCABULARY — use naturally:
NOK=Next of Kin | Decedent=person who died | Informant=DC info provider | ME/Medical Examiner | Coroner | Officiant | FD=funeral director
DC=death certificate | BPT=burial permit/burial transit permit | Cremation authorization | ME release | GPL=General Price List
First call=initial death notification triggers case | Arrangement=initial family meeting
DI=Direct cremation/burial | Full service | Graveside only | Celebration of life | Visitation/Viewing | Wake | Private family | Committal
Transfer/Removal=moving decedent | Prep=embalming+dressing+cosmetizing+casketing | Casketing | BPT required before transport
At-need=active case | Pre-need=pre-planned | Cash advance | Cremated remains (not ashes) | Cremains | ID tag | Inurnment | Scattering
Ink/Prints=fingerprint collection for jewelry | Arrangement conference=initial family planning meeting

SHORTHAND:
"First call came in for [name]" → new family intake
"ME hold on [name]" → flag case blocked
"DC filed for [name]" → mark DC group complete
"Prep done on [name]" → mark all prep subtasks complete
"Arrangement complete — [name]" → log complete, trigger debrief
"BPT in hand for [name]" → mark burial permit complete
"Ink done on [name]" → mark fingerprint complete
"Quiet mode X hours" → acknowledge quiet mode

BEHAVIOR:
- Capture tasks immediately. Default due time: ${settings.defaultDueTime}.
- Be direct, brief, no flattery. On first message give daily briefing.
- When user gives family name + service type, spin up workflow.
- Auto-assign tasks to correct family case when name detected.
- Available templates: ${templates.map(t => t.name).join(", ")}.
- When arrangement task checked complete, immediately ask for debrief conversationally.
- Extract contacts, tasks, sensitivities, special requests from debrief naturally.
- Support template modifications — update personal template and confirm saved.

When tasks change output EXACTLY:
TASK_DATA_START
{"action":"update","tasks":[FULL_ARRAY]}
TASK_DATA_END

Task fields: { id, title, notes, priority, status, category, createdAt, dueDate, completedAt, recurring, subtasks, familyName, caseId, folder, group, lastActivity, phone, isArrangementTask, debriefDone }
Priority: "high"|"medium"|"low". Status: "pending"|"done"|"snoozed".
Categories: Operations, Families, Compliance, Admin, Marketing, Personal

${taskContext}`;
}

const priColors = { high: "#ef4444", medium: "#f59e0b", low: "#94a3b8" };
const catColors = { Operations: "#22d3ee", Families: "#a78bfa", Compliance: "#f87171", Admin: "#94a3b8", Marketing: "#34d399", Personal: "#fb923c" };

// ── Mascot ────────────────────────────────────────────────────────────────────
function KarenMascot({ size = 48, animated = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={animated ? { animation: "float 3s ease-in-out infinite" } : {}}>
      <ellipse cx="50" cy="78" rx="34" ry="10" fill="url(#sg)" opacity="0.7" />
      <rect x="22" y="28" width="56" height="52" rx="28" fill="url(#hg)" />
      <ellipse cx="38" cy="38" rx="10" ry="7" fill="white" opacity="0.25" transform="rotate(-20 38 38)" />
      <rect x="28" y="34" width="44" height="36" rx="20" fill="url(#fg)" />
      <path d="M32 36 Q50 20 68 36" stroke="#22d3ee" strokeWidth="5" strokeLinecap="round" fill="none" />
      <ellipse cx="40" cy="48" rx="5" ry="5.5" fill="#1e3a5f" /><ellipse cx="60" cy="48" rx="5" ry="5.5" fill="#1e3a5f" />
      <ellipse cx="41.5" cy="46.5" rx="1.5" ry="1.5" fill="white" /><ellipse cx="61.5" cy="46.5" rx="1.5" ry="1.5" fill="white" />
      <path d="M43 57 Q50 63 57 57" stroke="#1e3a5f" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <ellipse cx="36" cy="56" rx="4" ry="2.5" fill="#f9a8d4" opacity="0.5" /><ellipse cx="64" cy="56" rx="4" ry="2.5" fill="#f9a8d4" opacity="0.5" />
      <path d="M22 48 Q22 24 50 24 Q78 24 78 48" stroke="#1e40af" strokeWidth="5" fill="none" strokeLinecap="round" />
      <ellipse cx="22" cy="50" rx="7" ry="9" fill="#1e40af" /><ellipse cx="22" cy="50" rx="4" ry="6" fill="#22d3ee" />
      <ellipse cx="78" cy="50" rx="7" ry="9" fill="#1e40af" /><ellipse cx="78" cy="50" rx="4" ry="6" fill="#22d3ee" />
      <path d="M28 60 Q18 65 20 72" stroke="#1e40af" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="20" cy="73" r="3" fill="#22d3ee" />
      <rect x="30" y="74" width="40" height="8" rx="4" fill="#1e40af" /><rect x="42" y="75" width="16" height="5" rx="2.5" fill="#22d3ee" />
      <path d="M50 14 C50 14 46 10 43 12 C40 14 40 18 43 20 L50 26 L57 20 C60 18 60 14 57 12 C54 10 50 14 50 14Z" fill="#22d3ee" opacity="0.9" />
      <path d="M80 20 L81.5 16 L83 20 L87 21.5 L83 23 L81.5 27 L80 23 L76 21.5Z" fill="#a78bfa" opacity="0.8" />
      <path d="M14 32 L15 30 L16 32 L18 33 L16 34 L15 36 L14 34 L12 33Z" fill="#22d3ee" opacity="0.7" />
      <defs>
        <linearGradient id="hg" x1="22" y1="28" x2="78" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#1e3a8a" /><stop offset="100%" stopColor="#1e40af" /></linearGradient>
        <linearGradient id="fg" x1="28" y1="34" x2="72" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#e0f7fa" /><stop offset="100%" stopColor="#b2ebf2" /></linearGradient>
        <linearGradient id="sg" x1="16" y1="78" x2="84" y2="78" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#a78bfa" /></linearGradient>
      </defs>
    </svg>
  );
}

// ── Locked ────────────────────────────────────────────────────────────────────
function LockedScreen() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "24px", background: "linear-gradient(135deg,#0f172a,#1a1035,#0f172a)", fontFamily: "'Nunito',sans-serif", padding: "40px 20px", textAlign: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <KarenMascot size={80} animated />
      <div>
        <div style={{ fontSize: "32px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: "8px" }}>Kare-N</div>
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

// ── Admin ─────────────────────────────────────────────────────────────────────
function AdminPanel() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState(""); const [pwErr, setPwErr] = useState(false);
  const [members] = useState(Object.entries(VALID_TOKENS).map(([token, data]) => ({ token, ...data })));
  const [newName, setNewName] = useState(""); const [copied, setCopied] = useState(null); const [newTokens, setNewTokens] = useState([]);
  const baseUrl = window.location.origin;
  function login() { if (pw === ADMIN_PASSWORD) setAuthed(true); else { setPwErr(true); setPw(""); } }
  function add() { if (!newName.trim()) return; const t = generateToken(); setNewTokens(p => [...p, { token: t, name: newName.trim() }]); setNewName(""); }
  function copy(t) { navigator.clipboard.writeText(`${baseUrl}?token=${t}`); setCopied(t); setTimeout(() => setCopied(null), 2000); }
  const s = { page: { minHeight: "100dvh", background: "linear-gradient(135deg,#0f172a,#1a1035,#0f172a)", fontFamily: "'Nunito',sans-serif", color: "#e2e8f0", padding: "24px 20px" }, card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: "16px", padding: "20px", marginBottom: "16px" }, inp: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "10px", color: "#e2e8f0", padding: "10px 14px", fontSize: "14px", fontFamily: "inherit", outline: "none", width: "100%" } };
  if (!authed) return (
    <div style={{ ...s.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <div style={{ width: "100%", maxWidth: "360px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}><KarenMascot size={60} animated /><div style={{ fontSize: "24px", fontWeight: 800, marginTop: "12px", background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Kare-N Admin</div></div>
        <div style={s.card}><input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="Admin password" style={{ ...s.inp, marginBottom: "12px", borderColor: pwErr ? "#ef4444" : "rgba(167,139,250,0.2)" }} />{pwErr && <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "12px" }}>Incorrect.</div>}<button onClick={login} style={{ background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "10px", color: "#fff", padding: "11px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit", fontWeight: 700, width: "100%" }}>Enter</button></div>
      </div>
    </div>
  );
  const all = [...members, ...newTokens];
  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}><KarenMascot size={44} /><div><div style={{ fontSize: "20px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Kare-N Admin</div><div style={{ fontSize: "11px", color: "#64748b" }}>{all.length} members</div></div></div>
        <div style={s.card}><div style={{ display: "flex", gap: "10px" }}><input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="New member name" style={{ ...s.inp, flex: 1 }} /><button onClick={add} style={{ background: "rgba(34,211,238,0.2)", border: "1px solid rgba(34,211,238,0.4)", borderRadius: "10px", color: "#22d3ee", padding: "9px 18px", cursor: "pointer", fontSize: "13px", fontFamily: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}>+ Add</button></div></div>
        {newTokens.length > 0 && <div style={{ ...s.card, border: "1px solid rgba(34,211,238,0.3)", background: "rgba(34,211,238,0.05)", marginBottom: "16px" }}><div style={{ fontSize: "11px", color: "#22d3ee", fontWeight: 700, marginBottom: "8px" }}>⚠ Add to VALID_TOKENS in src/App.jsx</div>{newTokens.map(m => <div key={m.token} style={{ fontFamily: "monospace", fontSize: "12px", color: "#94a3b8", marginBottom: "8px", background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "8px" }}>"{m.token}": {"{"} name: "{m.name}" {"}"},</div>)}</div>}
        <div style={s.card}><div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>{all.map(m => <div key={m.token} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(167,139,250,0.1)", borderRadius: "12px", padding: "14px 16px", display: "flex", alignItems: "center", gap: "12px" }}><div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee44,#a78bfa44)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "#a78bfa", flexShrink: 0 }}>{m.name.charAt(0)}</div><div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: "14px" }}>{m.name}</div><div style={{ fontSize: "10px", color: "#475569", fontFamily: "monospace" }}>{m.token}</div></div><button onClick={() => copy(m.token)} style={{ background: copied === m.token ? "rgba(52,211,153,0.2)" : "rgba(34,211,238,0.1)", border: `1px solid ${copied === m.token ? "#34d399" : "rgba(34,211,238,0.3)"}`, borderRadius: "8px", color: copied === m.token ? "#34d399" : "#22d3ee", padding: "6px 12px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}>{copied === m.token ? "✓ Copied" : "📋 Copy URL"}</button></div>)}</div></div>
      </div>
    </div>
  );
}

// ── PIN Lock ──────────────────────────────────────────────────────────────────
function PinLock({ settings, onUnlock }) {
  const [entered, setEntered] = useState("");
  const [error, setError] = useState(false);
  function check(val) { if (val === settings.pin) { onUnlock(); } else { setError(true); setEntered(""); setTimeout(() => setError(false), 1000); } }
  function tap(d) { const n = entered + d; setEntered(n); if (n.length === 4) check(n); }
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0f172a,#1a1035,#0f172a)", fontFamily: "'Nunito',sans-serif", gap: "32px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <KarenMascot size={60} animated />
      <div style={{ fontSize: "16px", fontWeight: 700, color: "#94a3b8" }}>Enter PIN</div>
      <div style={{ display: "flex", gap: "16px" }}>{[0, 1, 2, 3].map(i => <div key={i} style={{ width: "16px", height: "16px", borderRadius: "50%", background: i < entered.length ? (error ? "#ef4444" : "#a78bfa") : "rgba(255,255,255,0.1)", transition: "all .2s" }} />)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((d, i) => (
          <button key={i} onClick={() => { if (d === "⌫") setEntered(p => p.slice(0, -1)); else if (d !== "") tap(String(d)); }} disabled={d === ""}
            style={{ width: "72px", height: "72px", borderRadius: "50%", background: d === "" ? "transparent" : "rgba(255,255,255,0.06)", border: d === "" ? "none" : "1px solid rgba(167,139,250,0.15)", color: "#e2e8f0", fontSize: d === "⌫" ? "18px" : "22px", fontWeight: 600, cursor: d === "" ? "default" : "pointer", fontFamily: "inherit" }}>{d}</button>
        ))}
      </div>
    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────────────────────
function Onboarding({ token, onComplete }) {
  const [messages, setMessages] = useState([{ role: "assistant", content: `Hey! I'm Kare-N. Before we get started, I want to make sure I'm set up for how you actually work. Just a few quick questions — you can type or speak your answers.\n\nFirst — what state are you licensed in?` }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const r = startVoiceInput(
      transcript => { setInput(p => p ? p + " " + transcript : transcript); setListening(false); },
      () => setListening(false)
    );
    if (r) { recognitionRef.current = r; setListening(true); }
  }

  const ONBOARDING_PROMPT = `You are Kare-N setting up a new funeral director's profile. Ask questions ONE AT A TIME in a warm, conversational way. After each answer acknowledge it naturally before asking the next.

Questions to ask in order:
1. What state are they licensed in? (If NC, note they use NC DAVE for death certificates)
2. Service mix — mostly cremation, mostly burial, or a mix?
3. If cremation/mixed: what crematory do they use primarily?
4. If burial/mixed: what casket supplier? What vault supplier?
5. Do they handle their own transfers or use a removal service?
6. In-house memorial products (urns, jewelry) or outsource?
7. Do they handle their own obituaries?
8. What family portal or CRM do they use? (Gather, Passare, etc.)
9. Solo operator or part of a firm?
10. Do they want a separate number for family calls? (Mention Google Voice)

When you have enough information (after ~7-8 exchanges), say EXACTLY:
ONBOARDING_COMPLETE
{"state":"...","serviceMix":"...","crematory":"...","casketSupplier":"...","vaultSupplier":"...","transfers":"...","memorialProducts":"...","obituaries":"...","crm":"...","firmType":"...","separateNumber":"..."}
ONBOARDING_COMPLETE

Then tell them their personal workflow is ready and invite them to create their first family case.`;

  async function send() {
    const text = input.trim(); if (!text || loading) return;
    setInput("");
    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, model: "claude-sonnet-4-20250514", max_tokens: 500, system: ONBOARDING_PROMPT, messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const raw = data.cleanedText || data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      const match = raw.match(/ONBOARDING_COMPLETE\s*([\s\S]*?)\s*ONBOARDING_COMPLETE/);
      if (match) {
        try {
          const p = JSON.parse(match[1].trim());
          // Save to Blob so it persists across ALL devices
          await fetch("/api/chat", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, type: "onboarding", profile: p }),
          });
          // Also save locally as fallback
          setLs(token, "profile", p);
          localStorage.setItem(`karen-onboarded-${token}`, "true");
          onComplete(p);
          return;
        } catch (_) {}
      }
      const clean = raw.replace(/ONBOARDING_COMPLETE[\s\S]*?ONBOARDING_COMPLETE/g, "").trim();
      setMessages(prev => [...prev, { role: "assistant", content: clean }]);
    } catch { setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Try again." }]); }
    finally { setLoading(false); inputRef.current?.focus(); }
  }

  return (
    <div style={{ minHeight: "100dvh", background: "linear-gradient(135deg,#0f172a,#1a1035,#0f172a)", fontFamily: "'Nunito',sans-serif", color: "#e2e8f0", display: "flex", flexDirection: "column", maxWidth: "480px", margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#a78bfa44;border-radius:2px}textarea{resize:none}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes pd{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}`}</style>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid rgba(167,139,250,0.15)" }}>
        <KarenMascot size={44} animated />
        <div>
          <div style={{ fontSize: "20px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Welcome to Kare-N</div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>Let's get you set up — type or speak your answers</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: "8px", alignItems: "flex-end" }}>
            {m.role === "assistant" && <KarenMascot size={26} />}
            <div style={{ maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px", background: m.role === "user" ? "linear-gradient(135deg,#1e3a5f,#1a1045)" : "rgba(255,255,255,0.05)", border: `1px solid ${m.role === "user" ? "rgba(34,211,238,0.2)" : "rgba(167,139,250,0.15)"}`, fontSize: "13px", lineHeight: "1.6", color: m.role === "user" ? "#bae6fd" : "#cbd5e1", whiteSpace: "pre-wrap" }}>{m.content}</div>
          </div>
        ))}
        {loading && <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}><KarenMascot size={26} animated /><div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: "4px 18px 18px 18px", display: "flex", gap: "5px", alignItems: "center" }}>{[0, 1, 2].map(i => <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee,#a78bfa)", animation: `pd 1.2s ${i * 0.2}s infinite` }} />)}</div></div>}
        <div ref={chatEndRef} />
      </div>
      <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(167,139,250,0.1)", background: "rgba(15,23,42,0.9)", display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={listening ? "Listening..." : "Type or speak your answer..."}
            rows={2} style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: `1px solid ${listening ? "#a78bfa" : "rgba(167,139,250,0.2)"}`, borderRadius: "14px", color: "#e2e8f0", padding: "10px 44px 10px 14px", fontSize: "13px", fontFamily: "inherit", outline: "none", lineHeight: "1.5" }} />
          <button onClick={toggleVoice} style={{ position: "absolute", right: "10px", bottom: "10px", width: "26px", height: "26px", borderRadius: "50%", background: listening ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(167,139,250,0.2)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>{listening ? "⏹" : "🎙"}</button>
        </div>
        <button onClick={send} disabled={loading || !input.trim()} style={{ width: "40px", height: "40px", borderRadius: "14px", background: loading || !input.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", flexShrink: 0 }}>{loading ? "⏳" : "✈️"}</button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
function KarenMain({ token }) {
  const memberName = VALID_TOKENS[token]?.name?.split(" ")[0] || "there";
  const [tasks, setTasksState] = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [settings, setSettingsState] = useState(getLs(token, "settings", defaultSettings));
  const [templates, setTemplates] = useState(getLs(token, "templates", FIRM_TEMPLATES));
  const [documents, setDocuments] = useState(getLs(token, "docs", []));
  const [vendorContacts, setVendorContacts] = useState(getLs(token, "vendors", []));
  const [userProfile] = useState(getLs(token, "profile", null));
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [openCase, setOpenCase] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [listening, setListening] = useState(false);
  const [expandedTask, setExpandedTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [historyFolder, setHistoryFolder] = useState("all");
  const [movingTask, setMovingTask] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showFamilyIntake, setShowFamilyIntake] = useState(false);
  const [familyIntake, setFamilyIntake] = useState({ name: "", dob: "", dod: "", sex: "", template: "cremation" });
  const [feedback, setFeedback] = useState(""); const [feedbackSent, setFeedbackSent] = useState(false);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [pendingDebrief, setPendingDebrief] = useState(null);
  const [showQuietMode, setShowQuietMode] = useState(false);
  const [newVendorName, setNewVendorName] = useState(""); const [newVendorPhone, setNewVendorPhone] = useState("");
  const [expandedGroups, setExpandedGroups] = useState({});
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const startXRef = useRef(null);
  const fileInputRef = useRef(null);
  const darkMode = settings.darkMode;
  const quietMode = settings.quietMode && settings.quietUntil && new Date(settings.quietUntil) > new Date();

  function updateSettings(updates) { const s = { ...settings, ...updates }; setSettingsState(s); setLs(token, "settings", s); }

  useEffect(() => {
    function loadVoices() { setAvailableVoices(window.speechSynthesis?.getVoices() || []); }
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    loadTasks(token).then(loaded => { setTasksState(loaded.map(n)); setTasksLoaded(true); });
  }, [token]);

  function n(t) { return { ...t, dueDate: t.dueDate ? applyDefaultTime(t.dueDate, settings.defaultDueTime) : null, subtasks: t.subtasks || [], familyName: t.familyName || detectFamily(t.title), caseId: t.caseId || (detectFamily(t.title) ? detectFamily(t.title).toLowerCase() : null), folder: t.folder || null, group: t.group || null, lastActivity: t.lastActivity || t.completedAt || t.createdAt }; }

  useEffect(() => {
    if (!tasksLoaded) return;
    const today = new Date().toDateString();
    const last = localStorage.getItem(`karen-briefing-${token}`);
    const overdue = tasks.filter(t => t.status === "pending" && isOverdue(t));
    const urgent = tasks.filter(t => t.status === "pending" && isUrgent(t));
    const debriefNeeded = tasks.find(t => t.isArrangementTask && t.status === "done" && !t.debriefDone);
    if (debriefNeeded) setPendingDebrief(debriefNeeded);
    if (last === today) { setMessages([{ role: "assistant", content: `Hey ${memberName}. What's on your plate?` }]); return; }
    localStorage.setItem(`karen-briefing-${token}`, today);
    if (tasks.length === 0) { setMessages([{ role: "assistant", content: `Good ${getTimeOfDay()} ${memberName}. No tasks yet.\n\nTap "New Family Case" to start a case, or tell me what you need to do.` }]); return; }
    let b = `Good ${getTimeOfDay()} ${memberName}.\n\n`;
    if (overdue.length > 0) b += `⚠️ ${overdue.length} overdue — ${overdue.map(t => t.title).join(", ")}\n\n`;
    if (urgent.length > 0) b += `🔴 ${urgent.length} due today — ${urgent.map(t => t.title).join(", ")}\n\n`;
    if (debriefNeeded) b += `📋 Ready to debrief the ${debriefNeeded.familyName || ""} arrangement when you are.\n\n`;
    const cases = [...new Set(tasks.filter(t => t.caseId && t.status === "pending").map(t => t.familyName))].filter(Boolean);
    if (cases.length > 0) b += `📁 Active cases: ${cases.join(", ")}\n\n`;
    b += `${tasks.filter(t => t.status === "pending").length} total pending.`;
    setMessages([{ role: "assistant", content: b }]);
  }, [tasksLoaded]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function saveTasks(t) {
    try { await fetch("/api/chat", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, tasks: t }) }); } catch (_) {}
    try { localStorage.setItem(`karen-tasks-${token}`, JSON.stringify(t)); } catch (_) {}
  }

  function updateTasks(t) { const normalized = t.map(n); setTasksState(normalized); saveTasks(normalized); }

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
        body: JSON.stringify({ token, model: "claude-sonnet-4-20250514", max_tokens: 1500, system: buildPrompt(taskContext, settings, templates, vendorContacts, userProfile), messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const responseText = data.cleanedText || data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "No response.";
      if (data.tasksSaved) { const reloaded = await loadTasks(token); if (reloaded.length > 0) { const nm = reloaded.map(n); setTasksState(nm); try { localStorage.setItem(`karen-tasks-${token}`, JSON.stringify(nm)); } catch (_) {} } }
      setMessages(prev => [...prev, { role: "assistant", content: responseText }]);
    } catch { setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Try again." }]); }
    finally { setLoading(false); inputRef.current?.focus(); }
  }

  function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const r = startVoiceInput(
      transcript => { setInput(p => p ? p + " " + transcript : transcript); setListening(false); },
      () => setListening(false)
    );
    if (r) { recognitionRef.current = r; setListening(true); }
  }

  function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    const newStatus = task?.status === "done" ? "pending" : "done";
    updateTasks(tasks.map(t => t.id === id ? { ...t, status: newStatus, completedAt: newStatus === "done" ? new Date().toISOString() : null, lastActivity: new Date().toISOString() } : t));
    if (newStatus === "done" && task?.isArrangementTask && !task?.debriefDone) {
      setPendingDebrief(task);
      setTimeout(() => { setMessages(prev => [...prev, { role: "assistant", content: `How'd the ${task.familyName || ""} arrangement go? Tell me what I need to know.` }]); setActiveTab(0); }, 500);
    }
  }

  function deleteTask(id) { updateTasks(tasks.filter(t => t.id !== id)); }
  function snoozeTask(id, h) { updateTasks(tasks.map(t => t.id === id ? { ...t, dueDate: snoozeDate(h), status: "pending", lastActivity: new Date().toISOString() } : t)); }
  function toggleSubtask(tid, sid) { updateTasks(tasks.map(t => t.id === tid ? { ...t, subtasks: t.subtasks.map(s => s.id === sid ? { ...s, done: !s.done } : s), lastActivity: new Date().toISOString() } : t)); }
  function closeCase(caseId) { if (!window.confirm(`Move all ${caseId} family tasks to History?`)) return; updateTasks(tasks.map(t => t.caseId === caseId ? { ...t, status: "done", completedAt: t.completedAt || new Date().toISOString(), lastActivity: new Date().toISOString() } : t)); setOpenCase(null); }
  function deleteCase(caseId) { if (!window.confirm(`Delete all tasks for the ${caseId} family? Cannot be undone.`)) return; updateTasks(tasks.filter(t => t.caseId !== caseId)); setOpenCase(null); }
  function startEdit(task) { setEditingTask(task.id); setEditValues({ title: task.title, notes: task.notes || "", priority: task.priority, category: task.category, dueDate: task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : "", phone: task.phone || "" }); }
  function saveEdit(id) { updateTasks(tasks.map(t => t.id === id ? { ...t, ...editValues, dueDate: editValues.dueDate ? new Date(editValues.dueDate).toISOString() : null, lastActivity: new Date().toISOString() } : t)); setEditingTask(null); }

  function createFamilyWorkflow() {
    const { name, dob, dod, sex, template: tid } = familyIntake;
    if (!name.trim()) return;
    const tmpl = templates.find(t => t.id === tid) || templates[0];
    const caseId = name.split(" ").pop().toLowerCase();
    const familyName = name.split(" ").pop();
    const newTasks = [{ id: String(Date.now()), title: `${name} — Arrangement Conference`, notes: "", priority: "high", status: "pending", category: "Families", createdAt: new Date().toISOString(), dueDate: null, completedAt: null, recurring: null, subtasks: [], familyName, caseId, folder: null, group: "Arrangement", lastActivity: new Date().toISOString(), phone: null, isArrangementTask: true, debriefDone: false }];
    let idC = Date.now() + 1;
    tmpl.groups.forEach(g => g.tasks.forEach(taskTitle => { newTasks.push({ id: String(idC++), title: `${name} — ${taskTitle}`, notes: "", priority: ["Death Certificate", "Crematory", "Prep"].includes(g.name) ? "high" : "medium", status: "pending", category: "Families", createdAt: new Date().toISOString(), dueDate: null, completedAt: null, recurring: null, subtasks: [], familyName, caseId, folder: null, group: g.name, lastActivity: new Date().toISOString(), phone: null, isArrangementTask: false, debriefDone: false }); }));
    updateTasks([...tasks, ...newTasks]);
    setMessages(prev => [...prev, { role: "user", content: `New family: ${name}${dob ? `, DOB ${dob}` : ""}${dod ? `, DOD ${dod}` : ""}${sex ? `, ${sex}` : ""}` }, { role: "assistant", content: `${tmpl.name} workflow created for the ${familyName} family — ${newTasks.length} tasks. Tap the ${familyName} case folder in Tasks to see them.` }]);
    setShowFamilyIntake(false); setFamilyIntake({ name: "", dob: "", dod: "", sex: "", template: "cremation" }); setActiveTab(1);
  }

  function activateQuietMode(hours) { const until = new Date(); until.setHours(until.getHours() + hours); updateSettings({ quietMode: true, quietUntil: until.toISOString() }); setShowQuietMode(false); }
  function sendFeedback() { if (!feedback.trim()) return; const log = getLs(token, "feedback", []); log.push({ id: String(Date.now()), text: feedback, createdAt: new Date().toISOString() }); setLs(token, "feedback", log); setFeedbackSent(true); setFeedback(""); setTimeout(() => setFeedbackSent(false), 2000); }
  function handleDocUpload(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = ev => { const nd = { id: String(Date.now()), name: file.name, type: file.type, data: ev.target.result, uploadedAt: new Date().toISOString() }; const u = [...documents, nd]; setDocuments(u); setLs(token, "docs", u); }; reader.readAsDataURL(file); }

  function handleTouchStart(e) { startXRef.current = e.touches[0].clientX; }
  function handleTouchEnd(e) { if (startXRef.current === null) return; const diff = startXRef.current - e.changedTouches[0].clientX; if (Math.abs(diff) > 120) { if (diff > 0) setActiveTab(t => Math.min(t + 1, 2)); else setActiveTab(t => Math.max(t - 1, 0)); } startXRef.current = null; }

  const pending = tasks.filter(t => t.status === "pending");
  const done = tasks.filter(t => t.status === "done");
  const overdue = pending.filter(isOverdue);
  const urgentAll = pending.filter(isUrgent);
  const urgentGeneral = urgentAll.filter(t => !t.caseId);
  const urgentCase = urgentAll.filter(t => t.caseId);
  const caseMap = {};
  tasks.filter(t => t.caseId).forEach(t => { if (!caseMap[t.caseId]) caseMap[t.caseId] = { caseId: t.caseId, familyName: t.familyName, tasks: [], lastActivity: t.lastActivity || t.createdAt }; caseMap[t.caseId].tasks.push(t); if ((t.lastActivity || t.createdAt) > caseMap[t.caseId].lastActivity) caseMap[t.caseId].lastActivity = t.lastActivity || t.createdAt; });
  const cases = Object.values(caseMap).sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  const generalTasks = tasks.filter(t => !t.caseId && t.status === "pending" && !isUrgent(t));
  const doneTasks = tasks.filter(t => t.status === "done");
  const familyFolders = [...new Set(doneTasks.map(t => t.familyName || t.folder).filter(Boolean))];
  const historyFiltered = historyFolder === "all" ? doneTasks : historyFolder === "unfiled" ? doneTasks.filter(t => !t.familyName && !t.folder) : doneTasks.filter(t => t.familyName === historyFolder || t.folder === historyFolder);
  const openCaseData = openCase ? caseMap[openCase] : null;
  const openCaseTasks = openCaseData ? openCaseData.tasks : [];
  const openCaseGroups = [...new Set(openCaseTasks.map(t => t.group || "General"))].map(g => ({ name: g, tasks: openCaseTasks.filter(t => (t.group || "General") === g) }));
  const monthlyCount = tasks.filter(t => { if (t.status !== "done" || !t.completedAt) return false; const d = new Date(t.completedAt); return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear(); }).length;

  const bg = darkMode ? "linear-gradient(135deg,#0f172a,#1a1035,#0f172a)" : "linear-gradient(135deg,#f0f9ff,#f5f0ff,#f0f9ff)";
  const tc = darkMode ? "#e2e8f0" : "#1e293b";
  const mc = darkMode ? "#64748b" : "#94a3b8";
  const cb = darkMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.8)";
  const brd = darkMode ? "rgba(167,139,250,0.15)" : "rgba(167,139,250,0.3)";
  const ibg = darkMode ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)";
  const is = { background: ibg, border: `1px solid ${brd}`, borderRadius: "10px", color: tc, padding: "8px 12px", fontSize: "13px", fontFamily: "inherit", outline: "none" };

  function TaskCard({ task }) {
    if (editingTask === task.id) return (
      <div style={{ background: cb, border: `1px solid ${brd}`, borderLeft: `4px solid ${getUrgencyColor(task)}`, borderRadius: "14px", padding: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <input value={editValues.title} onChange={e => setEditValues(v => ({ ...v, title: e.target.value }))} style={{ ...is, width: "100%", fontWeight: 700 }} />
          <textarea value={editValues.notes} onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))} placeholder="Notes..." rows={2} style={{ ...is, width: "100%", lineHeight: "1.4" }} />
          <div style={{ display: "flex", gap: "6px" }}>
            <select value={editValues.priority} onChange={e => setEditValues(v => ({ ...v, priority: e.target.value }))} style={{ ...is, flex: 1 }}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            <select value={editValues.category} onChange={e => setEditValues(v => ({ ...v, category: e.target.value }))} style={{ ...is, flex: 1 }}>{["Operations", "Families", "Compliance", "Admin", "Marketing", "Personal"].map(c => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <input type="datetime-local" value={editValues.dueDate} onChange={e => setEditValues(v => ({ ...v, dueDate: e.target.value }))} style={{ ...is, width: "100%" }} />
          <input value={editValues.phone || ""} onChange={e => setEditValues(v => ({ ...v, phone: e.target.value }))} placeholder="Phone number (optional)" style={{ ...is, width: "100%" }} />
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={() => saveEdit(task.id)} style={{ flex: 1, background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "8px", color: "#fff", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>Save</button>
            <button onClick={() => setEditingTask(null)} style={{ flex: 1, background: "none", border: `1px solid ${brd}`, borderRadius: "8px", color: mc, padding: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}>Cancel</button>
          </div>
        </div>
      </div>
    );
    const urgent = isUrgent(task);
    return (
      <div style={{ background: cb, border: `1px solid ${isOverdue(task) ? "rgba(239,68,68,0.2)" : brd}`, borderLeft: `4px solid ${getUrgencyColor(task)}`, borderRadius: "14px", padding: "11px 12px", opacity: task.status === "done" ? 0.45 : 1 }}>
        <div style={{ display: "flex", gap: "9px", alignItems: "flex-start" }}>
          <button onClick={() => toggleTask(task.id)} style={{ width: "19px", height: "19px", minWidth: "19px", borderRadius: "50%", border: `2px solid ${task.status === "done" ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: task.status === "done" ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "2px", flexShrink: 0 }}>
            {task.status === "done" && <span style={{ fontSize: "9px", color: "#fff", fontWeight: 700 }}>✓</span>}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: task.status === "done" ? mc : tc, textDecoration: task.status === "done" ? "line-through" : "none", marginBottom: "2px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }} onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
              <span style={{ flex: 1 }}>{task.title.includes(" — ") ? task.title.split(" — ").slice(1).join(" — ") : task.title}</span>
              {urgent && <span style={{ fontSize: "8px", background: "#ff006e22", color: "#ff006e", padding: "1px 5px", borderRadius: "4px", fontWeight: 700, flexShrink: 0 }}>URGENT</span>}
            </div>
            {task.dueDate && <div style={{ fontSize: "11px", fontWeight: 800, color: getUrgencyColor(task), marginBottom: "3px" }}>{fmtDate(task.dueDate)} at {fmtTime(task.dueDate)}</div>}
            {task.familyName && !openCase && <div style={{ fontSize: "9px", color: "#a78bfa", marginBottom: "3px" }}>👨‍👩‍👧 {task.familyName}</div>}
            {expandedTask === task.id && (
              <div style={{ marginTop: "6px" }}>
                {task.notes && <div style={{ fontSize: "11px", color: mc, marginBottom: "6px", lineHeight: 1.5 }}>{task.notes}</div>}
                {task.subtasks?.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "6px" }}>{task.subtasks.map(sub => <div key={sub.id} style={{ display: "flex", gap: "6px", alignItems: "center" }}><button onClick={() => toggleSubtask(task.id, sub.id)} style={{ width: "14px", height: "14px", minWidth: "14px", borderRadius: "3px", border: `2px solid ${sub.done ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: sub.done ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{sub.done && <span style={{ fontSize: "7px", color: "#fff", fontWeight: 700 }}>✓</span>}</button><span style={{ fontSize: "11px", color: sub.done ? mc : tc, textDecoration: sub.done ? "line-through" : "none" }}>{sub.title}</span></div>)}</div>}
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "4px" }}>
                  {task.phone && <a href={`tel:${task.phone}`} style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: "6px", color: "#34d399", padding: "3px 8px", fontSize: "10px", fontWeight: 700, textDecoration: "none" }}>📞 Call</a>}
                  {task.status === "pending" && <>
                    <span style={{ fontSize: "9px", color: mc, alignSelf: "center" }}>Snooze:</span>
                    {[["1hr", 1], ["4hr", 4], ["12hr", 12]].map(([label, hrs]) => <button key={label} onClick={() => snoozeTask(task.id, hrs)} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "6px", color: "#a78bfa", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 700 }}>{label}</button>)}
                    <button onClick={() => startEdit(task)} style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", borderRadius: "6px", color: "#22d3ee", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 700 }}>✏️</button>
                  </>}
                  <button onClick={() => deleteTask(task.id)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", color: "#ef4444", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 700 }}>🗑</button>
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", color: catColors[task.category] || mc, background: `${catColors[task.category] || mc}18`, border: `1px solid ${catColors[task.category] || mc}33`, padding: "1px 6px", borderRadius: "20px" }}>{task.category}</span>
                  <span style={{ fontSize: "9px", fontWeight: 600, color: priColors[task.priority], textTransform: "uppercase" }}>{task.priority}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Nunito',sans-serif", background: bg, minHeight: "100dvh", color: tc, display: "flex", flexDirection: "column", maxWidth: "480px", margin: "0 auto", position: "relative", overflow: "hidden" }}
      onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#a78bfa44;border-radius:2px}
        textarea,input,select{resize:none}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pd{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        .mb{animation:fadeUp .2s ease-out}
        .sb:not(:disabled):hover{transform:scale(1.05)}
        .tb{transition:all .15s}
        .fp{transition:all .12s;cursor:pointer}
        .ib{background:none;border:none;cursor:pointer;padding:4px;transition:all .15s}
        .ib:hover{transform:scale(1.1)}
        .stb{cursor:pointer;transition:all .15s}
        .stb:hover{transform:scale(1.04)}
        .case-folder{transition:all .15s;cursor:pointer}
        .case-folder:hover{border-color:rgba(167,139,250,0.4)!important;transform:translateY(-1px)}
        .group-row{transition:all .15s;cursor:pointer}
        .group-row:hover{background:rgba(167,139,250,0.05)!important}
      `}</style>

      {quietMode && <div style={{ background: "rgba(99,102,241,0.15)", borderBottom: "1px solid rgba(99,102,241,0.3)", padding: "6px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}><span style={{ fontSize: "11px", color: "#a5b4fc", fontWeight: 600 }}>🔕 Quiet mode until {fmtTime(settings.quietUntil)}</span><button onClick={() => updateSettings({ quietMode: false, quietUntil: null })} style={{ background: "none", border: "none", color: "#a5b4fc", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}>End</button></div>}

      {/* Header */}
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px", background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)", borderBottom: `1px solid ${brd}`, backdropFilter: "blur(10px)", zIndex: 10, flexShrink: 0 }}>
        <KarenMascot size={40} animated />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "18px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Kare-N</div>
          <div style={{ fontSize: "10px", color: mc }}>Hey {memberName} 👋</div>
        </div>
        <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
          {overdue.length > 0 && <div className="stb" onClick={() => { setActiveTab(1); setOpenCase(null); }} style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "3px 8px", textAlign: "center" }}><div style={{ color: "#ef4444", fontWeight: 700, fontSize: "12px" }}>{overdue.length}</div><div style={{ color: "#ef4444", opacity: 0.7, fontSize: "9px" }}>overdue</div></div>}
          <div className="stb" onClick={() => { setActiveTab(1); setOpenCase(null); }} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "8px", padding: "3px 8px", textAlign: "center" }}><div style={{ color: "#a78bfa", fontWeight: 700, fontSize: "12px" }}>{pending.length}</div><div style={{ color: "#a78bfa", opacity: 0.7, fontSize: "9px" }}>pending</div></div>
          <button className="ib" onClick={() => setShowQuietMode(true)} style={{ fontSize: "16px" }}>{quietMode ? "🔕" : "🔔"}</button>
          <button className="ib" onClick={() => setShowSettings(true)} style={{ fontSize: "17px" }}>⚙️</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: darkMode ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.5)", borderBottom: `1px solid ${brd}`, position: "relative", zIndex: 10, flexShrink: 0 }}>
        {["Chat", "Tasks", "History"].map((tab, i) => (
          <button key={tab} className="tb" onClick={() => { setActiveTab(i); if (i !== 1) setOpenCase(null); }} style={{ flex: 1, padding: "10px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === i ? "#a78bfa" : "transparent"}`, color: activeTab === i ? "#a78bfa" : mc, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", transition: "all .2s" }}>
            {tab}{tab === "Tasks" && pending.length > 0 && <span style={{ marginLeft: "4px", background: "rgba(167,139,250,0.2)", color: "#a78bfa", padding: "1px 5px", borderRadius: "10px", fontSize: "9px" }}>{pending.length}</span>}
          </button>
        ))}
        <div style={{ position: "absolute", bottom: "-14px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "4px", zIndex: 5 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ width: i === activeTab ? "14px" : "5px", height: "5px", borderRadius: "3px", background: i === activeTab ? "#a78bfa" : "#334155", transition: "all .2s" }} />)}
        </div>
      </div>
      <div style={{ height: "14px", flexShrink: 0 }} />

      {/* CHAT */}
      {activeTab === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: "0 14px 8px", flexShrink: 0, display: "flex", gap: "8px" }}>
            <button onClick={() => setShowFamilyIntake(true)} style={{ flex: 1, background: "linear-gradient(135deg,#22d3ee22,#a78bfa22)", border: `1px solid ${brd}`, borderRadius: "12px", color: "#a78bfa", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>👨‍👩‍👧 New Family Case</button>
            {pendingDebrief && <button onClick={() => setMessages(prev => [...prev, { role: "assistant", content: `Ready to debrief the ${pendingDebrief.familyName || ""} arrangement? Tell me what I need to know.` }])} style={{ background: "rgba(255,190,11,0.15)", border: "1px solid rgba(255,190,11,0.3)", borderRadius: "12px", color: "#ffbe0b", padding: "8px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "11px", whiteSpace: "nowrap", animation: "pulse 2s infinite" }}>📋 Debrief</button>}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 14px 12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {messages.map((m, i) => (
              <div key={i} className="mb" style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: "8px", alignItems: "flex-end" }}>
                {m.role === "assistant" && <div style={{ flexShrink: 0, marginBottom: "2px" }}><KarenMascot size={26} /></div>}
                <div style={{ maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px", background: m.role === "user" ? (darkMode ? "linear-gradient(135deg,#1e3a5f,#1a1045)" : "linear-gradient(135deg,#dbeafe,#ede9fe)") : cb, border: `1px solid ${m.role === "user" ? "rgba(34,211,238,0.2)" : brd}`, fontSize: "13px", lineHeight: "1.6", color: m.role === "user" ? (darkMode ? "#bae6fd" : "#1e3a5f") : tc, whiteSpace: "pre-wrap", position: "relative", paddingBottom: m.role === "assistant" ? "24px" : "10px" }}>
                  {m.content}
                  {m.role === "assistant" && settings.voiceEnabled && <button onClick={() => speak(m.content, settings.selectedVoice, quietMode)} style={{ position: "absolute", bottom: "4px", right: "8px", background: "none", border: "none", color: mc, cursor: "pointer", fontSize: "12px", opacity: 0.6, padding: "2px" }}>🔊</button>}
                </div>
              </div>
            ))}
            {loading && <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}><KarenMascot size={26} animated /><div style={{ padding: "10px 14px", background: cb, border: `1px solid ${brd}`, borderRadius: "4px 18px 18px 18px", display: "flex", gap: "5px", alignItems: "center" }}>{[0, 1, 2].map(i => <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee,#a78bfa)", animation: `pd 1.2s ${i * 0.2}s infinite` }} />)}</div></div>}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${brd}`, background: darkMode ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.9)", backdropFilter: "blur(10px)", display: "flex", gap: "8px", alignItems: "flex-end", flexShrink: 0 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={listening ? "Listening..." : "Tell me what you need to do..."} rows={2}
                style={{ width: "100%", background: ibg, border: `1px solid ${listening ? "#a78bfa" : brd}`, borderRadius: "14px", color: tc, padding: "10px 44px 10px 14px", fontSize: "13px", fontFamily: "inherit", outline: "none", lineHeight: "1.5" }} />
              <button onClick={toggleVoice} style={{ position: "absolute", right: "10px", bottom: "10px", width: "26px", height: "26px", borderRadius: "50%", background: listening ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(167,139,250,0.2)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>{listening ? "⏹" : "🎙"}</button>
            </div>
            <button className="sb" onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{ width: "40px", height: "40px", borderRadius: "14px", background: loading || !input.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", transition: "all .2s", flexShrink: 0 }}>{loading ? "⏳" : "✈️"}</button>
          </div>
        </div>
      )}

      {/* TASKS — main */}
      {activeTab === 1 && !openCase && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {(urgentGeneral.length > 0 || urgentCase.length > 0) && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#ff006e", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ff006e", animation: "pd 1.5s infinite" }} /> Due Within 24 Hours
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {[...urgentGeneral, ...urgentCase].map(task => <TaskCard key={task.id} task={task} />)}
              </div>
            </div>
          )}
          {generalTasks.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: mc, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>General</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>{generalTasks.map(task => <TaskCard key={task.id} task={task} />)}</div>
            </div>
          )}
          {cases.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: mc, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Family Cases</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {cases.map(c => {
                  const cp = c.tasks.filter(t => t.status === "pending");
                  const cu = cp.filter(isUrgent); const co = cp.filter(isOverdue);
                  return (
                    <div key={c.caseId} className="case-folder" onClick={() => setOpenCase(c.caseId)} style={{ background: cb, border: `1px solid ${brd}`, borderRadius: "14px", padding: "14px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "linear-gradient(135deg,#22d3ee33,#a78bfa33)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>👨‍👩‍👧</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: tc, marginBottom: "3px" }}>{c.familyName} Family</div>
                        <div style={{ fontSize: "11px", color: mc, display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <span>{cp.length} pending</span>
                          {co.length > 0 && <span style={{ color: "#ef4444", fontWeight: 700 }}>⚠ {co.length} overdue</span>}
                          {cu.length > 0 && <span style={{ color: "#ff006e", fontWeight: 700 }}>🔴 {cu.length} urgent</span>}
                        </div>
                      </div>
                      <div style={{ color: mc, fontSize: "16px" }}>›</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {tasks.filter(t => t.status === "pending").length === 0 && cases.length === 0 && <div style={{ textAlign: "center", marginTop: "40px" }}><KarenMascot size={50} animated /><div style={{ color: mc, fontSize: "13px", marginTop: "12px" }}>No active tasks or cases.</div></div>}
        </div>
      )}

      {/* CASE DETAIL */}
      {activeTab === 1 && openCase && openCaseData && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
            <button onClick={() => setOpenCase(null)} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "8px", color: mc, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 700 }}>← Back</button>
            <div style={{ flex: 1 }}><div style={{ fontSize: "16px", fontWeight: 800, color: tc }}>{openCaseData.familyName} Family</div><div style={{ fontSize: "11px", color: mc }}>{openCaseTasks.filter(t => t.status === "pending").length} pending · {openCaseTasks.filter(t => t.status === "done").length} done</div></div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button onClick={() => closeCase(openCase)} style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: "8px", color: "#34d399", padding: "6px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700 }}>✓ Close</button>
              <button onClick={() => deleteCase(openCase)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", color: "#ef4444", padding: "6px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700 }}>🗑 Delete</button>
            </div>
          </div>
          {openCaseTasks.find(t => t.phone) && <a href={`tel:${openCaseTasks.find(t => t.phone).phone}`} style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: "12px", padding: "10px 14px", marginBottom: "14px", textDecoration: "none" }}><span style={{ fontSize: "18px" }}>📞</span><div><div style={{ fontSize: "12px", fontWeight: 700, color: "#34d399" }}>Call NOK</div><div style={{ fontSize: "10px", color: mc }}>{openCaseTasks.find(t => t.phone).phone}</div></div></a>}
          {openCaseGroups.map(group => {
            const key = `${openCase}-${group.name}`;
            const expanded = expandedGroups[key] || false;
            const doneCount = group.tasks.filter(t => t.status === "done").length;
            const allDone = doneCount === group.tasks.length;
            return (
              <div key={group.name} style={{ marginBottom: "10px" }}>
                <div className="group-row" onClick={() => setExpandedGroups(prev => ({ ...prev, [key]: !expanded }))}
                  style={{ display: "flex", alignItems: "center", gap: "10px", background: cb, border: `1px solid ${brd}`, borderRadius: "12px", padding: "12px 14px" }}>
                  <div style={{ flex: 1 }}><div style={{ fontSize: "13px", fontWeight: 700, color: allDone ? mc : tc, textDecoration: allDone ? "line-through" : "none" }}>{group.name}</div><div style={{ fontSize: "10px", color: mc, marginTop: "2px" }}>{doneCount}/{group.tasks.length} complete</div></div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    {allDone && <span style={{ fontSize: "12px" }}>✅</span>}
                    <div style={{ color: mc, fontSize: "14px", transition: "transform .2s", transform: expanded ? "rotate(90deg)" : "rotate(0)" }}>›</div>
                  </div>
                </div>
                {expanded && <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px", paddingLeft: "8px" }}>{group.tasks.map(task => <TaskCard key={task.id} task={task} />)}</div>}
              </div>
            );
          })}
          <div style={{ marginTop: "16px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: mc, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Case Notes</div>
            <textarea value={getLs(token, `case-notes-${openCase}`, "")} onChange={e => setLs(token, `case-notes-${openCase}`, e.target.value)} placeholder="Family preferences, sensitivities, special requests, contacts..." rows={5}
              style={{ width: "100%", background: ibg, border: `1px solid ${brd}`, borderRadius: "12px", color: tc, padding: "12px 14px", fontSize: "13px", fontFamily: "inherit", outline: "none", lineHeight: "1.6" }} />
          </div>
        </div>
      )}

      {/* HISTORY */}
      {activeTab === 2 && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "12px" }}>
            {["all", "unfiled", ...familyFolders].map(f => <button key={f} className="fp" onClick={() => setHistoryFolder(f)} style={{ padding: "3px 10px", background: historyFolder === f ? "linear-gradient(135deg,#22d3ee88,#a78bfa88)" : ibg, color: historyFolder === f ? "#fff" : mc, border: `1px solid ${historyFolder === f ? "rgba(167,139,250,0.5)" : brd}`, borderRadius: "20px", fontSize: "10px", fontFamily: "inherit", fontWeight: 600, textTransform: "uppercase" }}>{f === "all" ? `All (${doneTasks.length})` : f === "unfiled" ? "Unfiled" : `👨‍👩‍👧 ${f}`}</button>)}
          </div>
          {historyFiltered.length === 0 ? <div style={{ textAlign: "center", marginTop: "40px" }}><KarenMascot size={50} animated /><div style={{ color: mc, fontSize: "13px", marginTop: "12px" }}>Nothing here yet.</div></div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {historyFiltered.sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt)).map(task => (
                <div key={task.id} style={{ background: cb, border: `1px solid ${brd}`, borderLeft: "3px solid #1e293b", borderRadius: "12px", padding: "10px 12px", opacity: 0.65 }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span>✅</span>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "12px", fontWeight: 600, textDecoration: "line-through", color: mc }}>{task.title}</div><div style={{ fontSize: "10px", color: mc, marginTop: "2px", display: "flex", gap: "8px" }}><span>{task.completedAt ? fmtDate(task.completedAt) : "Completed"}</span>{task.familyName && <span>👨‍👩‍👧 {task.familyName}</span>}</div></div>
                    <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                      <button onClick={() => toggleTask(task.id)} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: "#a78bfa", padding: "2px 6px", cursor: "pointer", fontSize: "9px", fontFamily: "inherit" }}>↩</button>
                      <button onClick={() => setMovingTask(movingTask === task.id ? null : task.id)} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: mc, padding: "2px 6px", cursor: "pointer", fontSize: "9px" }}>📁</button>
                      <button onClick={() => { if (window.confirm("Delete from history?")) deleteTask(task.id); }} style={{ background: "none", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", color: "#ef4444", padding: "2px 6px", cursor: "pointer", fontSize: "9px" }}>🗑</button>
                    </div>
                  </div>
                  {movingTask === task.id && (
                    <div style={{ marginTop: "8px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10px", color: mc, alignSelf: "center" }}>Move to:</span>
                      {familyFolders.map(folder => <button key={folder} onClick={() => { updateTasks(tasks.map(t => t.id === task.id ? { ...t, folder } : t)); setMovingTask(null); }} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "6px", color: "#a78bfa", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 600 }}>{folder}</button>)}
                      <div style={{ display: "flex", gap: "3px" }}><input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="New folder..." style={{ ...is, padding: "2px 7px", fontSize: "10px", width: "90px" }} />{newFolderName && <button onClick={() => { updateTasks(tasks.map(t => t.id === task.id ? { ...t, folder: newFolderName.trim() } : t)); setMovingTask(null); setNewFolderName(""); }} style={{ background: "rgba(34,211,238,0.2)", border: "none", borderRadius: "6px", color: "#22d3ee", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 700 }}>✓</button>}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick capture */}
      <button onClick={() => { setActiveTab(0); setTimeout(() => inputRef.current?.focus(), 100); }}
        style={{ position: "fixed", bottom: "20px", right: "20px", width: "52px", height: "52px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", boxShadow: "0 4px 20px rgba(167,139,250,0.4)", zIndex: 50, transition: "transform .2s" }}
        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.1)"}
        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>⚡</button>

      {/* Quiet mode modal */}
      {showQuietMode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: darkMode ? "#1a1035" : "#fff", border: `1px solid ${brd}`, borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "320px" }}>
            <div style={{ fontSize: "16px", fontWeight: 800, color: tc, marginBottom: "16px", textAlign: "center" }}>🔕 Quiet Mode</div>
            <div style={{ fontSize: "13px", color: mc, marginBottom: "16px", textAlign: "center" }}>Silence all notifications for:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[1, 2, 3, 4].map(h => <button key={h} onClick={() => activateQuietMode(h)} style={{ background: "linear-gradient(135deg,#22d3ee22,#a78bfa22)", border: `1px solid ${brd}`, borderRadius: "12px", color: tc, padding: "12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "14px" }}>{h} hour{h !== 1 ? "s" : ""}</button>)}
            </div>
            <button onClick={() => setShowQuietMode(false)} style={{ width: "100%", marginTop: "12px", background: "none", border: `1px solid ${brd}`, borderRadius: "12px", color: mc, padding: "10px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ background: darkMode ? "#1a1035" : "#fff", border: `1px solid ${brd}`, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "480px", maxHeight: "88dvh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 800, color: tc }}>⚙️ Settings</div>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: mc, cursor: "pointer", fontSize: "22px" }}>×</button>
            </div>
            <div style={{ display: "flex", padding: "10px 20px 0", gap: "4px", flexShrink: 0, overflowX: "auto" }}>
              {["general", "templates", "contacts", "documents", "help"].map(t => <button key={t} onClick={() => setSettingsTab(t)} style={{ flexShrink: 0, padding: "7px 12px", background: settingsTab === t ? "rgba(167,139,250,0.2)" : "none", border: `1px solid ${settingsTab === t ? "#a78bfa" : brd}`, borderRadius: "8px", color: settingsTab === t ? "#a78bfa" : mc, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>{t}</button>)}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
              {settingsTab === "general" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ background: "linear-gradient(135deg,#22d3ee22,#a78bfa22)", border: `1px solid ${brd}`, borderRadius: "14px", padding: "16px", marginBottom: "8px", textAlign: "center" }}>
                    <div style={{ fontSize: "40px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{monthlyCount}</div>
                    <div style={{ fontSize: "12px", color: mc, fontWeight: 600 }}>tasks completed this month</div>
                  </div>
                  {[
                    { label: "Appearance", sub: "Dark or light theme", control: <button onClick={() => updateSettings({ darkMode: !settings.darkMode })} style={{ background: settings.darkMode ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(167,139,250,0.2)", border: "none", borderRadius: "20px", padding: "6px 14px", cursor: "pointer", color: settings.darkMode ? "#fff" : "#a78bfa", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{settings.darkMode ? "🌙 Dark" : "☀️ Light"}</button> },
                    { label: "Default Due Time", sub: "Used when no time given", control: <input type="time" value={settings.defaultDueTime} onChange={e => updateSettings({ defaultDueTime: e.target.value })} style={{ ...is, padding: "5px 8px" }} /> },
                    { label: "Default Category", sub: "Used when none detected", control: <select value={settings.defaultCategory} onChange={e => updateSettings({ defaultCategory: e.target.value })} style={{ ...is, padding: "5px 8px" }}>{["Operations", "Families", "Compliance", "Admin", "Marketing", "Personal"].map(c => <option key={c} value={c}>{c}</option>)}</select> },
                    { label: "Voice Responses", sub: "Kare-N reads messages aloud", control: <button onClick={() => updateSettings({ voiceEnabled: !settings.voiceEnabled })} style={{ background: settings.voiceEnabled ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: `1px solid ${brd}`, borderRadius: "20px", padding: "6px 14px", cursor: "pointer", color: settings.voiceEnabled ? "#fff" : mc, fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{settings.voiceEnabled ? "On" : "Off"}</button> },
                    { label: "App Lock", sub: "Optional PIN to open app", control: <button onClick={() => updateSettings({ pinEnabled: !settings.pinEnabled })} style={{ background: settings.pinEnabled ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: `1px solid ${brd}`, borderRadius: "20px", padding: "6px 14px", cursor: "pointer", color: settings.pinEnabled ? "#fff" : mc, fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{settings.pinEnabled ? "On" : "Off"}</button> },
                  ].map(({ label, sub, control }) => <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${brd}` }}><div><div style={{ fontSize: "13px", fontWeight: 600, color: tc }}>{label}</div><div style={{ fontSize: "10px", color: mc }}>{sub}</div></div>{control}</div>)}
                  {settings.pinEnabled && <div style={{ padding: "12px 0", borderBottom: `1px solid ${brd}` }}><div style={{ fontSize: "13px", fontWeight: 600, color: tc, marginBottom: "8px" }}>Set PIN</div><input type="password" maxLength={6} placeholder="Enter 4-6 digit PIN" value={settings.pin || ""} onChange={e => updateSettings({ pin: e.target.value })} style={{ ...is, width: "100%" }} /></div>}
                  <div style={{ padding: "12px 0" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: tc, marginBottom: "10px" }}>Feedback</div>
                    {feedbackSent ? <div style={{ color: "#34d399", fontWeight: 700, fontSize: "13px" }}>✓ Sent!</div> : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><textarea value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="What's working, what's not..." rows={3} style={{ ...is, width: "100%", lineHeight: "1.5" }} /><button onClick={sendFeedback} disabled={!feedback.trim()} style={{ background: feedback.trim() ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: "none", borderRadius: "10px", color: feedback.trim() ? "#fff" : mc, padding: "10px", cursor: feedback.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>Send Feedback</button></div>}
                  </div>
                </div>
              )}
              {settingsTab === "templates" && (
                <div>
                  <div style={{ fontSize: "12px", color: mc, marginBottom: "14px", lineHeight: 1.5 }}>Tell Kare-N to update your templates in chat — changes save automatically. Edit task names inline here.</div>
                  {templates.map((template, ti) => (
                    <div key={template.id} style={{ background: cb, border: `1px solid ${brd}`, borderLeft: `4px solid ${template.color}`, borderRadius: "14px", padding: "14px", marginBottom: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}><div><div style={{ fontSize: "14px", fontWeight: 700, color: tc }}>{template.name}</div><div style={{ fontSize: "11px", color: mc }}>{template.description}</div></div><div style={{ fontSize: "11px", color: template.color, fontWeight: 600 }}>{template.groups.reduce((a, g) => a + g.tasks.length, 0)} tasks</div></div>
                      {template.groups.map((group, gi) => (
                        <div key={gi} style={{ marginBottom: "8px" }}>
                          <div style={{ fontSize: "10px", fontWeight: 700, color: template.color, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>{group.name}</div>
                          {group.tasks.map((task, tki) => <div key={tki} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}><div style={{ width: "5px", height: "5px", borderRadius: "50%", background: brd, flexShrink: 0 }} /><input value={task} onChange={e => { const u = templates.map((t, idx) => idx === ti ? { ...t, groups: t.groups.map((g, gidx) => gidx === gi ? { ...g, tasks: g.tasks.map((tk, tkidx) => tkidx === tki ? e.target.value : tk) } : g) } : t); setTemplates(u); setLs(token, "templates", u); }} style={{ ...is, padding: "3px 8px", fontSize: "11px", flex: 1 }} /><button onClick={() => { const u = templates.map((t, idx) => idx === ti ? { ...t, groups: t.groups.map((g, gidx) => gidx === gi ? { ...g, tasks: g.tasks.filter((_, tkidx) => tkidx !== tki) } : g) } : t); setTemplates(u); setLs(token, "templates", u); }} style={{ background: "none", border: "none", color: mc, cursor: "pointer", fontSize: "14px", padding: "0 2px" }}>×</button></div>)}
                          <button onClick={() => { const u = templates.map((t, idx) => idx === ti ? { ...t, groups: t.groups.map((g, gidx) => gidx === gi ? { ...g, tasks: [...g.tasks, "New task"] } : g) } : t); setTemplates(u); setLs(token, "templates", u); }} style={{ background: "none", border: `1px dashed ${brd}`, borderRadius: "6px", color: mc, padding: "2px 8px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", marginTop: "4px" }}>+ Add task</button>
                        </div>
                      ))}
                      <button onClick={() => { const u = templates.map((t, idx) => idx === ti ? { ...t, groups: [...t.groups, { name: "New Group", tasks: ["Task 1"] }] } : t); setTemplates(u); setLs(token, "templates", u); }} style={{ background: `${template.color}18`, border: `1px solid ${template.color}44`, borderRadius: "8px", color: template.color, padding: "5px 12px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, marginTop: "4px" }}>+ Add Group</button>
                    </div>
                  ))}
                  <button onClick={() => { const nt = { id: `template-${Date.now()}`, name: "New Template", description: "Custom workflow", color: "#34d399", groups: [{ name: "Group 1", tasks: ["Task 1", "Task 2"] }] }; const u = [...templates, nt]; setTemplates(u); setLs(token, "templates", u); }} style={{ width: "100%", background: "rgba(52,211,153,0.1)", border: "1px dashed rgba(52,211,153,0.4)", borderRadius: "12px", color: "#34d399", padding: "10px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>+ Create New Template</button>
                </div>
              )}
              {settingsTab === "contacts" && (
                <div>
                  <div style={{ fontSize: "12px", color: mc, marginBottom: "14px", lineHeight: 1.5 }}>Save vendor and recurring contacts. Kare-N will recognize them by name in chat.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                    <input value={newVendorName} onChange={e => setNewVendorName(e.target.value)} placeholder="Contact name (e.g. King Mortuary)" style={{ ...is, width: "100%" }} />
                    <input value={newVendorPhone} onChange={e => setNewVendorPhone(e.target.value)} placeholder="Phone number" style={{ ...is, width: "100%" }} />
                    <button onClick={() => { if (!newVendorName.trim() || !newVendorPhone.trim()) return; const u = [...vendorContacts, { id: String(Date.now()), name: newVendorName.trim(), phone: newVendorPhone.trim() }]; setVendorContacts(u); setLs(token, "vendors", u); setNewVendorName(""); setNewVendorPhone(""); }} style={{ background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "10px", color: "#fff", padding: "10px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>Save Contact</button>
                  </div>
                  {vendorContacts.length === 0 ? <div style={{ textAlign: "center", color: mc, fontSize: "13px" }}>No contacts saved yet.</div> : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{vendorContacts.map(v => <div key={v.id} style={{ background: cb, border: `1px solid ${brd}`, borderRadius: "12px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px" }}><div style={{ flex: 1 }}><div style={{ fontSize: "13px", fontWeight: 600, color: tc }}>{v.name}</div><div style={{ fontSize: "11px", color: mc }}>{v.phone}</div></div><a href={`tel:${v.phone}`} style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: "6px", color: "#34d399", padding: "4px 8px", fontSize: "11px", fontWeight: 700, textDecoration: "none" }}>📞</a><button onClick={() => { const u = vendorContacts.filter(c => c.id !== v.id); setVendorContacts(u); setLs(token, "vendors", u); }} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: mc, padding: "4px 8px", cursor: "pointer", fontSize: "12px" }}>×</button></div>)}</div>}
                </div>
              )}
              {settingsTab === "documents" && (
                <div>
                  <div style={{ fontSize: "12px", color: mc, marginBottom: "14px", lineHeight: 1.5 }}>Upload your forms, checklists, and documents.</div>
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={handleDocUpload} style={{ display: "none" }} />
                  <button onClick={() => fileInputRef.current?.click()} style={{ width: "100%", background: "rgba(34,211,238,0.1)", border: "1px dashed rgba(34,211,238,0.4)", borderRadius: "12px", color: "#22d3ee", padding: "12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px", marginBottom: "14px" }}>📎 Upload Document</button>
                  {documents.length === 0 ? <div style={{ textAlign: "center", color: mc, fontSize: "13px" }}>No documents yet.</div> : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{documents.map(doc => <div key={doc.id} style={{ background: cb, border: `1px solid ${brd}`, borderRadius: "12px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px" }}><div style={{ fontSize: "22px" }}>{doc.type?.includes("pdf") ? "📄" : doc.type?.includes("image") ? "🖼" : "📝"}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "13px", fontWeight: 600, color: tc, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div><div style={{ fontSize: "10px", color: mc }}>{new Date(doc.uploadedAt).toLocaleDateString()}</div></div><div style={{ display: "flex", gap: "4px" }}><a href={doc.data} download={doc.name} style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", borderRadius: "6px", color: "#22d3ee", padding: "4px 8px", fontSize: "10px", fontWeight: 700, textDecoration: "none" }}>↓</a><button onClick={() => { const u = documents.filter(d => d.id !== doc.id); setDocuments(u); setLs(token, "docs", u); }} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: mc, padding: "4px 8px", cursor: "pointer", fontSize: "12px" }}>×</button></div></div>)}</div>}
                </div>
              )}
              {settingsTab === "help" && (
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: tc, marginBottom: "14px" }}>Quick Tips</div>
                  {[["👨‍👩‍👧", "New family case", "Tap 'New Family Case' or say 'new family' in chat"], ["🎙", "Voice input", "Tap the microphone to speak a task — works in chat and onboarding"], ["⚡", "Quick capture", "Tap the lightning bolt to instantly log anything from any screen"], ["🔕", "Quiet mode", "Tap the bell icon before a service to silence everything"], ["📋", "Arrangement debrief", "Complete the arrangement task and Kare-N asks for a debrief automatically"], ["✏️", "Edit templates", "Tell Kare-N to update your template and she saves the change"], ["🔊", "Voice responses", "Tap the speaker on any message to hear it read aloud"], ["🔒", "App lock", "Enable PIN in General settings to protect the app"], ["🌐", "Access anywhere", "Your URL works on any browser, any device — your data follows you"]].map(([icon, title, desc]) => (
                    <div key={title} style={{ display: "flex", gap: "12px", padding: "12px 0", borderBottom: `1px solid ${brd}` }}>
                      <div style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</div>
                      <div><div style={{ fontSize: "13px", fontWeight: 600, color: tc, marginBottom: "3px" }}>{title}</div><div style={{ fontSize: "11px", color: mc, lineHeight: 1.5 }}>{desc}</div></div>
                    </div>
                  ))}
                  <div style={{ padding: "16px 0" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: tc, marginBottom: "8px" }}>Voice</div>
                    <div style={{ fontSize: "11px", color: mc, marginBottom: "8px" }}>Kare-N speaks with a female voice by default. Change it here:</div>
                    <select value={settings.selectedVoice || ""} onChange={e => updateSettings({ selectedVoice: e.target.value || null })} style={{ ...is, width: "100%" }}>
                      <option value="">Default female voice</option>
                      {availableVoices.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                    </select>
                    {availableVoices.length > 0 && <button onClick={() => speak("Hey, I'm Kare-N. Ready to help.", settings.selectedVoice, false)} style={{ marginTop: "8px", background: "rgba(167,139,250,0.1)", border: `1px solid ${brd}`, borderRadius: "8px", color: "#a78bfa", padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 700 }}>Test Voice</button>}
                  </div>
                  <div style={{ padding: "12px 0" }}>
                    <button onClick={() => { if (window.confirm("Redo setup? This will run the onboarding interview again.")) { setLs(token, "profile", null); localStorage.removeItem(`karen-onboarded-${token}`); window.location.reload(); } }} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${brd}`, borderRadius: "10px", color: mc, padding: "10px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", width: "100%" }}>Redo Setup Interview</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Family intake */}
      {showFamilyIntake && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: darkMode ? "#1a1035" : "#fff", border: `1px solid ${brd}`, borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "380px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}><div style={{ fontSize: "16px", fontWeight: 800, color: tc }}>👨‍👩‍👧 New Family Case</div><button onClick={() => setShowFamilyIntake(false)} style={{ background: "none", border: "none", color: mc, cursor: "pointer", fontSize: "22px" }}>×</button></div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div><label style={{ fontSize: "10px", color: mc, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "4px" }}>Full Name *</label><input value={familyIntake.name} onChange={e => setFamilyIntake(f => ({ ...f, name: e.target.value }))} placeholder="First Last" style={{ ...is, width: "100%" }} /></div>
              <div style={{ display: "flex", gap: "8px" }}>
                <div style={{ flex: 1 }}><label style={{ fontSize: "10px", color: mc, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "4px" }}>DOB</label><input type="date" value={familyIntake.dob} onChange={e => setFamilyIntake(f => ({ ...f, dob: e.target.value }))} style={{ ...is, width: "100%" }} /></div>
                <div style={{ flex: 1 }}><label style={{ fontSize: "10px", color: mc, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "4px" }}>DOD</label><input type="date" value={familyIntake.dod} onChange={e => setFamilyIntake(f => ({ ...f, dod: e.target.value }))} style={{ ...is, width: "100%" }} /></div>
              </div>
              <div><label style={{ fontSize: "10px", color: mc, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "4px" }}>Sex</label><div style={{ display: "flex", gap: "8px" }}>{["Male", "Female", "Other"].map(s => <button key={s} onClick={() => setFamilyIntake(f => ({ ...f, sex: s }))} style={{ flex: 1, padding: "7px", background: familyIntake.sex === s ? "linear-gradient(135deg,#22d3ee44,#a78bfa44)" : ibg, border: `1px solid ${familyIntake.sex === s ? "#a78bfa" : brd}`, borderRadius: "8px", color: familyIntake.sex === s ? "#a78bfa" : mc, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{s}</button>)}</div></div>
              <div><label style={{ fontSize: "10px", color: mc, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "4px" }}>Workflow</label><div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>{templates.map(t => <button key={t.id} onClick={() => setFamilyIntake(f => ({ ...f, template: t.id }))} style={{ flex: 1, padding: "7px", background: familyIntake.template === t.id ? `${t.color}33` : ibg, border: `1px solid ${familyIntake.template === t.id ? t.color : brd}`, borderRadius: "8px", color: familyIntake.template === t.id ? t.color : mc, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{t.name}</button>)}</div></div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button onClick={() => setShowFamilyIntake(false)} style={{ flex: 1, background: "none", border: `1px solid ${brd}`, borderRadius: "12px", color: mc, padding: "11px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: "13px" }}>Cancel</button>
              <button onClick={createFamilyWorkflow} disabled={!familyIntake.name.trim()} style={{ flex: 2, background: familyIntake.name.trim() ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: "none", borderRadius: "12px", color: familyIntake.name.trim() ? "#fff" : mc, padding: "11px", cursor: familyIntake.name.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>Create Workflow</button>
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
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/admin") { setView("admin"); return; }
    const urlToken = getTokenFromURL();
    if (!urlToken) { setView("locked"); return; }
    if (!VALID_TOKENS[urlToken]) { setView("locked"); return; }
    setToken(urlToken);
    // Check Blob first for onboarding flag — works across all devices
    fetch(`/api/chat?token=${encodeURIComponent(urlToken)}&type=onboarding`)
      .then(r => r.json())
      .then(data => {
        if (data.onboarded) { setView("app"); }
        else {
          // Fallback to localStorage
          const localDone = localStorage.getItem(`karen-onboarded-${urlToken}`);
          setView(localDone ? "app" : "onboarding");
        }
      })
      .catch(() => {
        const localDone = localStorage.getItem(`karen-onboarded-${urlToken}`);
        setView(localDone ? "app" : "onboarding");
      });
  }, []);

  function handleOnboardingComplete() { setView("app"); }

  const settings = token ? getLs(token, "settings", defaultSettings) : defaultSettings;
  const needsPin = settings.pinEnabled && settings.pin && !unlocked;

  if (view === "loading") return <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" }}><style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style><KarenMascot size={60} animated /></div>;
  if (view === "admin") return <AdminPanel />;
  if (view === "locked") return <LockedScreen />;
  if (view === "onboarding") return <Onboarding token={token} onComplete={handleOnboardingComplete} />;
  if (view === "app" && needsPin) return <PinLock settings={settings} onUnlock={() => setUnlocked(true)} />;
  if (view === "app") return <KarenMain token={token} />;
  return null;
}
