import React, { useState, useEffect, useMemo, useRef } from "react";
import { Home, FlaskConical, Receipt, Target, Activity, Plus, X, Check, ArrowRight, Lock, RotateCcw, Trash2, Zap, Sparkles, ChevronRight, TrendingDown, TrendingUp, Minus } from "lucide-react";

/* ============================================================
   DOMAIN ENGINE  (pure functions, shared by "server" + client)
   ============================================================ */
const DAYS = 30, START = 10000, SHOCK_PER_DAY = 25, PRIOR_RATE = 165, ONEOFF = 700, DAILY_REF = 190, SEED = 24;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const inr = (n) => { const r = Math.round(n); return (r < 0 ? "−" : "") + "₹" + Math.abs(r).toLocaleString("en-IN"); };
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATS = {
  food: { name: "Food", icon: "🍜" }, transport: { name: "Transport", icon: "🛺" },
  fun: { name: "Fun", icon: "🎧" }, shopping: { name: "Shopping", icon: "🛍️" },
  subs: { name: "Subscription", icon: "🔁" }, bills: { name: "Bill", icon: "🧾" },
  save: { name: "Savings", icon: "🐷" }, surprise: { name: "Surprise", icon: "⚡" },
  income: { name: "Income", icon: "💸" }, habit: { name: "Habit", icon: "🔂" },
};

const SHOCKS = [
  { title: "Phone screen cracked", amount: 799, icon: "📱", blurb: "It slipped out of your hand. The repair shop wants cash today." },
  { title: "Friend's birthday", amount: 450, icon: "🎂", blurb: "Everyone is chipping in for a gift and dinner." },
  { title: "Auto fare surge", amount: 220, icon: "🛺", blurb: "It rained, and the ride home cost triple." },
  { title: "Fever and pharmacy", amount: 380, icon: "💊", blurb: "A doctor visit plus medicines." },
  { title: "Laptop charger died", amount: 650, icon: "🔌", blurb: "Assignment due tomorrow. You need a new one." },
  { title: "Group trip split", amount: 520, icon: "🚆", blurb: "The weekend plan is on and your share is due." },
];
const WINDFALLS = [
  { title: "Birthday money from Mama", amount: 500, icon: "🎁", blurb: "A surprise UPI credit just landed." },
  { title: "Sold old textbooks", amount: 350, icon: "📚", blurb: "A junior paid you for last year's books." },
];

const initialState = () => ({
  name: "", day: 1, seed: SEED, autopilot: true, finished: false, pendingEvent: null, nextId: 100, tx: [],
  commitments: [
    { id: "c1", name: "Transport pass", amount: 600, dueDay: 2, icon: "🚌" },
    { id: "c2", name: "Phone recharge", amount: 299, dueDay: 6, icon: "📶" },
    { id: "c3", name: "Mess top-up", amount: 1200, dueDay: 10, icon: "🍛" },
    { id: "c4", name: "Course EMI", amount: 500, dueDay: 15, icon: "🎓" },
  ],
  subs: [
    { id: "s1", name: "Spotify", amount: 119, billDay: 4, active: true, icon: "🎧" },
    { id: "s2", name: "Netflix", amount: 199, billDay: 12, active: true, icon: "🎬" },
    { id: "s3", name: "YouTube Premium", amount: 129, billDay: 18, active: true, icon: "▶️" },
    { id: "s4", name: "Fitness app", amount: 349, billDay: 22, active: true, icon: "🏋️" },
  ],
  habits: [],
  goals: [
    { id: "g1", name: "Emergency fund", target: 1500, saved: 0, icon: "🛟" },
    { id: "g2", name: "Concert ticket", target: 1500, saved: 0, icon: "🎤" },
    { id: "g3", name: "New earbuds", target: 1800, saved: 0, icon: "🎧" },
  ],
});

const balanceOf = (s) => START + sum(s.tx, (t) => t.amount);
const addTx = (s, t) => ({ ...s, nextId: s.nextId + 1, tx: [...s.tx, { id: s.nextId, day: s.day, ...t }] });

/* ---- a single financial decision applied to a state (used for real + what-if) ---- */
function applyDecision(s, d) {
  switch (d.kind) {
    case "spend":
      return addTx(s, { type: "spend", amount: -d.amount, cat: d.cat || "shopping", note: d.label, oneoff: true });
    case "habit":
      return { ...s, nextId: s.nextId + 1, habits: [...s.habits, { id: "h" + s.nextId, name: d.label, amount: d.amount, every: d.every, next: s.day + 1 }] };
    case "subAdd": {
      const n = addTx(s, { type: "sub", amount: -d.amount, cat: "subs", note: d.label + " (first charge)" });
      return { ...n, subs: [...n.subs, { id: "s" + s.nextId, name: d.label, amount: d.amount, billDay: s.day, active: true, icon: "🔁" }] };
    }
    case "subCancel":
      return { ...s, subs: s.subs.map((x) => (x.id === d.id ? { ...x, active: false } : x)) };
    case "save": {
      const g = s.goals.find((x) => x.id === d.goalId);
      if (!g) return s;
      const amt = Math.min(d.amount, Math.max(0, g.target - g.saved));
      const n = addTx(s, { type: "save", amount: -amt, cat: "save", note: "Into " + g.name });
      return { ...n, goals: n.goals.map((x) => (x.id === g.id ? { ...x, saved: x.saved + amt } : x)) };
    }
    case "income":
      return addTx(s, { type: "income", amount: d.amount, cat: "income", note: d.label });
    default:
      return s;
  }
}

/* ---- metrics: everything the UI shows is derived from here ---- */
function riskLevel(score) {
  if (score < 25) return { name: "Low", tone: "mint" };
  if (score < 50) return { name: "Moderate", tone: "sun" };
  if (score < 75) return { name: "High", tone: "orange" };
  return { name: "Critical", tone: "coral" };
}
function healthGrade(score) {
  if (score >= 85) return { name: "Thriving", tone: "mint" };
  if (score >= 70) return { name: "Solid", tone: "mint" };
  if (score >= 50) return { name: "Shaky", tone: "sun" };
  return { name: "Rescue mode", tone: "coral" };
}

