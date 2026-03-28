import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase, sendMagicLink, signOut, upsertUser, getSettings, upsertSettings, getTasks, deleteTask as dbDeleteTask, getCases, upsertCase, closeCase as dbCloseCase, deleteCase as dbDeleteCase, upsertCaseNotes, logActivity, getContacts, upsertContact, deleteContact as dbDeleteContact, getDocuments, uploadDocument, getDocumentUrl, deleteDocument as dbDeleteDocument, saveFeedback } from "./lib/supabase";

// ── Constants ─────────────────────────────────────────────────────────────────
const FIRM_TEMPLATES = [
  { id: "cremation", name: "Cremation", description: "Standard cremation workflow", color: "#22d3ee", groups: [{ name: "Portal", tasks: ["Invite Sent", "Accepted", "Packet"] }, { name: "Death Certificate", tasks: ["Input", "Dr. Sig", "Proof", "Release", "Order"] }, { name: "Obit", tasks: ["Input", "Draft", "Approval", "Publish"] }, { name: "Crematory", tasks: ["Fingerprint Collected", "DC", "Auth", "ME Auth (if required)"] }, { name: "Urn", tasks: ["Photo Received", "Design", "Proof", "Print"] }] },
  { id: "fullservice", name: "Full Service", description: "Full service burial workflow", color: "#a78bfa", groups: [{ name: "Portal", tasks: ["Invite Sent", "Accepted", "Packet"] }, { name: "Death Certificate", tasks: ["Input", "Dr. Sig", "Proof", "Release", "Order"] }, { name: "Obit", tasks: ["Input", "Draft", "Approval", "Publish"] }, { name: "Prep", tasks: ["Embalming", "Cosmetizing", "Dressing", "Casketing"] }, { name: "Church / Venue", tasks: ["Location Confirmed", "Officiant Contacted", "Officiant Confirmed", "Service Time Agreed", "Facility Access Confirmed"] }, { name: "Casket", tasks: ["Ordered", "Confirmed"] }, { name: "Vault", tasks: ["Ordered", "Confirmed"] }, { name: "Cemetery", tasks: ["Called", "Confirmed"] }, { name: "Service", tasks: ["Route Planned", "Confirmed"] }] },
];

const DEFAULT_SETTINGS = { dark_mode: true, default_due_time: "10:00", default_category: "Operations", quiet_mode: false, quiet_until: null, end_of_day_time: "18:00", end_of_day_enabled: false, voice_enabled: true, selected_voice: null, screen_wake: true, deadline_reminder_min: 30 };

const priColors = { high: "#ef4444", medium: "#f59e0b", low: "#94a3b8" };
const catColors = { Operations: "#22d3ee", Families: "#a78bfa", Compliance: "#f87171", Admin: "#94a3b8", Marketing: "#34d399", Personal: "#fb923c" };