function metrics(s) {
  const day = s.day, rem = DAYS - day + 1;
  const balance = balanceOf(s);
  const bills = sum(s.commitments.filter((c) => c.dueDay > day), (c) => c.amount);
  const subsLeft = sum(s.subs.filter((x) => x.active && x.billDay > day), (x) => x.amount);
  const habitsLeft = sum(s.habits, (h) => (h.next <= DAYS ? (Math.floor((DAYS - h.next) / h.every) + 1) * h.amount : 0));
  const obligations = bills + subsLeft + habitsLeft;
  const reserve = SHOCK_PER_DAY * rem;
  const pool = balance - obligations - reserve;
  const allowance = Math.max(0, pool) / rem;
  const spentToday = -sum(s.tx.filter((t) => t.day === day && t.type === "spend"), (t) => t.amount);
  const prevPace = -sum(s.tx.filter((t) => t.type === "spend" && !t.oneoff && t.day < day), (t) => t.amount);
  const rate = (prevPace + PRIOR_RATE * 4) / (day - 1 + 4);

  const path = []; let b = balance, runOut = null;
  for (let d = day; d <= DAYS; d++) {
    b -= SHOCK_PER_DAY;
    b -= d === day ? Math.max(0, rate - spentToday) : rate;
    if (d > day) {
      s.commitments.forEach((c) => { if (c.dueDay === d) b -= c.amount; });
      s.subs.forEach((x) => { if (x.active && x.billDay === d) b -= x.amount; });
      s.habits.forEach((h) => { if (d >= h.next && (d - h.next) % h.every === 0) b -= h.amount; });
    }
    path.push({ d, b });
    if (runOut === null && b < 0) runOut = d;
  }
  const endBal = path[path.length - 1].b;

  // goals: free cash at month end is handed out in priority order
  let free = Math.max(0, endBal);
  const goals = s.goals.map((g) => {
    const need = Math.max(0, g.target - g.saved);
    const alloc = Math.min(need, free); free -= alloc;
    const status = need <= 0 ? "funded" : alloc >= need ? "on-track" : alloc > 0 ? "partial" : "at-risk";
    return { ...g, need, alloc, status };
  });
  const saved = sum(s.goals, (g) => g.saved);
  const subsMonthly = sum(s.subs.filter((x) => x.active), (x) => x.amount);
  const subPct = (subsMonthly / START) * 100;
  const ratio = allowance > 0 ? rate / allowance : 3;

  const rf = [
    { key: "runway", label: "Running out early", max: 50, pts: runOut ? 35 + (15 * (DAYS - runOut)) / DAYS : 0, note: runOut ? "Cash hits zero on day " + runOut : "Cash lasts all month" },
    { key: "cushion", label: "Thin month-end cushion", max: 25, pts: endBal < 0 ? 25 : endBal < 800 ? 20 * (1 - endBal / 800) : 0, note: "Projected " + inr(endBal) + " left" },
    { key: "pace", label: "Spending faster than allowance", max: 20, pts: clamp((ratio - 0.85) / 0.5, 0, 1) * 20, note: inr(rate) + "/day vs " + inr(allowance) + "/day allowed" },
    { key: "cover", label: "Bills not fully covered", max: 10, pts: obligations > 0 ? clamp((1.5 - balance / obligations) / 1.5, 0, 1) * 10 : 0, note: inr(balance) + " vs " + inr(obligations) + " still due" },
    { key: "subs", label: "Heavy subscriptions", max: 5, pts: clamp((subPct - 6) / 10, 0, 1) * 5, note: inr(subsMonthly) + " a month, " + subPct.toFixed(0) + "% of income" },
  ];
  let riskScore = Math.round(clamp(sum(rf, (x) => x.pts), 0, 100));
  if (balance < 0) riskScore = Math.max(riskScore, 90);

  const hp = [
    { key: "pace", label: "Spending pace", max: 30, pts: 30 * (1 - clamp((ratio - 0.75) / 0.6, 0, 1)) },
    { key: "buffer", label: "Month-end cushion", max: 25, pts: 25 * clamp(endBal / 1000, 0, 1) },
    { key: "save", label: "Savings", max: 20, pts: 20 * clamp(saved / 1000, 0, 1) },
    { key: "bills", label: "Bills covered", max: 15, pts: obligations <= 0 ? 15 : 15 * clamp(balance / (obligations * 1.2), 0, 1) },
    { key: "subs", label: "Subscription load", max: 10, pts: 10 * (1 - clamp((subPct - 3) / 12, 0, 1)) },
  ];
  let healthScore = Math.round(sum(hp, (x) => x.pts));
  if (balance < 0) healthScore = Math.min(healthScore, 20);

  return {
    day, rem, balance, obligations, bills, subsLeft, habitsLeft, reserve, pool, allowance, spentToday, rate, ratio,
    path, runOut, endBal, goals, saved, subsMonthly, subPct,
    risk: { score: riskScore, factors: rf, ...riskLevel(riskScore) },
    health: { score: healthScore, parts: hp, ...healthGrade(healthScore) },
  };
}

/* ---- upcoming charges, for timeline + calendar ---- */
function scheduledOn(s, d) {
  const out = [];
  s.commitments.forEach((c) => { if (c.dueDay === d) out.push({ name: c.name, amount: c.amount, icon: c.icon, kind: "bill" }); });
  s.subs.forEach((x) => { if (x.active && x.billDay === d) out.push({ name: x.name, amount: x.amount, icon: x.icon, kind: "sub" }); });
  s.habits.forEach((h) => { if (d >= h.next && (d - h.next) % h.every === 0) out.push({ name: h.name, amount: h.amount, icon: "🔂", kind: "habit" }); });
  return out;
}
function dayInfo(s, d) {
  const spend = -sum(s.tx.filter((t) => t.day === d && t.type === "spend"), (t) => t.amount);
  const shock = s.tx.some((t) => t.day === d && t.type === "shock");
  return { spend, shock, items: scheduledOn(s, d), txs: s.tx.filter((t) => t.day === d) };
}
function balanceHistory(s) {
  const out = [];
  for (let d = 1; d <= s.day; d++) out.push({ d, b: START + sum(s.tx.filter((t) => t.day <= d), (t) => t.amount) });
  return out;
}

/* ---- the "should I do this?" verdict ---- */
function verdict(b, a, scenarioLen) {
  if (!scenarioLen) return null;
  const cost = b.endBal - a.endBal;
  if (a.balance < 0) return { tone: "coral", head: "Skip it", text: "You'd be overdrawn by " + inr(-a.balance) + " right now." };
  if (a.runOut && !b.runOut) return { tone: "coral", head: "Skip it", text: "You'd run out of money on day " + a.runOut + ". Your bills and surprises still have to be paid." };
  if (a.runOut && b.runOut && a.runOut < b.runOut) return { tone: "coral", head: "Skip it", text: "Your zero-day moves from day " + b.runOut + " to day " + a.runOut + "." };
  if (a.risk.score - b.risk.score >= 15 || a.endBal < 300 && cost > 0)
    return { tone: "sun", head: "Tight", text: "It fits, but you'd end the month with only " + inr(a.endBal) + ". One surprise bill breaks it." };
  if (cost < 0) return { tone: "mint", head: "Helps", text: "This improves your month-end balance by " + inr(-cost) + "." };
  return { tone: "mint", head: "You can afford it", text: "It uses " + inr(cost) + " of your month-end cushion. Your daily allowance moves by " + inr(a.allowance - b.allowance) + "." };
}

function suggestions(s, m) {
  const out = [];
  const subs = s.subs.filter((x) => x.active).sort((x, y) => y.amount - x.amount);
  if (subs[0] && m.subPct > 5) {
    const x = subs[0], now = x.billDay > s.day;
    out.push({ id: "sub", icon: "✂️", title: "Pause " + x.name, body: now ? "Saves " + inr(x.amount) + " before it bills on day " + x.billDay + "." : "Already billed this month. Saves " + inr(x.amount) + " from next month.", decision: { kind: "subCancel", id: x.id, label: "Cancel " + x.name } });
  }
  const em = s.goals.find((g) => g.id === "g1");
  if (em && em.saved < 500 && m.endBal > 300 && s.day < DAYS)
    out.push({ id: "em", icon: "🛟", title: "Start your emergency fund", body: "Surprises are coming. Even " + inr(300) + " stops a bad day becoming a debt.", decision: { kind: "save", goalId: "g1", amount: 300, label: "Emergency fund" } });
  if (m.ratio > 1.05 && s.day > 1) out.push({ id: "pace", icon: "🐢", title: "Slow down to " + inr(m.allowance) + "/day", body: "You're averaging " + inr(m.rate) + "/day. Closing the gap protects your month-end cushion.", decision: null });
  if (!out.length) out.push({ id: "ok", icon: "✅", title: "You're on a healthy track", body: "Keep logging spends so the forecast stays honest.", decision: null });
  return out.slice(0, 3);
}

/* ---- reducer: this is what the "server" runs for every API call ---- */
function arriveDay(n) {
  const d = n.day;
  n.commitments.forEach((c) => { if (c.dueDay === d) n = addTx(n, { type: "commit", amount: -c.amount, cat: "bills", note: c.name }); });
  n.subs.forEach((x) => { if (x.active && x.billDay === d) n = addTx(n, { type: "sub", amount: -x.amount, cat: "subs", note: x.name }); });
  const habits = n.habits.map((h) => {
    if (h.next === d) { n = addTx(n, { type: "habit", amount: -h.amount, cat: "habit", note: h.name }); return { ...h, next: h.next + h.every }; }
    return h;
  });
  n = { ...n, habits };
  if (d >= 3) {
    const r = rng(n.seed * 997 + d);
    if (r() < 0.08) {
      const wind = r() < 0.2;
      const list = wind ? WINDFALLS : SHOCKS;
      const ev = list[Math.floor(r() * list.length)];
      n = { ...n, pendingEvent: { ...ev, kind: wind ? "windfall" : "shock" } };
    }
  }
  return n;
}

function reduce(s, a) {
  const bal = balanceOf(s);
  const guard = () => { if (s.finished) throw new Error("This month is closed. Start a new one."); if (s.pendingEvent) throw new Error("Deal with the surprise first."); };
  switch (a.type) {
    case "START": return { ...s, name: (a.name || "").trim() || "friend" };
    case "RESET": return { ...initialState(), name: s.name, autopilot: s.autopilot };
    case "TOGGLE_AUTOPILOT": return { ...s, autopilot: !s.autopilot };
    case "LOG_SPEND": {
      guard();
      const amt = Math.round(+a.amount);
      if (!(amt > 0)) throw new Error("Enter an amount above ₹0.");
      if (amt > bal) throw new Error("You only have " + inr(bal) + " in your wallet.");
      return addTx(s, { type: "spend", amount: -amt, cat: a.cat || "food", note: a.note || (CATS[a.cat] || CATS.food).name, oneoff: amt > ONEOFF });
    }
    case "CONTRIBUTE": {
      guard();
      const g = s.goals.find((x) => x.id === a.goalId);
      const amt = Math.round(+a.amount);
      if (!g) throw new Error("Goal not found.");
      if (!(amt > 0)) throw new Error("Enter an amount above ₹0.");
      if (g.target - g.saved <= 0) throw new Error(g.name + " is already funded.");
      if (amt > bal) throw new Error("You only have " + inr(bal) + " in your wallet.");
      return applyDecision(s, { kind: "save", goalId: g.id, amount: amt });
    }
    case "ADD_GOAL": {
      const t = Math.round(+a.target);
      if (!a.name || !(t > 0)) throw new Error("Give your goal a name and a target.");
      return { ...s, nextId: s.nextId + 1, goals: [...s.goals, { id: "g" + s.nextId, name: a.name.trim(), target: t, saved: 0, icon: "⭐" }] };
    }
    case "TOGGLE_SUB": return { ...s, subs: s.subs.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)) };
    case "REMOVE_HABIT": return { ...s, habits: s.habits.filter((h) => h.id !== a.id) };
    case "COMMIT_SCENARIO": {
      guard();
      let n = s;
      a.decisions.forEach((d) => { n = applyDecision(n, d); });
      if (balanceOf(n) < 0) throw new Error("Your wallet can't cover all of this.");
      return n;
    }
    case "RESOLVE_EVENT": {
      const ev = s.pendingEvent;
      if (!ev) return s;
      let n = { ...s, pendingEvent: null };
      if (ev.kind === "windfall") return addTx(n, { type: "income", amount: ev.amount, cat: "income", note: ev.title });
      if (a.choice === "emergency") {
        const g = n.goals.find((x) => x.id === "g1");
        if (!g || g.saved < ev.amount) throw new Error("Your emergency fund can't cover this one.");
        n = { ...n, goals: n.goals.map((x) => (x.id === "g1" ? { ...x, saved: x.saved - ev.amount } : x)) };
        return addTx(n, { type: "shock", amount: 0, cat: "surprise", note: ev.title + " (paid from emergency fund)", covered: ev.amount });
      }
      return addTx(n, { type: "shock", amount: -ev.amount, cat: "surprise", note: ev.title });
    }
    case "NEXT_DAY": {
      guard();
      let n = s;
      if (n.autopilot && metrics(n).spentToday === 0) {
        const r = rng(n.seed * 131 + n.day);
        const amt = Math.round(110 + r() * 110);
        if (amt <= bal) n = addTx(n, { type: "spend", amount: -amt, cat: "food", note: "Typical day (auto-logged)", auto: true });
      }
      if (n.day >= DAYS) return { ...n, finished: true };
      return arriveDay({ ...n, day: n.day + 1 });
    }
    default: throw new Error("Unknown action " + a.type);
  }
}

/* ============================================================
   "BACKEND": API + persistence layer (swap for fetch() to go live)
   ============================================================ */
const STORE_KEY = "runway:v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasStore = () => typeof window !== "undefined" && window.storage;
const api = {
  async load() {
    try { if (!hasStore()) return null; const r = await window.storage.get(STORE_KEY); return r ? JSON.parse(r.value) : null; } catch (e) { return null; }
  },
  async save(s) { try { if (hasStore()) await window.storage.set(STORE_KEY, JSON.stringify(s)); } catch (e) { /* offline is fine */ } },
  async call(state, action) { await sleep(70); const next = reduce(state, action); await api.save(next); return next; },
};