// ── Helpers ───────────────────────────────────────────────────────────────────
function getUrgencyColor(task) {
  if (task.status === "done") return "#1e293b";
  if (!task.due_date) return "#6366f1";
  const ms = new Date(task.due_date) - new Date();
  if (ms < 0) return "#ef4444";
  if (ms < 16 * 3600000) return "#ff006e";
  if (ms < 48 * 3600000) return "#ffbe0b";
  return "#00b4d8";
}
function isUrgent(t) { if (!t.due_date || t.status !== "pending") return false; return (new Date(t.due_date) - new Date()) < 16 * 3600000; }
function isOverdue(t) { if (!t.due_date || t.status === "done") return false; return new Date(t.due_date) < new Date(); }
function fmtTime(d) { if (!d) return null; return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtDate(d) { if (!d) return null; const dt = new Date(d), t = new Date(), tom = new Date(t); tom.setDate(t.getDate() + 1); if (dt.toDateString() === t.toDateString()) return "Today"; if (dt.toDateString() === tom.toDateString()) return "Tomorrow"; return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function delayDate(h) { const d = new Date(); d.setHours(d.getHours() + h, 0, 0, 0); return d.toISOString(); }
function getTimeOfDay() { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; }
function gcalLink(title, dueDate) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const end = new Date(d.getTime() + 3600000);
  const fmt = dt => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmt(d)}/${fmt(end)}`;
}

function getCaseDot(caseTasks) {
  const pending = caseTasks.filter(t => t.status === "pending");
  if (pending.length === 0) return null;
  const hasUrgent = pending.some(t => isUrgent(t) || isOverdue(t));
  if (hasUrgent) return "#ff006e";
  const hasYellow = pending.some(t => t.due_date && (new Date(t.due_date) - new Date()) < 48 * 3600000);
  if (hasYellow) return "#ffbe0b";
  return "#00b4d8";
}

function speak(text, voiceName, quietMode) {
  if (quietMode || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  if (voiceName) {
    const v = voices.find(v => v.name === voiceName);
    if (v) utt.voice = v;
  } else {
    const female = voices.find(v => /female|woman|girl|zira|susan|karen|samantha|victoria|allison|ava|nova|tessa|moira|fiona|veena|google us english female/i.test(v.name))
      || voices.find(v => /english/i.test(v.name) && !/male/i.test(v.name) && v.lang && v.lang.startsWith("en"));
    if (female) utt.voice = female;
  }
  utt.rate = 0.95;
  window.speechSynthesis.speak(utt);
}

function startVoice(onResult, onEnd) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { alert("Voice input requires Chrome."); return null; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR(); r.continuous = false; r.interimResults = false; r.lang = "en-US";
  r.onresult = e => onResult(e.results[0][0].transcript);
  r.onerror = onEnd; r.onend = onEnd; r.start(); return r;
}

// ── Long press drag hook ──────────────────────────────────────────────────────
function useLongPressDrag(items, onReorder) {
  const [dragId, setDragId] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const timerRef = useRef(null);
  const draggingRef = useRef(false);

  function onTouchStart(e, id) {
    timerRef.current = setTimeout(() => {
      draggingRef.current = true;
      setDragId(id);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 400);
  }

  function onTouchMove(e) {
    if (!draggingRef.current) { clearTimeout(timerRef.current); return; }
    e.preventDefault();
    const y = e.touches[0].clientY;
    const els = document.querySelectorAll("[data-drag-id]");
    let found = null;
    els.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) found = el.getAttribute("data-drag-id");
    });
    if (found !== null) setOverIdx(items.findIndex(t => (t.id || t) === found));
  }

  function onTouchEnd() {
    clearTimeout(timerRef.current);
    if (draggingRef.current && dragId !== null && overIdx !== null) {
      const fromIdx = items.findIndex(t => (t.id || t) === dragId);
      if (fromIdx !== overIdx) onReorder(fromIdx, overIdx);
    }
    draggingRef.current = false;
    setDragId(null); setOverIdx(null);
  }

  return { dragId, overIdx, onTouchStart, onTouchMove, onTouchEnd };
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildChatPrompt(tasks, cases, settings, contacts, profile, memberName) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const profileStr = profile ? `\nDIRECTOR PROFILE: ${JSON.stringify(profile)}` : "";
  const contactStr = contacts?.length ? `\nSAVED CONTACTS: ${contacts.map(c => `${c.name}: ${c.phone}`).join(", ")}` : "";
  return `You are Kare-N — a sharp, no-fluff AI operations partner for independent funeral directors. Today is ${today}, ${time}.${profileStr}${contactStr}
Director's name: ${memberName}

You speak funeral director fluently: NOK, Decedent, DC, BPT, ME Auth, First call, Arrangement, Prep, Transfer/Removal, Cremated remains, Ink/Prints, Committal, At-need, Pre-need, Crematory, Inurnment, Officiant, Informant, Cash advance, GPL, DI.

ACTIVE CASES: ${cases?.filter(c => !c.closed_at).map(c => c.family_name).join(", ") || "none"}
PENDING TASKS: ${tasks?.filter(t => t.status === "pending").length || 0}

BEHAVIOR:
- Be direct, brief. Address ${memberName} occasionally but not every message.
- Do NOT ask follow-up questions. Acknowledge tasks in one sentence max and move on.
- First message of the day: give a briefing.
- When someone mentions a task, confirm briefly: "Got it." or "On it." — one line.
- When "first call" is mentioned for a family, confirm you've noted it and tell them to use "New Family Case" to spin up the full workflow, or ask if they want you to create a cremation or full service workflow.
- When arrangement task is checked complete, ask for debrief naturally.
- Do NOT output any JSON or task data blocks. A separate system handles task extraction.
- If the user says "quiet mode X hours" acknowledge it.
- Default due time: ${settings?.default_due_time || "10:00"}`;
}

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

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  async function handleSend() {
    if (!email.trim()) return;
    setLoading(true); setError("");
    const { error } = await sendMagicLink(email.trim());
    if (error) { setError("Couldn't send link. Check your email and try again."); setLoading(false); return; }
    setSent(true); setLoading(false);
  }
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "24px", background: "linear-gradient(135deg,#0f172a,#1a1035,#0f172a)", fontFamily: "'Nunito',sans-serif", padding: "40px 20px", textAlign: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      <KarenMascot size={80} animated />
      <div>
        <div style={{ fontSize: "36px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: "8px" }}>Kare-N</div>
        <div style={{ color: "#64748b", fontSize: "14px" }}>AI Operations Assistant for Funeral Professionals</div>
      </div>
      {!sent ? (
        <div style={{ width: "100%", maxWidth: "320px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ color: "#94a3b8", fontSize: "13px" }}>Enter your email to receive a sign-in link</div>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()} placeholder="your@email.com"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: "12px", color: "#e2e8f0", padding: "13px 16px", fontSize: "15px", fontFamily: "inherit", outline: "none", width: "100%" }} />
          {error && <div style={{ color: "#ef4444", fontSize: "12px" }}>{error}</div>}
          <button onClick={handleSend} disabled={loading || !email.trim()} style={{ background: email.trim() ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: "none", borderRadius: "12px", color: email.trim() ? "#fff" : "#475569", padding: "13px", cursor: email.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700, fontSize: "15px" }}>{loading ? "Sending..." : "Send Sign-In Link"}</button>
          <div style={{ color: "#334155", fontSize: "11px" }}>Kare-N is a member benefit of The Practitioner community.</div>
        </div>
      ) : (
        <div style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: "16px", padding: "24px 32px", maxWidth: "320px" }}>
          <div style={{ fontSize: "28px", marginBottom: "12px" }}>📬</div>
          <div style={{ color: "#34d399", fontWeight: 700, fontSize: "15px", marginBottom: "8px" }}>Check your email</div>
          <div style={{ color: "#64748b", fontSize: "13px", lineHeight: 1.6 }}>We sent a sign-in link to <strong style={{ color: "#94a3b8" }}>{email}</strong>. Click it to access Kare-N on any device.</div>
          <button onClick={() => setSent(false)} style={{ marginTop: "16px", background: "none", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "8px", color: "#64748b", padding: "8px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}>Try a different email</button>
        </div>
      )}
    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────────────────────
function Onboarding({ userId, onComplete }) {
  const [messages, setMessages] = useState([{ role: "assistant", content: `Hey! I'm Kare-N. Before we get started, I want to get set up for how you actually work.\n\nFirst — what should I call you?` }]);
  const [input, setInput] = useState(""); const [loading, setLoading] = useState(false); const [listening, setListening] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const chatEndRef = useRef(null); const inputRef = useRef(null); const recRef = useRef(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function toggleVoice() {
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const r = startVoice(t => { setInput(p => p ? p + " " + t : t); setListening(false); }, () => setListening(false));
    if (r) { recRef.current = r; setListening(true); }
  }

  async function send() {
    const text = input.trim(); if (!text || loading) return;
    setInput("");
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages); setLoading(true);
    const newCount = questionCount + 1;
    setQuestionCount(newCount);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "onboarding", messages: newMessages.map(m => ({ role: m.role, content: m.content })), userId, questionCount: newCount })
      });
      const data = await res.json();
      if (data.text) setMessages(prev => [...prev, { role: "assistant", content: data.text }]);
      if (data.profileComplete) {
        // Save display name if captured
        if (data.displayName) {
          await supabase.from('users').update({ display_name: data.displayName }).eq('id', userId);
        }
        setTimeout(() => onComplete(data.profile), 1500);
      }
    } catch { setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Try again." }]); }
    finally { setLoading(false); inputRef.current?.focus(); }
  }

  return (
    <div style={{ minHeight: "100dvh", background: "linear-gradient(135deg,#0f172a,#1a1035,#0f172a)", fontFamily: "'Nunito',sans-serif", color: "#e2e8f0", display: "flex", flexDirection: "column", maxWidth: "480px", margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#a78bfa44;border-radius:2px}textarea{resize:none}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes pd{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}`}</style>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid rgba(167,139,250,0.15)" }}>
        <KarenMascot size={44} animated />
        <div><div style={{ fontSize: "20px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Welcome to Kare-N</div><div style={{ fontSize: "11px", color: "#64748b" }}>Let's get you set up — type or speak</div></div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: "8px", alignItems: "flex-end" }}>
            {m.role === "assistant" && <KarenMascot size={26} />}
            <div style={{ maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px", background: m.role === "user" ? "linear-gradient(135deg,#1e3a5f,#1a1045)" : "rgba(255,255,255,0.05)", border: `1px solid ${m.role === "user" ? "rgba(34,211,238,0.2)" : "rgba(167,139,250,0.15)"}`, fontSize: "13px", lineHeight: "1.6", color: m.role === "user" ? "#bae6fd" : "#cbd5e1", whiteSpace: "pre-wrap" }}>{m.content}</div>
          </div>
        ))}
        {loading && <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}><KarenMascot size={26} animated /><div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: "4px 18px 18px 18px", display: "flex", gap: "5px", alignItems: "center" }}>{[0,1,2].map(i => <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee,#a78bfa)", animation: `pd 1.2s ${i*0.2}s infinite` }} />)}</div></div>}
        <div ref={chatEndRef} />
      </div>
      <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(167,139,250,0.1)", background: "rgba(15,23,42,0.9)", display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={listening ? "Listening..." : "Type or speak your answer..."} rows={2}
            style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: `1px solid ${listening ? "#a78bfa" : "rgba(167,139,250,0.2)"}`, borderRadius: "14px", color: "#e2e8f0", padding: "10px 44px 10px 14px", fontSize: "13px", fontFamily: "inherit", outline: "none", lineHeight: "1.5" }} />
          <button onClick={toggleVoice} style={{ position: "absolute", right: "10px", bottom: "10px", width: "26px", height: "26px", borderRadius: "50%", background: listening ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(167,139,250,0.2)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px" }}>{listening ? "⏹" : "🎙"}</button>
        </div>
        <button onClick={send} disabled={loading || !input.trim()} style={{ width: "40px", height: "40px", borderRadius: "14px", background: loading || !input.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", flexShrink: 0 }}>{loading ? "⏳" : "✈️"}</button>
      </div>
    </div>
  );
}

// ── Auth callback ─────────────────────────────────────────────────────────────
function AuthCallback() {
  useEffect(() => { supabase.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_IN' && session) window.location.href = '/'; }); }, []);
  return <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", fontFamily: "'Nunito',sans-serif" }}><style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style><div style={{ textAlign: "center" }}><KarenMascot size={60} animated /><div style={{ color: "#64748b", marginTop: "16px", fontSize: "14px" }}>Signing you in...</div></div></div>;
}

// ── Main App ──────────────────────────────────────────────────────────────────
function KarenMain({ user, userProfile }) {
  const memberName = userProfile?.display_name || userProfile?.name?.split(" ")[0] || user.email.split("@")[0];
  const [tasks, setTasks] = useState([]);
  const [cases, setCases] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [templates] = useState(FIRM_TEMPLATES);
  const [contacts, setContacts] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [openCase, setOpenCase] = useState(null);
  const [caseNotes, setCaseNotes] = useState({});
  const [editingCase, setEditingCase] = useState(null);
  const [editCaseValues, setEditCaseValues] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [listening, setListening] = useState(false);
  const [expandedTask, setExpandedTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [historyFolder, setHistoryFolder] = useState("all");
  const [showFamilyIntake, setShowFamilyIntake] = useState(false);
  const [familyIntake, setFamilyIntake] = useState({ name: "", dob: "", dod: "", sex: "", template: "cremation" });
  const [feedback, setFeedback] = useState(""); const [feedbackSent, setFeedbackSent] = useState(false);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [pendingDebrief, setPendingDebrief] = useState(null);
  const [showQuietMode, setShowQuietMode] = useState(false);
  const [newVendorName, setNewVendorName] = useState(""); const [newVendorPhone, setNewVendorPhone] = useState("");
  const [expandedGroups, setExpandedGroups] = useState({});
  const [dataLoaded, setDataLoaded] = useState(false);
  const [displayName, setDisplayName] = useState(userProfile?.display_name || "");
  const [addingTaskToGroup, setAddingTaskToGroup] = useState(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [dragOverCase, setDragOverCase] = useState(null);
  const [selectedHistory, setSelectedHistory] = useState([]);
  const [historyBulkMode, setHistoryBulkMode] = useState(false);
  const [movingHistoryTask, setMovingHistoryTask] = useState(null);
  const [caseOrder, setCaseOrder] = useState([]);
  const [generalTaskOrder, setGeneralTaskOrder] = useState([]);
  const [contactPrompt, setContactPrompt] = useState(null); // { taskId, name, phone }
  const chatEndRef = useRef(null); const inputRef = useRef(null); const recRef = useRef(null);
  const startXRef = useRef(null); const fileInputRef = useRef(null);

  const darkMode = settings.dark_mode;
  const quietMode = settings.quiet_mode && settings.quiet_until && new Date(settings.quiet_until) > new Date();

  // Load all data
  useEffect(() => {
    async function loadAll() {
      const [tasksRes, casesRes, settingsRes, contactsRes, docsRes] = await Promise.all([
        getTasks(user.id), supabase.from('cases').select('*').eq('user_id', user.id).order('last_activity', { ascending: false }),
        getSettings(user.id), getContacts(user.id), getDocuments(user.id)
      ]);
      if (tasksRes.data) setTasks(tasksRes.data);
      if (casesRes.data) setCases(casesRes.data);
      if (settingsRes.data) setSettings({ ...DEFAULT_SETTINGS, ...settingsRes.data });
      if (contactsRes.data) setContacts(contactsRes.data);
      if (docsRes.data) setDocuments(docsRes.data);

      // Load case notes
      if (casesRes.data?.length > 0) {
        const notesRes = await supabase.from('case_notes').select('*').eq('user_id', user.id);
        if (notesRes.data) {
          const notesMap = {};
          notesRes.data.forEach(n => { notesMap[n.case_id] = n.content; });
          setCaseNotes(notesMap);
        }
      }
      setDataLoaded(true);
    }
    loadAll();
  }, [user.id]);

  // Voices
  useEffect(() => {
    function load() { setAvailableVoices(window.speechSynthesis?.getVoices() || []); }
    load(); window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, []);

  // Screen wake
  useEffect(() => {
    let wakeLock = null;
    async function req() { try { if (settings.screen_wake && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {} }
    req();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') req(); });
    return () => { wakeLock?.release(); };
  }, [settings.screen_wake]);

  // Daily briefing
  useEffect(() => {
    if (!dataLoaded) return;
    const today = new Date().toDateString();
    const last = localStorage.getItem(`karen-briefing-${user.id}`);
    const overdue = tasks.filter(t => t.status === "pending" && isOverdue(t));
    const urgent = tasks.filter(t => isUrgent(t));
    const debriefNeeded = tasks.find(t => t.is_arrangement_task && t.status === "done" && !t.debrief_done);
    if (debriefNeeded) setPendingDebrief(debriefNeeded);
    if (last === today) { setMessages([{ role: "assistant", content: `Hey ${memberName}. What's on your plate?` }]); return; }
    localStorage.setItem(`karen-briefing-${user.id}`, today);
    if (tasks.length === 0) { setMessages([{ role: "assistant", content: `Good ${getTimeOfDay()} ${memberName}. No tasks yet.\n\nTap "New Family Case" to start a case, or tell me what you need to do.` }]); return; }
    let b = `Good ${getTimeOfDay()} ${memberName}.\n\n`;
    if (overdue.length > 0) b += `⚠️ ${overdue.length} overdue\n`;
    if (urgent.length > 0) b += `🔴 ${urgent.length} due within 16 hours\n`;
    if (debriefNeeded) b += `📋 Ready to debrief the ${debriefNeeded.family_name || ""} arrangement\n`;
    const activeCases = cases.filter(c => !c.closed_at);
    if (activeCases.length > 0) b += `📁 Active cases: ${activeCases.map(c => c.family_name).join(", ")}\n`;
    b += `\n${tasks.filter(t => t.status === "pending").length} pending total.`;
    setMessages([{ role: "assistant", content: b }]);
  }, [dataLoaded]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function updateSettings(updates) {
    const s = { ...settings, ...updates }; setSettings(s); await upsertSettings(user.id, s);
  }

  async function reloadTasks() {
    const { data } = await getTasks(user.id);
    if (data) { setTasks(data); return data; }
    return tasks;
  }

  async function checkAutoClose(currentTasks) {
    for (const c of cases.filter(cs => !cs.closed_at)) {
      const ct = currentTasks.filter(t => t.case_id === c.id);
      if (ct.length > 0 && ct.every(t => t.status === "done")) {
        await supabase.from('cases').update({ closed_at: new Date().toISOString() }).eq('id', c.id);
        await logActivity(c.id, user.id, "case_closed", "All tasks completed — auto-closed");
        setCases(prev => prev.map(cs => cs.id === c.id ? { ...cs, closed_at: new Date().toISOString() } : cs));
      }
    }
  }

  // Two-call send
  async function sendMessage(overrideText) {
    const text = (overrideText || input).trim();
    if (!text || loading) return;
    setInput("");
    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages); setLoading(true);
    try {
      const chatRes = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "chat", messages: newMessages.map(m => ({ role: m.role, content: m.content })), system: buildChatPrompt(tasks, cases, settings, contacts, userProfile?.profile, memberName) }),
      });
      const chatData = await chatRes.json();
      const responseText = chatData.text || "I didn't catch that — try again.";
      setMessages(prev => [...prev, { role: "assistant", content: responseText }]);
      setLoading(false);

      // Extraction — only if actionable
      const actionWords = ['remind', 'call', 'need to', "don't forget", 'follow up', 'pick up', 'order', 'file', 'send', 'schedule', 'check', 'confirm', 'update', 'contact', 'tomorrow', 'today', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', ' am', ' pm', 'morning', 'afternoon', 'evening', 'done', 'complete', 'finished', 'prep done', 'dc filed', 'bpt', 'ink done', 'arrangement', 'first call', 'transfer', 'pickup', 'crematory', 'cemetery', 'family', 'service'];
      const combined = (text + ' ' + responseText).toLowerCase();
      if (!actionWords.some(w => combined.includes(w))) { setExtracting(false); inputRef.current?.focus(); return; }

      setExtracting(true);
      const extractRes = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "extract", messages: [...newMessages, { role: "assistant", content: responseText }].map(m => ({ role: m.role, content: m.content })), currentTasks: tasks, userId: user.id, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const extractData = await extractRes.json();
      if (extractData.applied > 0) {
        const updated = await reloadTasks();
        await checkAutoClose(updated);
        // Check for call tasks with names — prompt for contact
        if (extractData.newCallTask) setContactPrompt(extractData.newCallTask);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Try again." }]);
      setLoading(false);
    } finally { setExtracting(false); inputRef.current?.focus(); }
  }

  function toggleVoice() {
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const r = startVoice(t => { setInput(p => p ? p + " " + t : t); setListening(false); }, () => setListening(false));
    if (r) { recRef.current = r; setListening(true); }
  }

  async function toggleTask(id) {
    const task = tasks.find(t => t.id === id); if (!task) return;
    const newStatus = task.status === "done" ? "pending" : "done";
    const updates = { status: newStatus, completed_at: newStatus === "done" ? new Date().toISOString() : null, last_activity: new Date().toISOString() };
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    await supabase.from('tasks').update(updates).eq('id', id);
    if (task.case_id) await logActivity(task.case_id, user.id, "task_completed", task.title);
    if (newStatus === "done" && task.is_arrangement_task && !task.debrief_done) {
      setPendingDebrief(task);
      setTimeout(() => { setMessages(prev => [...prev, { role: "assistant", content: `How'd the ${task.family_name || ""} arrangement go? Tell me what I need to know.` }]); setActiveTab(0); }, 500);
    }
    const updated = tasks.map(t => t.id === id ? { ...t, ...updates } : t);
    await checkAutoClose(updated);
  }

  async function handleDeleteTask(id) { setTasks(prev => prev.filter(t => t.id !== id)); await dbDeleteTask(id); }

  async function delayTask(id, hours) {
    const nd = delayDate(hours);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, due_date: nd, status: "pending" } : t));
    await supabase.from('tasks').update({ due_date: nd, status: "pending" }).eq('id', id);
  }

  async function toggleSubtask(taskId, subtaskId, done) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, subtasks: t.subtasks?.map(s => s.id === subtaskId ? { ...s, done: !s.done } : s) } : t));
    await supabase.from('subtasks').update({ done: !done }).eq('id', subtaskId);
  }

  async function addSubtask(taskId, title) {
    if (!title.trim()) return;
    const { data } = await supabase.from('subtasks').insert({ task_id: taskId, title: title.trim(), done: false, order_index: 0 }).select().single();
    if (data) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), data] } : t));
  }

  function startEdit(task) { setEditingTask(task.id); setEditValues({ title: task.title, notes: task.notes || "", priority: task.priority, category: task.category, due_date: task.due_date ? new Date(task.due_date).toISOString().slice(0,16) : "", phone: task.phone || "" }); }
  async function saveEdit(id) {
    const updates = { ...editValues, due_date: editValues.due_date ? new Date(editValues.due_date).toISOString() : null, last_activity: new Date().toISOString() };
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    await supabase.from('tasks').update(updates).eq('id', id);
    setEditingTask(null);
    // If phone added and name detected, offer to save to contacts
    if (editValues.phone && editValues.title) {
      const nameMatch = editValues.title.match(/call\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      if (nameMatch) setContactPrompt({ taskId: id, name: nameMatch[1], phone: editValues.phone });
    }
  }

  async function addTaskToGroup(caseId, groupName) {
    if (!newTaskTitle.trim()) return;
    const caseData = cases.find(c => c.id === caseId);
    const { data } = await supabase.from('tasks').insert({
      user_id: user.id, case_id: caseId, title: newTaskTitle.trim(), notes: "", priority: "medium", status: "pending",
      category: "Families", family_name: caseData?.family_name, group_name: groupName,
      is_arrangement_task: false, debrief_done: false, created_at: new Date().toISOString(), last_activity: new Date().toISOString()
    }).select().single();
    if (data) setTasks(prev => [...prev, { ...data, subtasks: [] }]);
    setNewTaskTitle(""); setAddingTaskToGroup(null);
  }

  async function reorderTasksInGroup(caseId, groupName, fromIdx, toIdx) {
    const groupTasks = tasks.filter(t => t.case_id === caseId && (t.group_name || "General") === groupName);
    const arr = [...groupTasks];
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    // Update order in state
    const otherTasks = tasks.filter(t => !(t.case_id === caseId && (t.group_name || "General") === groupName));
    setTasks([...otherTasks, ...arr]);
  }

  async function dropTaskToCase(taskId, caseId) {
    const caseData = cases.find(c => c.id === caseId);
    if (!caseData) return;
    const updates = { case_id: caseId, family_name: caseData.family_name, category: "Families", last_activity: new Date().toISOString() };
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    await supabase.from('tasks').update(updates).eq('id', taskId);
    setDragOverCase(null);
  }

  async function handleCloseCase(caseId) {
    if (!window.confirm("Close this case and move all tasks to History?")) return;
    await supabase.from('cases').update({ closed_at: new Date().toISOString() }).eq('id', caseId);
    await supabase.from('tasks').update({ status: "done", completed_at: new Date().toISOString() }).eq('case_id', caseId).eq('status', 'pending');
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, closed_at: new Date().toISOString() } : c));
    await reloadTasks(); setOpenCase(null);
  }

  async function handleDeleteCase(caseId) {
    if (!window.confirm("Delete this case and all tasks? Cannot be undone.")) return;
    await dbDeleteCase(caseId); setCases(prev => prev.filter(c => c.id !== caseId)); setTasks(prev => prev.filter(t => t.case_id !== caseId)); setOpenCase(null);
  }

  async function saveCaseEdit() {
    await supabase.from('cases').update({ ...editCaseValues, last_activity: new Date().toISOString() }).eq('id', editingCase);
    setCases(prev => prev.map(c => c.id === editingCase ? { ...c, ...editCaseValues } : c));
    setEditingCase(null);
  }

  async function createFamilyWorkflow() {
    const { name, dob, dod, sex, template: tid } = familyIntake;
    if (!name.trim()) return;
    const tmpl = templates.find(t => t.id === tid) || templates[0];
    const familyName = name.split(" ").pop();
    const caseSlug = familyName.toLowerCase();
    const { data: newCase } = await upsertCase(user.id, { family_name: familyName, case_slug: caseSlug, template_used: tmpl.name, dob: dob || null, dod: dod || null, sex: sex || null });
    if (!newCase) return;
    setCases(prev => [newCase, ...prev]);
    const taskInserts = [
      { title: `${name} — Arrangement Conference`, notes: "", priority: "high", status: "pending", category: "Families", family_name: familyName, case_id: newCase.id, group_name: "Arrangement", is_arrangement_task: true, debrief_done: false, user_id: user.id, created_at: new Date().toISOString(), last_activity: new Date().toISOString() },
      ...tmpl.groups.flatMap(g => g.tasks.map(title => ({ title: `${name} — ${title}`, notes: "", priority: ["Death Certificate","Crematory","Prep"].includes(g.name) ? "high" : "medium", status: "pending", category: "Families", family_name: familyName, case_id: newCase.id, group_name: g.name, is_arrangement_task: false, debrief_done: false, user_id: user.id, created_at: new Date().toISOString(), last_activity: new Date().toISOString() })))
    ];
    const { data: newTasks } = await supabase.from('tasks').insert(taskInserts).select();
    if (newTasks) setTasks(prev => [...prev, ...newTasks.map(t => ({ ...t, subtasks: [] }))]);
    await logActivity(newCase.id, user.id, "case_created", `${tmpl.name} workflow created`);
    setMessages(prev => [...prev, { role: "assistant", content: `${tmpl.name} workflow created for the ${familyName} family. Tap the case folder in Tasks to see them.` }]);
    setShowFamilyIntake(false); setFamilyIntake({ name: "", dob: "", dod: "", sex: "", template: "cremation" }); setActiveTab(1);
  }

  function activateQuietMode(h) { const until = new Date(); until.setHours(until.getHours() + h); updateSettings({ quiet_mode: true, quiet_until: until.toISOString() }); setShowQuietMode(false); }

  async function handleFeedback() { if (!feedback.trim()) return; await saveFeedback(user.id, feedback); setFeedbackSent(true); setFeedback(""); setTimeout(() => setFeedbackSent(false), 2000); }

  async function handleDocUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    setUploadingDoc(true);
    try {
      const { error } = await uploadDocument(user.id, file);
      if (error) { alert("Upload failed. Try again."); } else { const { data } = await getDocuments(user.id); if (data) setDocuments(data); }
    } finally { setUploadingDoc(false); }
  }

  async function saveContactFromPrompt() {
    if (!contactPrompt) return;
    const exists = contacts.find(c => c.name.toLowerCase() === contactPrompt.name.toLowerCase());
    if (!exists) { await upsertContact(user.id, { name: contactPrompt.name, phone: contactPrompt.phone, type: "vendor" }); const { data } = await getContacts(user.id); if (data) setContacts(data); }
    setContactPrompt(null);
  }

  function handleTouchStart(e) { startXRef.current = e.touches[0].clientX; }
  function handleTouchEnd(e) {
    if (startXRef.current === null) return;
    const diff = startXRef.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 120) { if (diff > 0) setActiveTab(t => Math.min(t+1, 2)); else setActiveTab(t => Math.max(t-1, 0)); }
    startXRef.current = null;
  }

  // Computed
  const pending = tasks.filter(t => t.status === "pending");
  const overdue = pending.filter(isOverdue);
  const urgentGeneral = pending.filter(t => !t.case_id && isUrgent(t));
  const activeCasesBase = cases.filter(c => !c.closed_at);
  const activeCases = caseOrder.length > 0
    ? [...activeCasesBase].sort((a,b) => caseOrder.indexOf(a.id) - caseOrder.indexOf(b.id))
    : activeCasesBase.sort((a,b) => new Date(b.last_activity) - new Date(a.last_activity));
  const generalTasksBase = tasks.filter(t => !t.case_id && t.status === "pending" && !isUrgent(t));
  const generalTasks = generalTaskOrder.length > 0
    ? [...generalTasksBase].sort((a,b) => generalTaskOrder.indexOf(a.id) - generalTaskOrder.indexOf(b.id))
    : generalTasksBase;
  const doneTasks = tasks.filter(t => t.status === "done");
  const familyFolders = [...new Set(doneTasks.map(t => t.family_name).filter(Boolean))];
  const allHistoryFolders = ["General", ...familyFolders];
  const historyFiltered = historyFolder === "all" ? doneTasks
    : historyFolder === "General" ? doneTasks.filter(t => !t.family_name)
    : doneTasks.filter(t => t.family_name === historyFolder);
  const openCaseData = openCase ? cases.find(c => c.id === openCase) : null;
  const openCaseTasks = openCaseData ? tasks.filter(t => t.case_id === openCase) : [];
  const openCaseGroups = [...new Set(openCaseTasks.map(t => t.group_name || "General"))].map(g => ({ name: g, tasks: openCaseTasks.filter(t => (t.group_name || "General") === g) }));
  const monthlyCount = tasks.filter(t => { if (t.status !== "done" || !t.completed_at) return false; const d = new Date(t.completed_at); return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear(); }).length;

  // Theme
  const bg = darkMode ? "linear-gradient(135deg,#0f172a,#1a1035,#0f172a)" : "linear-gradient(135deg,#f0f9ff,#f5f0ff,#f0f9ff)";
  const tc = darkMode ? "#e2e8f0" : "#1e293b";
  const mc = darkMode ? "#64748b" : "#94a3b8";
  const cb = darkMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.8)";
  const brd = darkMode ? "rgba(167,139,250,0.15)" : "rgba(167,139,250,0.3)";
  const ibg = darkMode ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)";
  const is = { background: ibg, border: `1px solid ${brd}`, borderRadius: "10px", color: tc, padding: "8px 12px", fontSize: "13px", fontFamily: "inherit", outline: "none" };

  function TaskCard({ task, groupName, caseId }) {
    const [addingSub, setAddingSub] = useState(false);
    const [newSub, setNewSub] = useState("");
    const drag = useLongPressDrag(task.subtasks || [], (fi, ti) => {
      const arr = [...(task.subtasks || [])];
      const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m);
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, subtasks: arr } : t));
    });

    if (editingTask === task.id) return (
      <div style={{ background: cb, border: `1px solid ${brd}`, borderLeft: `4px solid ${getUrgencyColor(task)}`, borderRadius: "14px", padding: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <input value={editValues.title} onChange={e => setEditValues(v => ({ ...v, title: e.target.value }))} style={{ ...is, width: "100%", fontWeight: 700 }} />
          <textarea value={editValues.notes} onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))} placeholder="Notes..." rows={2} style={{ ...is, width: "100%", lineHeight: "1.4" }} />
          <div style={{ display: "flex", gap: "6px" }}>
            <select value={editValues.priority} onChange={e => setEditValues(v => ({ ...v, priority: e.target.value }))} style={{ ...is, flex: 1 }}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            <select value={editValues.category} onChange={e => setEditValues(v => ({ ...v, category: e.target.value }))} style={{ ...is, flex: 1 }}>{["Operations","Families","Compliance","Admin","Marketing","Personal"].map(c => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <input type="datetime-local" value={editValues.due_date} onChange={e => setEditValues(v => ({ ...v, due_date: e.target.value }))} style={{ ...is, width: "100%" }} />
          <input value={editValues.phone || ""} onChange={e => setEditValues(v => ({ ...v, phone: e.target.value }))} placeholder="Phone number (optional)" style={{ ...is, width: "100%" }} />
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={() => saveEdit(task.id)} style={{ flex: 1, background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "8px", color: "#fff", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>Save</button>
            <button onClick={() => setEditingTask(null)} style={{ flex: 1, background: "none", border: `1px solid ${brd}`, borderRadius: "8px", color: mc, padding: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}>Cancel</button>
          </div>
        </div>
      </div>
    );

    const urgent = isUrgent(task);
    const calLink = gcalLink(task.title, task.due_date);
    return (
      <div data-drag-id={task.id} style={{ background: cb, border: `1px solid ${isOverdue(task) ? "rgba(239,68,68,0.2)" : brd}`, borderLeft: `4px solid ${getUrgencyColor(task)}`, borderRadius: "14px", padding: "11px 12px", opacity: task.status === "done" ? 0.45 : 1, transition: "all .15s" }}>
        <div style={{ display: "flex", gap: "9px", alignItems: "flex-start" }}>
          <button onClick={() => toggleTask(task.id)} style={{ width: "22px", height: "22px", minWidth: "22px", borderRadius: "50%", border: `2px solid ${task.status === "done" ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: task.status === "done" ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "2px", flexShrink: 0 }}>
            {task.status === "done" && <span style={{ fontSize: "11px", color: "#fff", fontWeight: 700 }}>✓</span>}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: task.status === "done" ? mc : tc, textDecoration: task.status === "done" ? "line-through" : "none", marginBottom: "2px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }} onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
              <span style={{ flex: 1 }}>{task.title.includes(" — ") ? task.title.split(" — ").slice(1).join(" — ") : task.title}</span>
              {urgent && <span style={{ fontSize: "9px", background: "#ff006e22", color: "#ff006e", padding: "2px 6px", borderRadius: "4px", fontWeight: 700, flexShrink: 0 }}>URGENT</span>}
            </div>
            {task.due_date && <div style={{ fontSize: "11px", fontWeight: 800, color: getUrgencyColor(task), marginBottom: "3px" }}>{fmtDate(task.due_date)} at {fmtTime(task.due_date)}</div>}
            {task.family_name && !openCase && <div style={{ fontSize: "10px", color: "#a78bfa", marginBottom: "3px" }}>👨‍👩‍👧 {task.family_name}</div>}
            {expandedTask === task.id && (
              <div style={{ marginTop: "6px" }}>
                {task.notes && <div style={{ fontSize: "11px", color: mc, marginBottom: "6px", lineHeight: 1.5 }}>{task.notes}</div>}
                {/* Subtasks */}
                {(task.subtasks || []).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "6px" }}>
                    {task.subtasks.map(sub => (
                      <div key={sub.id} data-drag-id={sub.id}
                        onTouchStart={e => drag.onTouchStart(e, sub.id)}
                        onTouchMove={drag.onTouchMove}
                        onTouchEnd={drag.onTouchEnd}
                        style={{ display: "flex", gap: "6px", alignItems: "center", opacity: drag.dragId === sub.id ? 0.5 : 1 }}>
                        <span style={{ color: mc, fontSize: "12px", cursor: "grab" }}>⠿</span>
                        <button onClick={() => toggleSubtask(task.id, sub.id, sub.done)} style={{ width: "16px", height: "16px", minWidth: "16px", borderRadius: "3px", border: `2px solid ${sub.done ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: sub.done ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{sub.done && <span style={{ fontSize: "8px", color: "#fff", fontWeight: 700 }}>✓</span>}</button>
                        <span style={{ fontSize: "12px", color: sub.done ? mc : tc, textDecoration: sub.done ? "line-through" : "none", flex: 1 }}>{sub.title}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Add subtask */}
                {addingSub ? (
                  <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
                    <input value={newSub} onChange={e => setNewSub(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { addSubtask(task.id, newSub); setNewSub(""); setAddingSub(false); } }} placeholder="Subtask..." style={{ ...is, flex: 1, padding: "4px 8px", fontSize: "12px" }} autoFocus />
                    <button onClick={() => { addSubtask(task.id, newSub); setNewSub(""); setAddingSub(false); }} style={{ background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "6px", color: "#fff", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>+</button>
                    <button onClick={() => { setAddingSub(false); setNewSub(""); }} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: mc, padding: "4px 8px", cursor: "pointer", fontSize: "11px" }}>×</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingSub(true)} style={{ background: "none", border: `1px dashed ${brd}`, borderRadius: "6px", color: mc, padding: "2px 8px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", marginBottom: "6px" }}>+ subtask</button>
                )}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
                  {task.phone && <a href={`tel:${task.phone}`} style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: "6px", color: "#34d399", padding: "4px 10px", fontSize: "11px", fontWeight: 700, textDecoration: "none" }}>📞 Call</a>}
                  {calLink && <a href={calLink} target="_blank" rel="noreferrer" style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: "6px", color: "#22d3ee", padding: "4px 10px", fontSize: "11px", fontWeight: 700, textDecoration: "none" }}>📅 Cal</a>}
                  {task.status === "pending" && <>
                    <span style={{ fontSize: "10px", color: mc, alignSelf: "center" }}>Delay:</span>
                    {[["1hr",1],["4hr",4],["12hr",12]].map(([label,hrs]) => <button key={label} onClick={() => delayTask(task.id, hrs)} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "6px", color: "#a78bfa", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 700 }}>{label}</button>)}
                    <button onClick={() => startEdit(task)} style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", borderRadius: "6px", color: "#22d3ee", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 700 }}>✏️</button>
                  </>}
                  <button onClick={() => handleDeleteTask(task.id)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", color: "#ef4444", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 700 }}>🗑</button>
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", color: catColors[task.category] || mc, background: `${catColors[task.category] || mc}18`, border: `1px solid ${catColors[task.category] || mc}33`, padding: "2px 7px", borderRadius: "20px" }}>{task.category}</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, color: priColors[task.priority], textTransform: "uppercase" }}>{task.priority}</span>
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
        .tb{transition:all .15s}
        .fp{transition:all .12s;cursor:pointer}
        .ib{background:none;border:none;cursor:pointer;padding:4px;transition:all .15s}
        .ib:hover{transform:scale(1.1)}
        .stb{cursor:pointer;transition:all .15s}
        .case-folder{transition:all .15s;cursor:pointer}
        .case-folder:hover{border-color:rgba(167,139,250,0.4)!important;transform:translateY(-1px)}
        .case-folder.drag-over{border-color:#22d3ee!important;background:rgba(34,211,238,0.08)!important}
        .group-row{transition:all .15s;cursor:pointer}
        .group-row:hover{background:rgba(167,139,250,0.05)!important}
      `}</style>

      {/* Quiet banner */}
      {quietMode && <div style={{ background: "rgba(99,102,241,0.15)", borderBottom: "1px solid rgba(99,102,241,0.3)", padding: "6px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}><span style={{ fontSize: "11px", color: "#a5b4fc", fontWeight: 600 }}>🔕 Quiet mode until {fmtTime(settings.quiet_until)}</span><button onClick={() => updateSettings({ quiet_mode: false, quiet_until: null })} style={{ background: "none", border: "none", color: "#a5b4fc", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}>End</button></div>}

      {/* Header */}
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px", background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)", borderBottom: `1px solid ${brd}`, backdropFilter: "blur(10px)", zIndex: 10, flexShrink: 0 }}>
        <KarenMascot size={40} animated />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "18px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Kare-N</div>
          <div style={{ fontSize: "10px", color: mc }}>Hey {memberName} 👋 {extracting && <span style={{ color: "#a78bfa", animation: "pulse 1s infinite" }}>saving...</span>}</div>
        </div>
        <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
          {overdue.length > 0 && <div className="stb" onClick={() => { setActiveTab(1); setOpenCase(null); }} style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "3px 8px", textAlign: "center" }}><div style={{ color: "#ef4444", fontWeight: 700, fontSize: "12px" }}>{overdue.length}</div><div style={{ color: "#ef4444", opacity: 0.7, fontSize: "9px" }}>overdue</div></div>}
          <div className="stb" onClick={() => { setActiveTab(1); setOpenCase(null); }} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "8px", padding: "3px 8px", textAlign: "center" }}><div style={{ color: "#a78bfa", fontWeight: 700, fontSize: "12px" }}>{pending.length}</div><div style={{ color: "#a78bfa", opacity: 0.7, fontSize: "9px" }}>pending</div></div>
          <button className="ib" onClick={() => setShowQuietMode(true)} style={{ fontSize: "17px" }}>{quietMode ? "🔕" : "🔔"}</button>
          <button className="ib" onClick={() => setShowSettings(true)} style={{ fontSize: "18px" }}>⚙️</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: darkMode ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.5)", borderBottom: `1px solid ${brd}`, position: "relative", zIndex: 10, flexShrink: 0 }}>
        {["Chat","Tasks","History"].map((tab, i) => (
          <button key={tab} className="tb" onClick={() => { setActiveTab(i); if (i !== 1) setOpenCase(null); }} style={{ flex: 1, padding: "10px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === i ? "#a78bfa" : "transparent"}`, color: activeTab === i ? "#a78bfa" : mc, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", transition: "all .2s" }}>
            {tab}{tab === "Tasks" && pending.length > 0 && <span style={{ marginLeft: "4px", background: "rgba(167,139,250,0.2)", color: "#a78bfa", padding: "1px 5px", borderRadius: "10px", fontSize: "9px" }}>{pending.length}</span>}
          </button>
        ))}
        <div style={{ position: "absolute", bottom: "-14px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "4px", zIndex: 5 }}>
          {[0,1,2].map(i => <div key={i} style={{ width: i === activeTab ? "14px" : "5px", height: "5px", borderRadius: "3px", background: i === activeTab ? "#a78bfa" : "#334155", transition: "all .2s" }} />)}
        </div>
      </div>
      <div style={{ height: "14px", flexShrink: 0 }} />

      {/* CHAT */}
      {activeTab === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: "0 14px 8px", flexShrink: 0, display: "flex", gap: "8px" }}>
            <button onClick={() => setShowFamilyIntake(true)} style={{ flex: 1, background: "linear-gradient(135deg,#22d3ee22,#a78bfa22)", border: `1px solid ${brd}`, borderRadius: "12px", color: "#a78bfa", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>👨‍👩‍👧 New Family Case</button>
            {pendingDebrief && <button onClick={() => setMessages(prev => [...prev, { role: "assistant", content: `Ready to debrief the ${pendingDebrief.family_name || ""} arrangement? Tell me what I need to know.` }])} style={{ background: "rgba(255,190,11,0.15)", border: "1px solid rgba(255,190,11,0.3)", borderRadius: "12px", color: "#ffbe0b", padding: "8px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "11px", whiteSpace: "nowrap", animation: "pulse 2s infinite" }}>📋 Debrief</button>}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 14px 12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {messages.map((m, i) => (
              <div key={i} className="mb" style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: "8px", alignItems: "flex-end" }}>
                {m.role === "assistant" && <div style={{ flexShrink: 0, marginBottom: "2px" }}><KarenMascot size={26} /></div>}
                <div style={{ maxWidth: "80%", padding: "10px 14px", paddingBottom: m.role === "assistant" ? "24px" : "10px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px", background: m.role === "user" ? (darkMode ? "linear-gradient(135deg,#1e3a5f,#1a1045)" : "linear-gradient(135deg,#dbeafe,#ede9fe)") : cb, border: `1px solid ${m.role === "user" ? "rgba(34,211,238,0.2)" : brd}`, fontSize: "13px", lineHeight: "1.6", color: m.role === "user" ? (darkMode ? "#bae6fd" : "#1e3a5f") : tc, whiteSpace: "pre-wrap", position: "relative" }}>
                  {m.content}
                  {m.role === "assistant" && settings.voice_enabled && <button onClick={() => speak(m.content, settings.selected_voice, quietMode)} style={{ position: "absolute", bottom: "4px", right: "8px", background: "none", border: "none", color: mc, cursor: "pointer", fontSize: "14px", opacity: 0.6, padding: "2px" }}>🔊</button>}
                </div>
              </div>
            ))}
            {loading && <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}><KarenMascot size={26} animated /><div style={{ padding: "10px 14px", background: cb, border: `1px solid ${brd}`, borderRadius: "4px 18px 18px 18px", display: "flex", gap: "5px", alignItems: "center" }}>{[0,1,2].map(i => <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee,#a78bfa)", animation: `pd 1.2s ${i*0.2}s infinite` }} />)}</div></div>}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${brd}`, background: darkMode ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.9)", backdropFilter: "blur(10px)", display: "flex", gap: "8px", alignItems: "flex-end", flexShrink: 0 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder={listening ? "Listening..." : "Tell me what you need to do..."} rows={2}
                style={{ width: "100%", background: ibg, border: `1px solid ${listening ? "#a78bfa" : brd}`, borderRadius: "14px", color: tc, padding: "10px 48px 10px 14px", fontSize: "13px", fontFamily: "inherit", outline: "none", lineHeight: "1.5" }} />
              <button onClick={toggleVoice} style={{ position: "absolute", right: "10px", bottom: "10px", width: "30px", height: "30px", borderRadius: "50%", background: listening ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(167,139,250,0.2)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>{listening ? "⏹" : "🎙"}</button>
            </div>
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{ width: "44px", height: "44px", borderRadius: "14px", background: loading || !input.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", transition: "all .2s", flexShrink: 0 }}>{loading ? "⏳" : "✈️"}</button>
          </div>
        </div>
      )}

      {/* TASKS main */}
      {activeTab === 1 && !openCase && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {urgentGeneral.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#ff006e", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ff006e", animation: "pd 1.5s infinite" }} /> Due Within 16 Hours
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {urgentGeneral.map((task, idx) => (
                  <div key={task.id} draggable onDragStart={e => e.dataTransfer.setData("taskId", task.id)}>
                    <TaskCard task={task} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {generalTasks.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: mc, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>General</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {generalTasks.map((task, idx) => (
                  <div key={task.id} draggable
                    onDragStart={e => e.dataTransfer.setData("taskId", task.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      const fromId = e.dataTransfer.getData("taskId");
                      const fromIdx = generalTasks.findIndex(t => t.id === fromId);
                      if (fromIdx !== -1 && fromIdx !== idx) {
                        const arr = [...generalTasks];
                        const [m] = arr.splice(fromIdx, 1);
                        arr.splice(idx, 0, m);
                        setGeneralTaskOrder(arr.map(t => t.id));
                      }
                    }}>
                    <TaskCard task={task} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeCases.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: mc, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Family Cases</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {activeCases.map((c, idx) => {
                  const caseTasks = tasks.filter(t => t.case_id === c.id);
                  const cp = caseTasks.filter(t => t.status === "pending");
                  const dot = getCaseDot(caseTasks);
                  return (
                    <div key={c.id}
                      className={`case-folder${dragOverCase === c.id ? " drag-over" : ""}`}
                      draggable
                      onClick={() => setOpenCase(c.id)}
                      onDragStart={e => e.dataTransfer.setData("caseId", c.id)}
                      onDragOver={e => { e.preventDefault(); setDragOverCase(c.id); }}
                      onDragLeave={() => setDragOverCase(null)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverCase(null);
                        const tid = e.dataTransfer.getData("taskId");
                        const fromCaseId = e.dataTransfer.getData("caseId");
                        if (tid) { dropTaskToCase(tid, c.id); return; }
                        if (fromCaseId && fromCaseId !== c.id) {
                          const fromIdx2 = activeCases.findIndex(cs => cs.id === fromCaseId);
                          if (fromIdx2 !== -1) {
                            const arr = [...activeCases];
                            const [m] = arr.splice(fromIdx2, 1);
                            arr.splice(idx, 0, m);
                            setCaseOrder(arr.map(cs => cs.id));
                          }
                        }
                      }}
                      style={{ background: cb, border: `1px solid ${brd}`, borderRadius: "14px", padding: "14px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ position: "relative", width: "40px", height: "40px", flexShrink: 0 }}>
                        <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "linear-gradient(135deg,#22d3ee33,#a78bfa33)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>👨‍👩‍👧</div>
                        {dot && <div style={{ position: "absolute", top: "-3px", right: "-3px", width: "12px", height: "12px", borderRadius: "50%", background: dot, border: "2px solid " + (darkMode ? "#0f172a" : "#f0f9ff"), boxShadow: `0 0 6px ${dot}` }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: tc, marginBottom: "3px" }}>{c.family_name} Family</div>
                        <div style={{ fontSize: "11px", color: mc }}>{cp.length} pending</div>
                      </div>
                      <div style={{ color: mc, fontSize: "18px" }}>›</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {tasks.filter(t => t.status === "pending").length === 0 && activeCases.length === 0 && <div style={{ textAlign: "center", marginTop: "40px" }}><KarenMascot size={50} animated /><div style={{ color: mc, fontSize: "13px", marginTop: "12px" }}>No active tasks or cases.</div></div>}
        </div>
      )}

      {/* CASE DETAIL */}
      {activeTab === 1 && openCase && openCaseData && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {editingCase === openCase ? (
            <div style={{ background: cb, border: `1px solid ${brd}`, borderRadius: "14px", padding: "14px", marginBottom: "14px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input value={editCaseValues.family_name || ""} onChange={e => setEditCaseValues(v => ({ ...v, family_name: e.target.value }))} placeholder="Family name" style={{ ...is, width: "100%", fontWeight: 700 }} />
                <div style={{ display: "flex", gap: "8px" }}>
                  <input value={editCaseValues.nok_name || ""} onChange={e => setEditCaseValues(v => ({ ...v, nok_name: e.target.value }))} placeholder="NOK name" style={{ ...is, flex: 1 }} />
                  <input value={editCaseValues.nok_phone || ""} onChange={e => setEditCaseValues(v => ({ ...v, nok_phone: e.target.value }))} placeholder="NOK phone" style={{ ...is, flex: 1 }} />
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <div style={{ flex: 1 }}><label style={{ fontSize: "10px", color: mc, display: "block", marginBottom: "3px" }}>DOB</label><input type="date" value={editCaseValues.dob || ""} onChange={e => setEditCaseValues(v => ({ ...v, dob: e.target.value }))} style={{ ...is, width: "100%" }} /></div>
                  <div style={{ flex: 1 }}><label style={{ fontSize: "10px", color: mc, display: "block", marginBottom: "3px" }}>DOD</label><input type="date" value={editCaseValues.dod || ""} onChange={e => setEditCaseValues(v => ({ ...v, dod: e.target.value }))} style={{ ...is, width: "100%" }} /></div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  {["Male","Female","Other"].map(s => <button key={s} onClick={() => setEditCaseValues(v => ({ ...v, sex: s }))} style={{ flex: 1, padding: "6px", background: editCaseValues.sex === s ? "linear-gradient(135deg,#22d3ee44,#a78bfa44)" : ibg, border: `1px solid ${editCaseValues.sex === s ? "#a78bfa" : brd}`, borderRadius: "8px", color: editCaseValues.sex === s ? "#a78bfa" : mc, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{s}</button>)}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={saveCaseEdit} style={{ flex: 1, background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "8px", color: "#fff", padding: "8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>Save</button>
                  <button onClick={() => setEditingCase(null)} style={{ flex: 1, background: "none", border: `1px solid ${brd}`, borderRadius: "8px", color: mc, padding: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}>Cancel</button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
              <button onClick={() => setOpenCase(null)} style={{ background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "8px", color: "#fff", padding: "7px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 700 }}>← Back</button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "16px", fontWeight: 800, color: tc }}>{openCaseData.family_name} Family</div>
                <div style={{ fontSize: "11px", color: mc }}>{openCaseTasks.filter(t => t.status === "pending").length} pending · {openCaseTasks.filter(t => t.status === "done").length} done</div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={() => { setEditingCase(openCase); setEditCaseValues({ family_name: openCaseData.family_name, nok_name: openCaseData.nok_name || "", nok_phone: openCaseData.nok_phone || "", dob: openCaseData.dob || "", dod: openCaseData.dod || "", sex: openCaseData.sex || "" }); }} style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: "8px", color: "#a78bfa", padding: "7px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700 }}>✏️</button>
                <button onClick={() => handleCloseCase(openCase)} style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${brd}`, borderRadius: "8px", color: tc, padding: "7px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700 }}>Close</button>
                <button onClick={() => handleDeleteCase(openCase)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", color: "#ef4444", padding: "7px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700 }}>🗑</button>
              </div>
            </div>
          )}

          {openCaseData.nok_phone && !editingCase && <a href={`tel:${openCaseData.nok_phone}`} style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: "12px", padding: "10px 14px", marginBottom: "14px", textDecoration: "none" }}><span style={{ fontSize: "20px" }}>📞</span><div><div style={{ fontSize: "12px", fontWeight: 700, color: "#34d399" }}>Call {openCaseData.nok_name || "NOK"}</div><div style={{ fontSize: "10px", color: mc }}>{openCaseData.nok_phone}</div></div></a>}

          {openCaseGroups.map(group => {
            const key = `${openCase}-${group.name}`;
            const expanded = expandedGroups[key] || false;
            const doneCount = group.tasks.filter(t => t.status === "done").length;
            const allDone = doneCount === group.tasks.length;
            const drag = useLongPressDrag(group.tasks, (fi, ti) => reorderTasksInGroup(openCase, group.name, fi, ti));
            return (
              <div key={group.name} style={{ marginBottom: "10px" }}>
                <div className="group-row" onClick={() => setExpandedGroups(prev => ({ ...prev, [key]: !expanded }))}
                  style={{ display: "flex", alignItems: "center", gap: "10px", background: cb, border: `1px solid ${brd}`, borderRadius: "12px", padding: "12px 14px" }}>
                  <div style={{ flex: 1 }}><div style={{ fontSize: "13px", fontWeight: 700, color: allDone ? mc : tc, textDecoration: allDone ? "line-through" : "none" }}>{group.name}</div><div style={{ fontSize: "10px", color: mc, marginTop: "2px" }}>{doneCount}/{group.tasks.length} complete</div></div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    {allDone && <span style={{ fontSize: "14px" }}>✅</span>}
                    <div style={{ color: mc, fontSize: "16px", transition: "transform .2s", transform: expanded ? "rotate(90deg)" : "rotate(0)" }}>›</div>
                  </div>
                </div>
                {expanded && (
                  <div style={{ marginTop: "6px", paddingLeft: "8px" }}
                    onTouchMove={drag.onTouchMove} onTouchEnd={drag.onTouchEnd}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {group.tasks.map((task, idx) => (
                        <div key={task.id} data-drag-id={task.id} onTouchStart={e => drag.onTouchStart(e, task.id)}
                          style={{ opacity: drag.dragId === task.id ? 0.5 : 1, transform: drag.dragId === task.id ? "scale(1.02)" : "scale(1)", transition: "all .15s" }}>
                          <TaskCard task={task} groupName={group.name} caseId={openCase} />
                        </div>
                      ))}
                    </div>
                    {/* Add task to group */}
                    {addingTaskToGroup === key ? (
                      <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                        <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addTaskToGroup(openCase, group.name); }} placeholder="New task..." style={{ ...is, flex: 1, padding: "6px 10px", fontSize: "12px" }} autoFocus />
                        <button onClick={() => addTaskToGroup(openCase, group.name)} style={{ background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "8px", color: "#fff", padding: "6px 10px", cursor: "pointer", fontSize: "12px", fontFamily: "inherit", fontWeight: 700 }}>Add</button>
                        <button onClick={() => { setAddingTaskToGroup(null); setNewTaskTitle(""); }} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "8px", color: mc, padding: "6px 10px", cursor: "pointer", fontSize: "12px" }}>×</button>
                      </div>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); setAddingTaskToGroup(key); setNewTaskTitle(""); }} style={{ marginTop: "6px", background: "none", border: `1px dashed ${brd}`, borderRadius: "8px", color: mc, padding: "5px 12px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", width: "100%" }}>+ Add task to {group.name}</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Case notes */}
          <div style={{ marginTop: "16px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: mc, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Case Notes</div>
            <textarea value={caseNotes[openCase] || ""} onChange={async e => { const val = e.target.value; setCaseNotes(prev => ({ ...prev, [openCase]: val })); await upsertCaseNotes(openCase, user.id, val); }} placeholder="Family preferences, sensitivities, special requests, contacts..." rows={5}
              style={{ width: "100%", background: ibg, border: `1px solid ${brd}`, borderRadius: "12px", color: tc, padding: "12px 14px", fontSize: "13px", fontFamily: "inherit", outline: "none", lineHeight: "1.6" }} />
          </div>
        </div>
      )}

      {/* HISTORY */}
      {activeTab === 2 && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {/* Folder tabs */}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "10px" }}>
            {["all", ...allHistoryFolders].map(f => <button key={f} className="fp" onClick={() => { setHistoryFolder(f); setSelectedHistory([]); setHistoryBulkMode(false); }} style={{ padding: "4px 10px", background: historyFolder === f ? "linear-gradient(135deg,#22d3ee88,#a78bfa88)" : ibg, color: historyFolder === f ? "#fff" : mc, border: `1px solid ${historyFolder === f ? "rgba(167,139,250,0.5)" : brd}`, borderRadius: "20px", fontSize: "10px", fontFamily: "inherit", fontWeight: 600, textTransform: "uppercase" }}>{f === "all" ? `All (${doneTasks.length})` : f === "General" ? "📁 General" : `👨‍👩‍👧 ${f}`}</button>)}
          </div>
          {/* Bulk controls */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px", alignItems: "center" }}>
            <button onClick={() => { setHistoryBulkMode(!historyBulkMode); setSelectedHistory([]); }} style={{ background: historyBulkMode ? "rgba(167,139,250,0.2)" : ibg, border: `1px solid ${historyBulkMode ? "#a78bfa" : brd}`, borderRadius: "8px", color: historyBulkMode ? "#a78bfa" : mc, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700 }}>{historyBulkMode ? "✕ Cancel" : "☑ Select"}</button>
            {historyBulkMode && selectedHistory.length > 0 && <>
              <button onClick={async () => { if (window.confirm(`Delete ${selectedHistory.length} tasks?`)) { for (const id of selectedHistory) await dbDeleteTask(id); setTasks(prev => prev.filter(t => !selectedHistory.includes(t.id))); setSelectedHistory([]); setHistoryBulkMode(false); } }} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", color: "#ef4444", padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700 }}>🗑 Delete ({selectedHistory.length})</button>
              <button onClick={() => { if (selectedHistory.length === historyFiltered.length) setSelectedHistory([]); else setSelectedHistory(historyFiltered.map(t => t.id)); }} style={{ background: ibg, border: `1px solid ${brd}`, borderRadius: "8px", color: mc, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px" }}>Select All</button>
            </>}
          </div>
          {historyFiltered.length === 0 ? <div style={{ textAlign: "center", marginTop: "40px" }}><KarenMascot size={50} animated /><div style={{ color: mc, fontSize: "13px", marginTop: "12px" }}>Nothing here yet.</div></div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {historyFiltered.sort((a,b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at)).map((task, idx) => (
                <div key={task.id}
                  draggable
                  onDragStart={e => e.dataTransfer.setData("historyTaskId", task.id)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const fromId = e.dataTransfer.getData("historyTaskId");
                    if (fromId && fromId !== task.id) {
                      // Reorder within current folder view
                      const arr = [...historyFiltered];
                      const fromIdx = arr.findIndex(t => t.id === fromId);
                      const toIdx = idx;
                      if (fromIdx !== -1) { const [m] = arr.splice(fromIdx, 1); arr.splice(toIdx, 0, m); }
                    }
                  }}
                  style={{ background: cb, border: `1px solid ${selectedHistory.includes(task.id) ? "#a78bfa" : brd}`, borderLeft: "3px solid #1e293b", borderRadius: "12px", padding: "10px 12px", opacity: 0.65, cursor: "grab" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {historyBulkMode && (
                      <button onClick={() => setSelectedHistory(prev => prev.includes(task.id) ? prev.filter(i => i !== task.id) : [...prev, task.id])} style={{ width: "20px", height: "20px", minWidth: "20px", borderRadius: "4px", border: `2px solid ${selectedHistory.includes(task.id) ? "#a78bfa" : "rgba(167,139,250,0.3)"}`, background: selectedHistory.includes(task.id) ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {selectedHistory.includes(task.id) && <span style={{ fontSize: "10px", color: "#fff", fontWeight: 700 }}>✓</span>}
                      </button>
                    )}
                    {!historyBulkMode && <span style={{ fontSize: "16px" }}>✅</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, textDecoration: "line-through", color: mc }}>{task.title}</div>
                      <div style={{ fontSize: "10px", color: mc, marginTop: "2px", display: "flex", gap: "8px" }}>
                        <span>{task.completed_at ? fmtDate(task.completed_at) : "Completed"}</span>
                        {task.family_name && <span>👨‍👩‍👧 {task.family_name}</span>}
                        {!task.family_name && <span>📁 General</span>}
                      </div>
                    </div>
                    {!historyBulkMode && <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                      <button onClick={() => toggleTask(task.id)} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: "#a78bfa", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>↩</button>
                      <button onClick={() => setMovingHistoryTask(movingHistoryTask === task.id ? null : task.id)} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: mc, padding: "4px 8px", cursor: "pointer", fontSize: "11px" }}>📁</button>
                      <button onClick={() => { if (window.confirm("Delete from history?")) handleDeleteTask(task.id); }} style={{ background: "none", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", color: "#ef4444", padding: "4px 8px", cursor: "pointer", fontSize: "11px" }}>🗑</button>
                    </div>}
                  </div>
                  {movingHistoryTask === task.id && (
                    <div style={{ marginTop: "8px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10px", color: mc, alignSelf: "center" }}>Move to:</span>
                      {allHistoryFolders.map(folder => (
                        <button key={folder} onClick={async () => {
                          const fn = folder === "General" ? null : folder;
                          await supabase.from('tasks').update({ family_name: fn }).eq('id', task.id);
                          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, family_name: fn } : t));
                          setMovingHistoryTask(null);
                        }} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: "6px", color: "#a78bfa", padding: "3px 8px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 600 }}>{folder}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick capture */}
      {activeTab !== 0 && (
        <button onClick={() => { setActiveTab(0); setTimeout(() => { inputRef.current?.focus(); if (!listening) { const r = startVoice(t => { setInput(p => p ? p + " " + t : t); setListening(false); }, () => setListening(false)); if (r) { recRef.current = r; setListening(true); } } }, 200); }}
          style={{ position: "fixed", bottom: "20px", left: "20px", width: "54px", height: "54px", borderRadius: "50%", background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", boxShadow: "0 4px 20px rgba(167,139,250,0.4)", zIndex: 50 }}>🎙</button>
      )}

      {/* Contact prompt */}
      {contactPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: darkMode ? "#1a1035" : "#fff", border: `1px solid ${brd}`, borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "320px", textAlign: "center" }}>
            <div style={{ fontSize: "24px", marginBottom: "12px" }}>📞</div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: tc, marginBottom: "8px" }}>Save {contactPrompt.name}?</div>
            <div style={{ fontSize: "13px", color: mc, marginBottom: "20px" }}>Add {contactPrompt.name} to your contacts so Kare-N recognizes them in future conversations.</div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setContactPrompt(null)} style={{ flex: 1, background: "none", border: `1px solid ${brd}`, borderRadius: "12px", color: mc, padding: "10px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}>Not now</button>
              <button onClick={saveContactFromPrompt} style={{ flex: 1, background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "12px", color: "#fff", padding: "10px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>Save Contact</button>
            </div>
          </div>
        </div>
      )}

      {/* Quiet mode */}
      {showQuietMode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: darkMode ? "#1a1035" : "#fff", border: `1px solid ${brd}`, borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "320px" }}>
            <div style={{ fontSize: "16px", fontWeight: 800, color: tc, marginBottom: "16px", textAlign: "center" }}>🔕 Quiet Mode</div>
            <div style={{ fontSize: "13px", color: mc, marginBottom: "16px", textAlign: "center" }}>Silence everything for:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[1,2,3,4].map(h => <button key={h} onClick={() => activateQuietMode(h)} style={{ background: "linear-gradient(135deg,#22d3ee22,#a78bfa22)", border: `1px solid ${brd}`, borderRadius: "12px", color: tc, padding: "12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "14px" }}>{h} hour{h !== 1 ? "s" : ""}</button>)}
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
              {["general","templates","contacts","documents","help"].map(t => <button key={t} onClick={() => setSettingsTab(t)} style={{ flexShrink: 0, padding: "7px 12px", background: settingsTab === t ? "rgba(167,139,250,0.2)" : "none", border: `1px solid ${settingsTab === t ? "#a78bfa" : brd}`, borderRadius: "8px", color: settingsTab === t ? "#a78bfa" : mc, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>{t}</button>)}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
              {settingsTab === "general" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ background: "linear-gradient(135deg,#22d3ee22,#a78bfa22)", border: `1px solid ${brd}`, borderRadius: "14px", padding: "16px", marginBottom: "8px", textAlign: "center" }}>
                    <div style={{ fontSize: "40px", fontWeight: 800, background: "linear-gradient(90deg,#22d3ee,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{monthlyCount}</div>
                    <div style={{ fontSize: "12px", color: mc, fontWeight: 600 }}>tasks completed this month</div>
                  </div>
                  {/* Name field */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${brd}` }}>
                    <div><div style={{ fontSize: "13px", fontWeight: 600, color: tc }}>Your Name</div><div style={{ fontSize: "10px", color: mc }}>What Kare-N calls you</div></div>
                    <input value={displayName} onChange={e => setDisplayName(e.target.value)} onBlur={async () => { if (displayName.trim()) await supabase.from('users').update({ display_name: displayName.trim() }).eq('id', user.id); }} placeholder="Enter your name" style={{ ...is, padding: "5px 10px", width: "140px", textAlign: "right" }} />
                  </div>
                  {[
                    { label: "Appearance", sub: "Dark or light theme", control: <button onClick={() => updateSettings({ dark_mode: !settings.dark_mode })} style={{ background: settings.dark_mode ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(167,139,250,0.2)", border: "none", borderRadius: "20px", padding: "6px 14px", cursor: "pointer", color: settings.dark_mode ? "#fff" : "#a78bfa", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{settings.dark_mode ? "🌙 Dark" : "☀️ Light"}</button> },
                    { label: "Default Due Time", sub: "Used when no time given", control: <input type="time" value={settings.default_due_time} onChange={e => updateSettings({ default_due_time: e.target.value })} style={{ ...is, padding: "5px 8px" }} /> },
                    { label: "Voice Responses", sub: "Kare-N reads messages aloud", control: <button onClick={() => updateSettings({ voice_enabled: !settings.voice_enabled })} style={{ background: settings.voice_enabled ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: `1px solid ${brd}`, borderRadius: "20px", padding: "6px 14px", cursor: "pointer", color: settings.voice_enabled ? "#fff" : mc, fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{settings.voice_enabled ? "On" : "Off"}</button> },
                    { label: "Keep Screen Awake", sub: "Prevent timeout while app is open", control: <button onClick={() => updateSettings({ screen_wake: !settings.screen_wake })} style={{ background: settings.screen_wake ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: `1px solid ${brd}`, borderRadius: "20px", padding: "6px 14px", cursor: "pointer", color: settings.screen_wake ? "#fff" : mc, fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{settings.screen_wake ? "On" : "Off"}</button> },
                  ].map(({ label, sub, control }) => <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${brd}` }}><div><div style={{ fontSize: "13px", fontWeight: 600, color: tc }}>{label}</div><div style={{ fontSize: "10px", color: mc }}>{sub}</div></div>{control}</div>)}
                  <div style={{ padding: "12px 0" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: tc, marginBottom: "10px" }}>Feedback</div>
                    {feedbackSent ? <div style={{ color: "#34d399", fontWeight: 700 }}>✓ Sent!</div> : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><textarea value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="What's working, what's not..." rows={3} style={{ ...is, width: "100%", lineHeight: "1.5" }} /><button onClick={handleFeedback} disabled={!feedback.trim()} style={{ background: feedback.trim() ? "linear-gradient(135deg,#22d3ee,#a78bfa)" : "rgba(255,255,255,0.05)", border: "none", borderRadius: "10px", color: feedback.trim() ? "#fff" : mc, padding: "10px", cursor: feedback.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>Send Feedback</button></div>}
                  </div>
                  <div style={{ padding: "12px 0", borderTop: `1px solid ${brd}` }}>
                    <button onClick={() => { if (window.confirm("Sign out of Kare-N?")) signOut(); }} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "10px", color: "#ef4444", padding: "10px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 700, width: "100%" }}>Sign Out</button>
                  </div>
                </div>
              )}
              {settingsTab === "templates" && (
                <div>
                  <div style={{ fontSize: "12px", color: mc, marginBottom: "14px", lineHeight: 1.5 }}>Tell Kare-N to update your templates in chat — changes save automatically.</div>
                  {templates.map(template => (
                    <div key={template.id} style={{ background: cb, border: `1px solid ${brd}`, borderLeft: `4px solid ${template.color}`, borderRadius: "14px", padding: "14px", marginBottom: "10px" }}>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: tc, marginBottom: "8px" }}>{template.name}</div>
                      {template.groups.map((group, gi) => (
                        <div key={gi} style={{ marginBottom: "8px" }}>
                          <div style={{ fontSize: "10px", fontWeight: 700, color: template.color, textTransform: "uppercase", marginBottom: "4px" }}>{group.name}</div>
                          {group.tasks.map((task, tki) => <div key={tki} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}><div style={{ width: "5px", height: "5px", borderRadius: "50%", background: brd, flexShrink: 0 }} /><span style={{ fontSize: "12px", color: mc }}>{task}</span></div>)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {settingsTab === "contacts" && (
                <div>
                  <div style={{ fontSize: "12px", color: mc, marginBottom: "14px" }}>Save vendor and recurring contacts. Kare-N recognizes them by name in chat.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                    <input value={newVendorName} onChange={e => setNewVendorName(e.target.value)} placeholder="Contact name" style={{ ...is, width: "100%" }} />
                    <input value={newVendorPhone} onChange={e => setNewVendorPhone(e.target.value)} placeholder="Phone number" style={{ ...is, width: "100%" }} />
                    <button onClick={async () => { if (!newVendorName.trim() || !newVendorPhone.trim()) return; await upsertContact(user.id, { name: newVendorName.trim(), phone: newVendorPhone.trim(), type: "vendor" }); const { data } = await getContacts(user.id); if (data) setContacts(data); setNewVendorName(""); setNewVendorPhone(""); }} style={{ background: "linear-gradient(135deg,#22d3ee,#a78bfa)", border: "none", borderRadius: "10px", color: "#fff", padding: "10px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>Save Contact</button>
                  </div>
                  {contacts.length === 0 ? <div style={{ textAlign: "center", color: mc, fontSize: "13px" }}>No contacts saved yet.</div> : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{contacts.map(v => <div key={v.id} style={{ background: cb, border: `1px solid ${brd}`, borderRadius: "12px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px" }}><div style={{ flex: 1 }}><div style={{ fontSize: "13px", fontWeight: 600, color: tc }}>{v.name}</div><div style={{ fontSize: "11px", color: mc }}>{v.phone}</div></div><a href={`tel:${v.phone}`} style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: "6px", color: "#34d399", padding: "5px 10px", fontSize: "12px", fontWeight: 700, textDecoration: "none" }}>📞</a><button onClick={async () => { await dbDeleteContact(v.id); setContacts(prev => prev.filter(c => c.id !== v.id)); }} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: mc, padding: "5px 10px", cursor: "pointer", fontSize: "13px" }}>×</button></div>)}</div>}
                </div>
              )}
              {settingsTab === "documents" && (
                <div>
                  <div style={{ fontSize: "12px", color: mc, marginBottom: "14px" }}>Upload forms and documents — synced across all your devices.</div>
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={handleDocUpload} style={{ display: "none" }} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingDoc} style={{ width: "100%", background: uploadingDoc ? "rgba(167,139,250,0.1)" : "rgba(34,211,238,0.1)", border: "1px dashed rgba(34,211,238,0.4)", borderRadius: "12px", color: uploadingDoc ? "#a78bfa" : "#22d3ee", padding: "12px", cursor: uploadingDoc ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px", marginBottom: "14px" }}>{uploadingDoc ? "⏳ Uploading..." : "📎 Upload Document"}</button>
                  {documents.length === 0 ? <div style={{ textAlign: "center", color: mc, fontSize: "13px" }}>No documents yet.</div> : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{documents.map(doc => <div key={doc.id} style={{ background: cb, border: `1px solid ${brd}`, borderRadius: "12px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px" }}><div style={{ fontSize: "22px" }}>{doc.file_type?.includes("pdf") ? "📄" : doc.file_type?.includes("image") ? "🖼" : "📝"}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "13px", fontWeight: 600, color: tc, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div><div style={{ fontSize: "10px", color: mc }}>{new Date(doc.uploaded_at).toLocaleDateString()}</div></div><button onClick={async () => { const url = await getDocumentUrl(doc.storage_path); window.open(url, "_blank"); }} style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", borderRadius: "6px", color: "#22d3ee", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>↓</button><button onClick={async () => { await dbDeleteDocument(doc.id, doc.storage_path); setDocuments(prev => prev.filter(d => d.id !== doc.id)); }} style={{ background: "none", border: `1px solid ${brd}`, borderRadius: "6px", color: mc, padding: "5px 10px", cursor: "pointer", fontSize: "13px" }}>×</button></div>)}</div>}
                </div>
              )}
              {settingsTab === "help" && (
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: tc, marginBottom: "14px" }}>Quick Tips</div>
                  {[["👨‍👩‍👧","New family case","Tap 'New Family Case' or say 'new family' in chat"],["🎙","Voice input","Tap the mic to speak — works in chat and onboarding"],["⚡","Quick capture","Tap the mic button (bottom left) from any tab"],["🔕","Quiet mode","Tap the bell before a service — silences everything"],["📋","Arrangement debrief","Check off the arrangement task and Kare-N asks automatically"],["🔊","Voice responses","Tap the speaker on any message to hear it read aloud"],["📅","Google Calendar","Tap Cal on any task with a due date to open pre-filled event"],["🌐","Access anywhere","Sign in from any browser — your data follows you"],["🔉","Mobile voices","If only male voices show, go to your phone Settings → General Management → Language → Text-to-speech and install additional English voices"]].map(([icon,title,desc]) => (
                    <div key={title} style={{ display: "flex", gap: "12px", padding: "12px 0", borderBottom: `1px solid ${brd}` }}>
                      <div style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</div>
                      <div><div style={{ fontSize: "13px", fontWeight: 600, color: tc, marginBottom: "3px" }}>{title}</div><div style={{ fontSize: "11px", color: mc, lineHeight: 1.5 }}>{desc}</div></div>
                    </div>
                  ))}
                  <div style={{ padding: "16px 0" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: tc, marginBottom: "8px" }}>Voice</div>
                    <div style={{ fontSize: "11px", color: mc, marginBottom: "8px" }}>Female voice by default. Change it here:</div>
                    <select value={settings.selected_voice || ""} onChange={e => updateSettings({ selected_voice: e.target.value || null })} style={{ ...is, width: "100%" }}>
                      <option value="">Default female voice</option>
                      {availableVoices.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                    </select>
                    {availableVoices.length > 0 && <button onClick={() => speak("Hey, I'm Kare-N. Ready to help.", settings.selected_voice, false)} style={{ marginTop: "8px", background: "rgba(167,139,250,0.1)", border: `1px solid ${brd}`, borderRadius: "8px", color: "#a78bfa", padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 700 }}>Test Voice</button>}
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
              <div><label style={{ fontSize: "10px", color: mc, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "4px" }}>Sex</label><div style={{ display: "flex", gap: "8px" }}>{["Male","Female","Other"].map(s => <button key={s} onClick={() => setFamilyIntake(f => ({ ...f, sex: s }))} style={{ flex: 1, padding: "7px", background: familyIntake.sex === s ? "linear-gradient(135deg,#22d3ee44,#a78bfa44)" : ibg, border: `1px solid ${familyIntake.sex === s ? "#a78bfa" : brd}`, borderRadius: "8px", color: familyIntake.sex === s ? "#a78bfa" : mc, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{s}</button>)}</div></div>
              <div><label style={{ fontSize: "10px", color: mc, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "4px" }}>Workflow</label><div style={{ display: "flex", gap: "8px" }}>{templates.map(t => <button key={t.id} onClick={() => setFamilyIntake(f => ({ ...f, template: t.id }))} style={{ flex: 1, padding: "7px", background: familyIntake.template === t.id ? `${t.color}33` : ibg, border: `1px solid ${familyIntake.template === t.id ? t.color : brd}`, borderRadius: "8px", color: familyIntake.template === t.id ? t.color : mc, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "12px" }}>{t.name}</button>)}</div></div>
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
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [view, setView] = useState("loading");

  useEffect(() => {
    if (window.location.pathname === '/auth/callback') { setView("callback"); return; }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleSignedIn(session); else setView("login");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) handleSignedIn(session); else setView("login");
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignedIn(session) {
    const { data: profile } = await upsertUser(session.user.id, session.user.email, { name: session.user.user_metadata?.name || session.user.email.split("@")[0] });
    setUserProfile(profile);
    setSession(session);
    if (profile?.onboarded) setView("app"); else setView("onboarding");
  }

  function handleOnboardingComplete(profileData) {
    setUserProfile(prev => ({ ...prev, profile: profileData, onboarded: true }));
    setView("app");
  }

  if (view === "loading") return <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" }}><style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style><KarenMascot size={60} animated /></div>;
  if (view === "callback") return <AuthCallback />;
  if (view === "login") return <LoginScreen />;
  if (view === "onboarding") return <Onboarding userId={session?.user?.id} onComplete={handleOnboardingComplete} />;
  if (view === "app") return <KarenMain user={session.user} userProfile={userProfile} />;
  return null;
}