/* ============================================================
   STYLES
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=DM+Sans:wght@400;500;700&display=swap');
.rw{--ink:#17143A;--paper:#F3F2FF;--card:#fff;--blue:#4338FF;--mint:#0FB57E;--sun:#FFC62E;--coral:#FF5468;--orange:#FF8A3D;--muted:#6C6990;--line:#E3E1F6;
 font-family:'DM Sans',ui-rounded,system-ui,sans-serif;color:var(--ink);background:var(--paper);min-height:100vh;font-size:15px;line-height:1.45;-webkit-tap-highlight-color:transparent}
.rw *{box-sizing:border-box}
.rw button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
.rw input{font:inherit;color:inherit}
.rw :focus-visible{outline:3px solid var(--blue);outline-offset:2px;border-radius:10px}
.disp{font-family:'Bricolage Grotesque',ui-rounded,system-ui,sans-serif;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.page{max-width:1040px;margin:0 auto;padding:14px 14px 120px}
.cols{display:grid;gap:14px}
@media(min-width:900px){.cols.two{grid-template-columns:1.15fr .85fr;align-items:start}.page{padding:24px 24px 120px}}
.stack{display:grid;gap:14px}
.card{background:var(--card);border-radius:22px;padding:16px;border:1px solid var(--line)}
.card h3{margin:0 0 2px;font-size:17px}
.sub{color:var(--muted);font-size:13px}
.top{display:flex;align-items:center;justify-content:space-between;padding:6px 2px 14px}
.top h1{margin:0;font-size:22px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#fff;border:1px solid var(--line);font-weight:700;font-size:13px}
.hero{background:var(--ink);color:#fff;border-radius:28px;padding:20px 18px 18px;border:0}
.hero .big{font-size:68px;font-weight:800;line-height:.95;margin:2px 0 0}
.hero .big small{font-size:20px;font-weight:600;opacity:.65;letter-spacing:0;margin-left:6px}
.hero .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
.hero .stats div{background:rgba(255,255,255,.08);border-radius:14px;padding:10px}
.hero .stats b{display:block;font-size:17px}
.hero .stats span{font-size:12px;opacity:.7}
.grid30{display:grid;grid-template-columns:repeat(10,1fr);gap:5px}
.cell{aspect-ratio:1;border-radius:9px;font-size:11px;font-weight:700;display:grid;place-items:center;position:relative;background:rgba(255,255,255,.1);color:rgba(255,255,255,.55);transition:transform .15s}
.cell:active{transform:scale(.92)}
.cell.mint{background:var(--mint);color:#04321f}.cell.sun{background:var(--sun);color:#3b2c00}.cell.coral{background:var(--coral);color:#fff}
.cell.today{background:var(--blue);color:#fff;box-shadow:0 0 0 2px var(--ink),0 0 0 4px #fff}
.cell i{position:absolute;bottom:3px;width:4px;height:4px;border-radius:9px;background:#fff;opacity:.9}
.cell.mint i,.cell.sun i{background:var(--ink)}
.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;opacity:.75;margin-top:10px}
.legend span{display:inline-flex;align-items:center;gap:5px}.legend u{width:10px;height:10px;border-radius:3px;display:inline-block}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 18px;border-radius:16px;font-weight:700;transition:transform .12s,opacity .12s}
.btn:active{transform:scale(.97)}.btn[disabled]{opacity:.45;cursor:not-allowed}
.btn.sun{background:var(--sun);color:var(--ink)}.btn.blue{background:var(--blue);color:#fff}.btn.ink{background:var(--ink);color:#fff}
.btn.ghost{background:#EFEDFF;color:var(--ink)}.btn.block{width:100%}.btn.sm{padding:8px 12px;border-radius:12px;font-size:13px}
.chip{padding:8px 12px;border-radius:99px;background:#EFEDFF;font-weight:600;font-size:13px;white-space:nowrap;border:1.5px solid transparent}
.chip.on{background:var(--ink);color:#fff}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chips.scroll{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.field{display:flex;align-items:center;gap:8px;background:#F6F5FF;border:1.5px solid var(--line);border-radius:14px;padding:0 12px;height:48px}
.field input{border:0;background:transparent;outline:0;width:100%;height:100%;font-weight:600}
.field span{color:var(--muted);font-weight:700}
.row{display:flex;align-items:center;gap:12px}.between{justify-content:space-between}
.item{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line)}
.item:first-child{border-top:0}
.ico{width:40px;height:40px;border-radius:13px;background:#F0EEFF;display:grid;place-items:center;font-size:19px;flex:none}
.grow{flex:1;min-width:0}.grow b,.grow .t{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.amt{font-weight:800;font-variant-numeric:tabular-nums}.neg{color:var(--ink)}.pos{color:var(--mint)}
.tag{display:inline-block;padding:3px 9px;border-radius:99px;font-size:12px;font-weight:700}
.tag.mint{background:#D7F5EA;color:#07694a}.tag.sun{background:#FFF0BE;color:#6b4e00}.tag.coral{background:#FFDDE1;color:#9b1c2e}.tag.orange{background:#FFE5D1;color:#8f3f00}
.bar{height:10px;border-radius:99px;background:#ECEAFB;overflow:hidden}.bar>div{height:100%;border-radius:99px;transition:width .5s cubic-bezier(.2,.8,.2,1)}
.nav{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:2px;background:var(--ink);padding:6px;border-radius:24px;z-index:20;width:min(460px,calc(100% - 20px));box-shadow:0 12px 30px rgba(23,20,58,.35)}
.nav button{flex:1;display:grid;justify-items:center;gap:2px;padding:8px 0 6px;border-radius:18px;color:rgba(255,255,255,.6);font-size:11px;font-weight:700}
.nav button.on{background:var(--blue);color:#fff}
.sheet-bg{position:fixed;inset:0;background:rgba(23,20,58,.55);z-index:40;display:flex;align-items:flex-end;justify-content:center}
.sheet{background:#fff;width:100%;max-width:520px;border-radius:28px 28px 0 0;padding:20px 18px 26px;max-height:88vh;overflow:auto;animation:up .25s cubic-bezier(.2,.8,.2,1)}
@media(min-width:700px){.sheet-bg{align-items:center}.sheet{border-radius:28px}}
@keyframes up{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}
.toast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);padding:12px 16px;border-radius:14px;background:var(--ink);color:#fff;font-weight:600;z-index:60;max-width:calc(100% - 28px);box-shadow:0 10px 24px rgba(0,0,0,.25)}
.toast.bad{background:var(--coral)}
.seg{display:flex;gap:4px;background:#EFEDFF;padding:4px;border-radius:16px;overflow-x:auto;scrollbar-width:none}
.seg button{flex:1;padding:9px 10px;border-radius:12px;font-weight:700;font-size:13px;white-space:nowrap;color:var(--muted)}
.seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 4px rgba(23,20,58,.15)}
.cmp{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:6px 10px;align-items:center;font-size:14px}
.cmp .h{font-size:12px;color:var(--muted);font-weight:700}.cmp .r{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
.delta{font-size:12px;font-weight:800;display:inline-flex;align-items:center;gap:2px}
.delta.good{color:var(--mint)}.delta.badd{color:var(--coral)}.delta.flat{color:var(--muted)}
.verdict{border-radius:20px;padding:14px 16px;display:grid;gap:2px}
.verdict.mint{background:#D7F5EA}.verdict.sun{background:#FFF0BE}.verdict.coral{background:#FFDDE1}
.verdict b{font-size:20px}
.switch{width:44px;height:26px;border-radius:99px;background:rgba(255,255,255,.25);position:relative;transition:background .2s;flex:none}
.switch.on{background:var(--mint)}.switch i{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:99px;background:#fff;transition:transform .2s}.switch.on i{transform:translateX(18px)}
.sw-dark{background:#D9D6F0}
.intro{min-height:100vh;display:grid;align-content:center;gap:22px;max-width:520px;margin:0 auto;padding:24px 18px}
.intro .grid30{background:var(--ink);padding:14px;border-radius:24px}
.intro .cell{animation:pop .5s both}
@keyframes pop{from{transform:scale(.3);opacity:0}to{transform:none;opacity:1}}
.empty{text-align:center;padding:18px 8px;color:var(--muted)}
@media(prefers-reduced-motion:reduce){.rw *{animation:none!important;transition:none!important}}
`;

/* ============================================================
   SMALL UI PIECES
   ============================================================ */
const TONE = { mint: "var(--mint)", sun: "var(--sun)", coral: "var(--coral)", orange: "var(--orange)" };
const STATUS = { funded: ["Funded", "mint"], "on-track": ["On track", "mint"], partial: ["Partly covered", "sun"], "at-risk": ["At risk", "coral"] };

function Gauge({ score, tone, label }) {
  const r = 52, c = Math.PI * r, off = c * (1 - score / 100);
  return (
    <svg viewBox="0 0 130 82" width="100%" role="img" aria-label={`Risk ${score} out of 100, ${label}`}>
      <path d="M13 70 A52 52 0 0 1 117 70" fill="none" stroke="#ECEAFB" strokeWidth="13" strokeLinecap="round" />
      <path d="M13 70 A52 52 0 0 1 117 70" fill="none" stroke={TONE[tone]} strokeWidth="13" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)" }} />
      <text x="65" y="62" textAnchor="middle" className="disp" fontSize="30" fontWeight="800" fill="var(--ink)">{score}</text>
    </svg>
  );
}
function Ring({ score, tone, size = 96 }) {
  const r = 40, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`Health ${score} out of 100`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#ECEAFB" strokeWidth="11" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={TONE[tone]} strokeWidth="11" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 50 50)" style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)" }} />
      <text x="50" y="58" textAnchor="middle" className="disp" fontSize="28" fontWeight="800" fill="var(--ink)">{score}</text>
    </svg>
  );
}

function Delta({ a, b, fmt = inr, invert = false, suffix = "" }) {
  const d = Math.round(b - a);
  if (d === 0) return <span className="delta flat"><Minus size={11} />same</span>;
  const good = invert ? d < 0 : d > 0;
  return <span className={"delta " + (good ? "good" : "badd")}>{d > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{d > 0 ? "+" : ""}{fmt(d)}{suffix}</span>;
}

function Sheet({ onClose, children, label }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

/* ---- forecast chart: past (solid), projection (dashed), what-if (blue) ---- */
function Forecast({ s, m, alt, height = 170 }) {
  const W = 340, H = height, pl = 8, pr = 8, pt = 10, pb = 20;
  const hist = balanceHistory(s);
  const all = [...hist.map((p) => p.b), ...m.path.map((p) => p.b), ...(alt ? alt.path.map((p) => p.b) : [])];
  const lo = Math.min(-400, Math.min(...all) - 200), hi = 10400;
  const X = (d) => pl + ((d - 1) / (DAYS - 1)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const line = (pts) => pts.map((p, i) => (i ? "L" : "M") + X(p.d).toFixed(1) + " " + Y(p.b).toFixed(1)).join(" ");
  const now = { d: s.day, b: m.balance };
  const proj = [now, ...m.path.slice(1)];
  const altNow = alt ? [{ d: s.day, b: alt.balance }, ...alt.path.slice(1)] : null;
  const zeroY = Y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Balance forecast for the month">
      <rect x={pl} y={zeroY} width={W - pl - pr} height={Math.max(0, H - pb - zeroY)} fill="#FFDDE1" opacity=".55" />
      <line x1={pl} x2={W - pr} y1={zeroY} y2={zeroY} stroke="var(--coral)" strokeWidth="1" strokeDasharray="3 3" />
      <text x={W - pr} y={zeroY - 4} textAnchor="end" fontSize="9" fill="var(--coral)" fontWeight="700">₹0</text>
      <path d={line(proj)} fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" />
      {altNow && <path d={line(altNow)} fill="none" stroke="var(--blue)" strokeWidth="3" strokeLinecap="round" />}
      <path d={line(hist)} fill="none" stroke="var(--ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={X(s.day)} cy={Y(m.balance)} r="5.5" fill="var(--ink)" stroke="#fff" strokeWidth="2" />
      {(alt ? alt.runOut : m.runOut) && <circle cx={X(alt ? alt.runOut : m.runOut)} cy={Y(0)} r="5" fill="var(--coral)" stroke="#fff" strokeWidth="2" />}
      {[1, 10, 20, 30].map((d) => <text key={d} x={X(d)} y={H - 5} textAnchor={d === 30 ? "end" : d === 1 ? "start" : "middle"} fontSize="10" fill="var(--muted)" fontWeight="700">Day {d}</text>)}
    </svg>
  );
}

function RunwayGrid({ s, onPick, intro }) {
  return (
    <div className="grid30" role="group" aria-label="30 day runway">
      {Array.from({ length: DAYS }, (_, i) => {
        const d = i + 1;
        let cls = "cell", dot = false;
        if (intro) cls += " " + (d < 9 ? "mint" : d < 13 ? "sun" : d === 13 ? "coral" : d < 22 ? "mint" : "");
        else if (d < s.day) { const sp = dayInfo(s, d).spend; cls += sp <= DAILY_REF ? " mint" : sp <= DAILY_REF * 1.5 ? " sun" : " coral"; }
        else if (d === s.day) cls += " today";
        if (!intro) dot = dayInfo(s, d).items.length > 0 || dayInfo(s, d).shock;
        return (
          <button key={d} className={cls} style={intro ? { animationDelay: d * 35 + "ms" } : undefined} onClick={() => onPick && onPick(d)} aria-label={`Day ${d}`}>
            {d}{dot && <i />}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   SCREENS
   ============================================================ */
function HomeScreen({ s, m, act, busy, setTab, setDaySheet }) {
  const [amt, setAmt] = useState("");
  const [cat, setCat] = useState("food");
  const quick = [["Chai", 30, "food"], ["Lunch", 90, "food"], ["Auto", 60, "transport"], ["Movie", 250, "fun"]];
  const log = (a, c, note) => act({ type: "LOG_SPEND", amount: a, cat: c, note }, "Logged " + inr(a)).then((ok) => ok && setAmt(""));
  const up = [];
  for (let d = s.day + 1; d <= DAYS && up.length < 4; d++) scheduledOn(s, d).forEach((x) => up.push({ ...x, d }));
  const recent = [...s.tx].reverse().slice(0, 7);
  const end = m.runOut ? <>You run out of money on <b>day {m.runOut}</b>. Pull back about {inr(Math.abs(m.endBal) / m.rem)} a day to fix it.</> : <>At this pace you finish with <b>{inr(m.endBal)}</b> after bills and surprises.</>;
  return (
    <div className="stack">
      <div className="card hero">
        <div style={{ opacity: .75, fontWeight: 700, fontSize: 14 }}>You can spend</div>
        <div className="disp big">{inr(m.allowance)}<small>a day</small></div>
        <div className="stats">
          <div><b className="disp">{inr(m.balance)}</b><span>In wallet</span></div>
          <div><b className="disp">{inr(m.obligations)}</b><span>Needed for bills</span></div>
          <div><b className="disp">{inr(m.reserve)}</b><span>Surprise buffer</span></div>
        </div>
        <RunwayGrid s={s} onPick={setDaySheet} />
        <div className="legend"><span><u style={{ background: "var(--mint)" }} />Under budget</span><span><u style={{ background: "var(--sun)" }} />Stretched</span><span><u style={{ background: "var(--coral)" }} />Overspent</span><span><u style={{ background: "#fff" }} />Bill or surprise</span></div>
        <div className="row between" style={{ marginTop: 16, gap: 10 }}>
          <button className="row" style={{ gap: 10, textAlign: "left", fontSize: 13, opacity: .85 }} onClick={() => act({ type: "TOGGLE_AUTOPILOT" })} aria-pressed={s.autopilot}>
            <span className={"switch" + (s.autopilot ? " on" : "")}><i /></span>Auto-log a typical day
          </button>
          <button className="btn sun" disabled={busy || s.finished} onClick={() => act({ type: "NEXT_DAY" })}>{s.day >= DAYS ? "Close the month" : "End day " + s.day}<ArrowRight size={18} /></button>
        </div>
      </div>

      <div className="cols two">
        <div className="stack">
          <div className="card">
            <div className="row between"><h3>Log a spend</h3><span className="sub">Today: {inr(m.spentToday)}</span></div>
            <div className="chips scroll" style={{ margin: "10px 0" }}>
              {quick.map(([n, a, c]) => <button key={n} className="chip" disabled={busy} onClick={() => log(a, c, n)}>{n} {inr(a)}</button>)}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <label className="field" style={{ flex: 1 }}><span>₹</span><input inputMode="numeric" placeholder="Amount" aria-label="Amount" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ""))} /></label>
              <button className="btn blue" disabled={busy || !amt} onClick={() => log(amt, cat)}>Log it</button>
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              {["food", "transport", "fun", "shopping"].map((c) => <button key={c} className={"chip" + (cat === c ? " on" : "")} onClick={() => setCat(c)}>{CATS[c].icon} {CATS[c].name}</button>)}
            </div>
            <p className="sub" style={{ margin: "10px 0 0" }}>Anything over ₹700 counts as a one-off, so it won't inflate your daily pace.</p>
          </div>

          <div className="card">
            <h3>Month forecast</h3>
            <p className="sub" style={{ margin: "0 0 8px" }}>{end}</p>
            <Forecast s={s} m={m} />
          </div>
        </div>

        <div className="stack">
          <div className="cols" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <button className="card" style={{ textAlign: "left" }} onClick={() => setTab("health")}>
              <div className="sub" style={{ fontWeight: 700 }}>Financial risk</div>
              <Gauge score={m.risk.score} tone={m.risk.tone} label={m.risk.name} />
              <span className={"tag " + m.risk.tone}>{m.risk.name}</span>
            </button>
            <button className="card" style={{ textAlign: "left" }} onClick={() => setTab("health")}>
              <div className="sub" style={{ fontWeight: 700 }}>Financial health</div>
              <div style={{ display: "grid", placeItems: "center", padding: "2px 0 4px" }}><Ring score={m.health.score} tone={m.health.tone} size={92} /></div>
              <span className={"tag " + m.health.tone}>{m.health.name}</span>
            </button>
          </div>

          <div className="card">
            <h3>Coming up</h3>
            {up.length === 0 && <div className="empty">No more bills this month.</div>}
            {up.map((x, i) => (
              <div className="item" key={i}><div className="ico">{x.icon}</div><div className="grow"><b>{x.name}</b><span className="sub">In {x.d - s.day} day{x.d - s.day > 1 ? "s" : ""}, day {x.d}</span></div><div className="amt">{inr(x.amount)}</div></div>
            ))}
          </div>

          <div className="card">
            <h3>Recent activity</h3>
            {recent.length === 0 && <div className="empty">Nothing yet. Log your first spend above.</div>}
            {recent.map((t) => (
              <div className="item" key={t.id}>
                <div className="ico">{(CATS[t.cat] || CATS.food).icon}</div>
                <div className="grow"><span className="t" style={{ fontWeight: 700 }}>{t.note}</span><span className="sub">Day {t.day}</span></div>
                <div className={"amt " + (t.amount > 0 ? "pos" : "neg")}>{t.covered ? "Covered" : (t.amount > 0 ? "+" : "") + inr(t.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PRESETS = {
  spend: [["Sneakers", 2499], ["Hoodie", 1199], ["Dinner with friends", 700], ["Weekend trip", 2500]],
  habit: [["Cold coffee", 180, 2], ["Food delivery", 250, 3], ["Cab to college", 90, 1], ["Weekend movie", 300, 7]],
  subAdd: [["Disney+ Hotstar", 299], ["Gaming pass", 349], ["AI study app", 1650]],
  income: [["Tutoring gig", 800], ["Freelance logo", 1500], ["Sell old phone", 3000]],
};
const KINDS = [["spend", "Buy"], ["habit", "Habit"], ["subAdd", "Subscribe"], ["subCancel", "Cancel"], ["save", "Save"], ["income", "Earn"]];

function describe(d, s) {
  if (d.kind === "spend") return `Buy ${d.label} for ${inr(d.amount)}`;
  if (d.kind === "habit") return `${d.label}, ${inr(d.amount)} every ${d.every === 1 ? "day" : d.every + " days"}`;
  if (d.kind === "subAdd") return `Subscribe to ${d.label} at ${inr(d.amount)}`;
  if (d.kind === "subCancel") return d.label;
  if (d.kind === "save") { const g = s.goals.find((x) => x.id === d.goalId); return `Save ${inr(d.amount)} to ${g ? g.name : "goal"}`; }
  return `Earn ${inr(d.amount)} from ${d.label}`;
}

function WhatIfScreen({ s, m, scenario, setScenario, act, busy, toast }) {
  const [kind, setKind] = useState("spend");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [every, setEvery] = useState(2);
  const [goalId, setGoalId] = useState("g1");
  const hypo = useMemo(() => scenario.reduce((st, d) => applyDecision(st, d), s), [s, scenario]);
  const a = useMemo(() => metrics(hypo), [hypo]);
  const v = verdict(m, a, scenario.length);
  const uid = () => Math.random().toString(36).slice(2, 8);
  const add = (d) => setScenario((x) => [...x, { ...d, uid: uid() }]);
  const addCustom = () => {
    const amt = Math.round(+amount);
    if (kind !== "subCancel" && !(amt > 0)) return toast("Enter an amount above ₹0.", true);
    add({ kind, label: label || ({ spend: "Something new", habit: "New habit", subAdd: "New subscription", income: "Side income" })[kind], amount: amt, every, goalId });
    setLabel(""); setAmount("");
  };
  const cancellable = s.subs.filter((x) => x.active && !scenario.some((d) => d.kind === "subCancel" && d.id === x.id));
  const commit = async () => {
    const ok = await act({ type: "COMMIT_SCENARIO", decisions: scenario }, "Done. Your plan is now real.");
    if (ok) setScenario([]);
  };
  const rows = [
    ["Wallet now", m.balance, a.balance, false],
    ["Daily allowance", m.allowance, a.allowance, false],
    ["Month-end balance", m.endBal, a.endBal, false],
  ];
  return (
    <div className="cols two">
      <div className="stack">
        <div className="card">
          <h3>What if I…</h3>
          <p className="sub" style={{ margin: "0 0 10px" }}>Try a decision first. Nothing changes until you tap "Do it for real".</p>
          <div className="seg" role="tablist">{KINDS.map(([k, n]) => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{n}</button>)}</div>

          <div style={{ marginTop: 12 }} className="stack">
            {PRESETS[kind] && (
              <div className="chips">
                {PRESETS[kind].map(([n, p, e]) => (
                  <button key={n} className="chip" onClick={() => add({ kind, label: n, amount: p, every: e || 1, cat: "shopping" })}>{n} {inr(p)}{e ? ` / ${e === 1 ? "day" : e + "d"}` : ""}</button>
                ))}
              </div>
            )}
            {kind === "subCancel" && (
              <div className="chips">
                {cancellable.length === 0 && <span className="sub">No active subscriptions left to cancel.</span>}
                {cancellable.map((x) => <button key={x.id} className="chip" onClick={() => add({ kind, id: x.id, label: `Cancel ${x.name}, ${x.billDay > s.day ? "saves " + inr(x.amount) + " this month" : "saves from next month"}` })}>{x.icon} {x.name} {inr(x.amount)}</button>)}
              </div>
            )}
            {kind === "save" && (
              <>
                <div className="chips">{s.goals.map((g) => <button key={g.id} className={"chip" + (goalId === g.id ? " on" : "")} onClick={() => setGoalId(g.id)}>{g.icon} {g.name}</button>)}</div>
                <div className="chips">{[200, 500, 1000].map((p) => <button key={p} className="chip" onClick={() => add({ kind, goalId, amount: p })}>Save {inr(p)}</button>)}</div>
              </>
            )}
            {kind !== "subCancel" && (
              <>
                {kind !== "save" && <label className="field"><input placeholder={kind === "income" ? "Where from? (optional)" : "What is it? (optional)"} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Name" /></label>}
                <div className="row" style={{ gap: 8 }}>
                  <label className="field" style={{ flex: 1 }}><span>₹</span><input inputMode="numeric" placeholder="Custom amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} aria-label="Amount" /></label>
                  <button className="btn ink" onClick={addCustom}><Plus size={18} />Add</button>
                </div>
                {kind === "habit" && <div className="chips"><span className="sub" style={{ alignSelf: "center" }}>Repeats every</span>{[1, 2, 3, 7].map((n) => <button key={n} className={"chip" + (every === n ? " on" : "")} onClick={() => setEvery(n)}>{n === 1 ? "day" : n + " days"}</button>)}</div>}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="row between"><h3>Your scenario</h3>{scenario.length > 0 && <button className="btn ghost sm" onClick={() => setScenario([])}>Clear</button>}</div>
          {scenario.length === 0 && <div className="empty">Pick a quick option above to see how it changes your month.</div>}
          {scenario.map((d) => (
            <div className="item" key={d.uid}>
              <div className="grow"><span className="t" style={{ fontWeight: 700, whiteSpace: "normal" }}>{describe(d, s)}</span></div>
              <button className="btn ghost sm" aria-label="Remove" onClick={() => setScenario((x) => x.filter((y) => y.uid !== d.uid))}><X size={16} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="stack">
        {v && <div className={"verdict " + v.tone}><b className="disp">{v.head}</b><span>{v.text}</span></div>}
        <div className="card">
          <h3>Before and after</h3>
          <div className="cmp" style={{ marginTop: 10 }}>
            <span className="h" /><span className="h r">Now</span><span className="h r">If you do it</span>
            {rows.map(([n, x, y]) => (
              <React.Fragment key={n}><span>{n}</span><span className="r">{inr(x)}</span><span className="r">{inr(y)}<br /><Delta a={x} b={y} /></span></React.Fragment>
            ))}
            <span>Money runs out</span><span className="r">{m.runOut ? "Day " + m.runOut : "Never"}</span><span className="r" style={{ color: a.runOut ? "var(--coral)" : undefined }}>{a.runOut ? "Day " + a.runOut : "Never"}</span>
            <span>Financial risk</span><span className="r">{m.risk.score}</span><span className="r">{a.risk.score}<br /><Delta a={m.risk.score} b={a.risk.score} fmt={(n) => n} invert /></span>
            <span>Financial health</span><span className="r">{m.health.score}</span><span className="r">{a.health.score}<br /><Delta a={m.health.score} b={a.health.score} fmt={(n) => n} /></span>
          </div>
          <div style={{ marginTop: 14 }}><Forecast s={s} m={m} alt={scenario.length ? a : null} /></div>
          <div className="legend" style={{ color: "var(--muted)" }}><span><u style={{ background: "var(--ink)" }} />Your history</span><span><u style={{ background: "var(--muted)" }} />Current path</span>{scenario.length > 0 && <span><u style={{ background: "var(--blue)" }} />With your scenario</span>}</div>
        </div>
        <div className="card">
          <h3>Savings goals</h3>
          {a.goals.map((g, i) => {
            const was = m.goals[i], st = STATUS[g.status], changed = was.status !== g.status;
            return (
              <div className="item" key={g.id}>
                <div className="ico">{g.icon}</div>
                <div className="grow"><b>{g.name}</b><span className="sub">{inr(g.saved)} of {inr(g.target)}{changed ? `, was ${STATUS[was.status][0].toLowerCase()}` : ""}</span></div>
                <span className={"tag " + st[1]}>{st[0]}</span>
              </div>
            );
          })}
        </div>
        <button className="btn blue block" disabled={!scenario.length || busy} onClick={commit}><Check size={18} />Do it for real</button>
      </div>
    </div>
  );
}

function BillsScreen({ s, m, act, busy }) {
  const timeline = [
    ...s.commitments.map((c) => ({ ...c, day: c.dueDay, kind: "bill" })),
    ...s.subs.filter((x) => x.active).map((x) => ({ ...x, day: x.billDay, kind: "sub" })),
  ].sort((x, y) => x.day - y.day);
  return (
    <div className="cols two">
      <div className="card">
        <h3>Bills and renewals</h3>
        <p className="sub" style={{ margin: "0 0 6px" }}>Locked in this month: {inr(sum(timeline, (x) => x.amount))}. Still to pay: {inr(m.bills + m.subsLeft)}.</p>
        {timeline.map((x) => {
          const paid = x.day <= s.day;
          return (
            <div className="item" key={x.id} style={{ opacity: paid ? .55 : 1 }}>
              <div className="ico">{x.icon}</div>
              <div className="grow"><b>{x.name}</b><span className="sub">{x.kind === "sub" ? "Subscription" : "Bill"}, day {x.day}</span></div>
              <div style={{ textAlign: "right" }}><div className="amt">{inr(x.amount)}</div><span className={"tag " + (paid ? "mint" : "sun")}>{paid ? "Paid" : "In " + (x.day - s.day) + "d"}</span></div>
            </div>
          );
        })}
      </div>
      <div className="stack">
        <div className="card">
          <h3>Subscriptions</h3>
          <p className="sub" style={{ margin: "0 0 8px" }}>{inr(m.subsMonthly)} a month, {m.subPct.toFixed(0)}% of your income.</p>
          <div className="bar" style={{ marginBottom: 6 }}><div style={{ width: clamp(m.subPct * 5, 0, 100) + "%", background: m.subPct > 8 ? "var(--orange)" : "var(--mint)" }} /></div>
          {s.subs.map((x) => (
            <div className="item" key={x.id}>
              <div className="ico">{x.icon}</div>
              <div className="grow"><b>{x.name}</b><span className="sub">{inr(x.amount)} on day {x.billDay}</span></div>
              <button disabled={busy} onClick={() => act({ type: "TOGGLE_SUB", id: x.id }, x.active ? x.name + " cancelled" : x.name + " back on")} aria-label={"Toggle " + x.name} aria-pressed={x.active}><span className={"switch sw-dark" + (x.active ? " on" : "")}><i /></span></button>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Repeating habits</h3>
          {s.habits.length === 0 && <div className="empty">None yet. Test a habit in What-if, then make it real.</div>}
          {s.habits.map((h) => (
            <div className="item" key={h.id}>
              <div className="ico">🔂</div>
              <div className="grow"><b>{h.name}</b><span className="sub">{inr(h.amount)} every {h.every === 1 ? "day" : h.every + " days"}</span></div>
              <button className="btn ghost sm" aria-label={"Stop " + h.name} onClick={() => act({ type: "REMOVE_HABIT", id: h.id }, "Habit stopped")}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GoalsScreen({ s, m, act, busy }) {
  const [name, setName] = useState(""); const [target, setTarget] = useState(""); const [custom, setCustom] = useState({});
  return (
    <div className="cols two">
      <div className="stack">
        {m.goals.map((g) => {
          const st = STATUS[g.status], pct = clamp((g.saved / g.target) * 100, 0, 100);
          return (
            <div className="card" key={g.id}>
              <div className="row"><div className="ico">{g.icon}</div><div className="grow"><b style={{ fontSize: 17 }}>{g.name}</b><span className="sub">{inr(g.saved)} of {inr(g.target)}</span></div><span className={"tag " + st[1]}>{st[0]}</span></div>
              <div className="bar" style={{ margin: "12px 0 8px" }}><div style={{ width: pct + "%", background: TONE[st[1]] }} /></div>
              {g.need > 0 ? (
                <p className="sub" style={{ margin: "0 0 10px" }}>Your forecast leaves room for {inr(g.alloc)} of the {inr(g.need)} still needed. Setting aside {inr(g.need / m.rem)} a day gets you there.</p>
              ) : <p className="sub" style={{ margin: "0 0 10px" }}>Fully funded. Nice work.</p>}
              {g.need > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {[100, 300, 500].map((p) => <button key={p} className="chip" disabled={busy} onClick={() => act({ type: "CONTRIBUTE", goalId: g.id, amount: p }, "Saved " + inr(p))}>+{inr(p)}</button>)}
                  <label className="field" style={{ height: 38, width: 110 }}><span>₹</span><input inputMode="numeric" placeholder="Other" aria-label={"Custom amount for " + g.name} value={custom[g.id] || ""} onChange={(e) => setCustom({ ...custom, [g.id]: e.target.value.replace(/\D/g, "") })} /></label>
                  <button className="btn ghost sm" disabled={busy || !custom[g.id]} onClick={() => act({ type: "CONTRIBUTE", goalId: g.id, amount: custom[g.id] }, "Saved " + inr(custom[g.id])).then((ok) => ok && setCustom({ ...custom, [g.id]: "" }))}>Save</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="stack">
        <div className="card">
          <h3>How goals work here</h3>
          <p className="sub" style={{ margin: 0 }}>Money you save leaves your wallet, so your daily allowance drops today and your goals get safer. After bills and surprises, whatever is left at month end is shared across goals in the order shown.</p>
        </div>
        <div className="card">
          <h3>Add a goal</h3>
          <div className="stack" style={{ marginTop: 8 }}>
            <label className="field"><input placeholder="Goal name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Goal name" /></label>
            <label className="field"><span>₹</span><input inputMode="numeric" placeholder="Target" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} aria-label="Target" /></label>
            <button className="btn blue" disabled={busy} onClick={() => act({ type: "ADD_GOAL", name, target }, "Goal added").then((ok) => ok && (setName(""), setTarget("")))}><Plus size={18} />Add goal</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthScreen({ s, m, setScenario, setTab }) {
  const sug = suggestions(s, m);
  return (
    <div className="cols two">
      <div className="stack">
        <div className="card">
          <div className="row" style={{ gap: 16 }}>
            <Ring score={m.health.score} tone={m.health.tone} size={110} />
            <div className="grow"><div className="sub" style={{ fontWeight: 700 }}>Financial health</div><div className="disp" style={{ fontSize: 30, fontWeight: 800 }}>{m.health.name}</div><span className="sub">Five things add up to this score.</span></div>
          </div>
          <div style={{ marginTop: 14 }}>
            {m.health.parts.map((p) => (
              <div key={p.key} style={{ marginBottom: 12 }}>
                <div className="row between"><b style={{ fontSize: 14 }}>{p.label}</b><span className="sub">{Math.round(p.pts)} / {p.max}</span></div>
                <div className="bar" style={{ marginTop: 5 }}><div style={{ width: (p.pts / p.max) * 100 + "%", background: p.pts / p.max > .7 ? "var(--mint)" : p.pts / p.max > .4 ? "var(--sun)" : "var(--coral)" }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Month forecast</h3>
          <p className="sub" style={{ margin: "0 0 8px" }}>Includes {inr(SHOCK_PER_DAY)} a day for surprises.</p>
          <Forecast s={s} m={m} height={190} />
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <div className="row between"><h3>Financial risk</h3><span className={"tag " + m.risk.tone}>{m.risk.name}</span></div>
          <div style={{ maxWidth: 200, margin: "0 auto" }}><Gauge score={m.risk.score} tone={m.risk.tone} label={m.risk.name} /></div>
          {m.risk.factors.map((f) => (
            <div className="item" key={f.key}>
              <div className="grow"><b style={{ fontSize: 14 }}>{f.label}</b><span className="sub" style={{ whiteSpace: "normal" }}>{f.note}</span></div>
              <span className={"tag " + (f.pts < f.max * .2 ? "mint" : f.pts < f.max * .6 ? "sun" : "coral")}>{Math.round(f.pts)}/{f.max}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Best next moves</h3>
          {sug.map((x) => (
            <div className="item" key={x.id}>
              <div className="ico">{x.icon}</div>
              <div className="grow"><b style={{ whiteSpace: "normal" }}>{x.title}</b><span className="sub" style={{ whiteSpace: "normal" }}>{x.body}</span></div>
              {x.decision && <button className="btn ghost sm" onClick={() => { setScenario((c) => [...c, { ...x.decision, uid: Math.random().toString(36).slice(2, 8) }]); setTab("whatif"); }}>Try it<ChevronRight size={14} /></button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
function Intro({ onStart }) {
  const [name, setName] = useState("");
  return (
    <div className="intro">
      <RunwayGrid s={initialState()} intro />
      <div>
        <h1 className="disp" style={{ fontSize: 44, lineHeight: 1, margin: "0 0 10px", fontWeight: 800 }}>₹10,000. 30 days. Every choice counts.</h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 16 }}>Runway shows what each decision does to your wallet, goals, risk and health before you make it.</p>
      </div>
      <label className="field" style={{ height: 54 }}><input placeholder="What should we call you?" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" onKeyDown={(e) => e.key === "Enter" && onStart(name)} /></label>
      <button className="btn blue block" style={{ height: 54 }} onClick={() => onStart(name)}>Start my 30 days<ArrowRight size={18} /></button>
    </div>
  );
}

export default function App() {
  const [s, setS] = useState(null);
  const [tab, setTab] = useState("home");
  const [busy, setBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [scenario, setScenario] = useState([]);
  const [daySheet, setDaySheet] = useState(null);
  const ref = useRef(null); ref.current = s;
  const timer = useRef(null);

  useEffect(() => { api.load().then((x) => setS(x || initialState())); }, []);
  const toast = (msg, bad) => { setToastMsg({ msg, bad }); clearTimeout(timer.current); timer.current = setTimeout(() => setToastMsg(null), 2400); };
  const act = async (action, okMsg) => {
    setBusy(true);
    try { const n = await api.call(ref.current, action); setS(n); if (okMsg) toast(okMsg); return true; }
    catch (e) { toast(e.message, true); return false; }
    finally { setBusy(false); }
  };

  if (!s) return <div className="rw"><style>{CSS}</style><div className="intro"><p className="sub">Loading your month…</p></div></div>;
  if (!s.name) return <div className="rw"><style>{CSS}</style><Intro onStart={(n) => act({ type: "START", name: n })} /></div>;

  const m = metrics(s);
  const ev = s.pendingEvent;
  const tabs = [["home", "Home", Home], ["whatif", "What-if", FlaskConical], ["bills", "Bills", Receipt], ["goals", "Goals", Target], ["health", "Health", Activity]];
  const finalM = s.finished ? m : null;

  return (
    <div className="rw">
      <style>{CSS}</style>
      <div className="page">
        <div className="top">
          <div><div className="sub" style={{ fontWeight: 700 }}>Hey {s.name}</div><h1 className="disp">{tabs.find((t) => t[0] === tab)[1] === "Home" ? "Your month" : tabs.find((t) => t[0] === tab)[1]}</h1></div>
          <span className="pill">Day {s.day} of {DAYS}</span>
        </div>
        {tab === "home" && <HomeScreen s={s} m={m} act={act} busy={busy} setTab={setTab} setDaySheet={setDaySheet} />}
        {tab === "whatif" && <WhatIfScreen s={s} m={m} scenario={scenario} setScenario={setScenario} act={act} busy={busy} toast={toast} />}
        {tab === "bills" && <BillsScreen s={s} m={m} act={act} busy={busy} />}
        {tab === "goals" && <GoalsScreen s={s} m={m} act={act} busy={busy} />}
        {tab === "health" && <HealthScreen s={s} m={m} setScenario={setScenario} setTab={setTab} />}
      </div>

      <nav className="nav" aria-label="Main">
        {tabs.map(([k, n, Icon]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}>
            <Icon size={20} />{n}
          </button>
        ))}
      </nav>

      {ev && (
        <Sheet label="Surprise" onClose={() => {}}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 46 }}>{ev.icon}</div>
            <div className="sub" style={{ fontWeight: 700 }}>{ev.kind === "windfall" ? "Good surprise" : "Unexpected expense"}</div>
            <h2 className="disp" style={{ margin: "2px 0 6px", fontSize: 26 }}>{ev.title}</h2>
            <p className="sub" style={{ margin: "0 0 10px" }}>{ev.blurb}</p>
            <div className="disp" style={{ fontSize: 44, fontWeight: 800, color: ev.kind === "windfall" ? "var(--mint)" : "var(--ink)" }}>{ev.kind === "windfall" ? "+" : ""}{inr(ev.amount)}</div>
          </div>
          {ev.kind === "shock" && (() => {
            const after = balanceOf(s) - ev.amount;
            return <p className="sub" style={{ textAlign: "center" }}>Paying from your wallet leaves {inr(after)}. Your daily allowance would be about {inr(Math.max(0, after - m.obligations - SHOCK_PER_DAY * (m.rem - 1)) / Math.max(1, m.rem - 1))}.</p>;
          })()}
          <div className="stack" style={{ marginTop: 10 }}>
            {ev.kind === "windfall"
              ? <button className="btn blue block" onClick={() => act({ type: "RESOLVE_EVENT" }, "Added to your wallet")}>Add to wallet</button>
              : <>
                <button className="btn blue block" disabled={busy} onClick={() => act({ type: "RESOLVE_EVENT", choice: "wallet" }, "Paid from wallet")}>Pay from wallet</button>
                {s.goals[0].saved >= ev.amount
                  ? <button className="btn ghost block" disabled={busy} onClick={() => act({ type: "RESOLVE_EVENT", choice: "emergency" }, "Emergency fund saved the day")}>Use emergency fund ({inr(s.goals[0].saved)} saved)</button>
                  : <p className="sub" style={{ textAlign: "center", margin: 0 }}>Your emergency fund has {inr(s.goals[0].saved)}. Build it up to cover surprises like this.</p>}
              </>}
          </div>
        </Sheet>
      )}

      {daySheet && (() => {
        const info = dayInfo(s, daySheet), past = daySheet <= s.day;
        return (
          <Sheet label={"Day " + daySheet} onClose={() => setDaySheet(null)}>
            <div className="row between"><h2 className="disp" style={{ margin: 0, fontSize: 24 }}>Day {daySheet}</h2><button className="btn ghost sm" onClick={() => setDaySheet(null)} aria-label="Close"><X size={16} /></button></div>
            {past
              ? <>{info.txs.length === 0 && <div className="empty">Nothing logged.</div>}{info.txs.map((t) => <div className="item" key={t.id}><div className="ico">{(CATS[t.cat] || CATS.food).icon}</div><div className="grow"><span className="t" style={{ fontWeight: 700 }}>{t.note}</span></div><div className="amt">{t.covered ? "Covered" : (t.amount > 0 ? "+" : "") + inr(t.amount)}</div></div>)}</>
              : <>{info.items.length === 0 && <div className="empty">No bills due. A free day, so spend within {inr(m.allowance)}.</div>}{info.items.map((x, i) => <div className="item" key={i}><div className="ico">{x.icon}</div><div className="grow"><b>{x.name}</b><span className="sub">Scheduled</span></div><div className="amt">{inr(x.amount)}</div></div>)}</>}
          </Sheet>
        );
      })()}

      {finalM && (
        <Sheet label="Month complete" onClose={() => {}}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 46 }}>{finalM.balance < 0 ? "😬" : finalM.health.score >= 70 ? "🏆" : "🌱"}</div>
            <h2 className="disp" style={{ margin: "4px 0", fontSize: 28 }}>Month complete</h2>
            <p className="sub" style={{ margin: "0 0 14px" }}>Here's how your 30 days landed.</p>
          </div>
          <div className="cmp" style={{ gridTemplateColumns: "1fr auto" }}>
            <span>Left in wallet</span><span className="r">{inr(finalM.balance)}</span>
            <span>Saved toward goals</span><span className="r">{inr(finalM.saved)}</span>
            <span>Total spent</span><span className="r">{inr(-sum(s.tx.filter((t) => t.amount < 0), (t) => t.amount))}</span>
            <span>Financial health</span><span className="r">{finalM.health.score}, {finalM.health.name}</span>
          </div>
          <button className="btn blue block" style={{ marginTop: 16 }} onClick={() => { setScenario([]); act({ type: "RESET" }); setTab("home"); }}><RotateCcw size={18} />Start a new month</button>
        </Sheet>
      )}

      {toastMsg && <div className={"toast" + (toastMsg.bad ? " bad" : "")} role="status">{toastMsg.msg}</div>}
    </div>
  );
}
