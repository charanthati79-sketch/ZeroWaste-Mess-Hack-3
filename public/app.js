"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const IST = 5.5 * 3600e3, DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = n => String(n).padStart(2, "0");
const ymd = ms => new Date(ms + IST).toISOString().slice(0, 10);
const add = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const wd = d => DAYS[new Date(d + "T00:00:00Z").getUTCDay()];
const startOf = (d, m) => new Date(`${d}T${p2(m.hour)}:${p2(m.minute)}:00+05:30`).getTime();
const clk = ms => { const d = new Date(ms + IST), h = d.getUTCHours(); return `${h % 12 || 12}:${p2(d.getUTCMinutes())} ${h < 12 ? "AM" : "PM"}`; };

let V = null, tab = null, day = null, skew = 0, chart = null;
const now = () => Date.now() + skew;

function toast(t) {
  const e = $("#toast");
  e.textContent = t; e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 2800);
}

async function api(path, body) {
  const opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch("/api/" + path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "Request failed."), { status: r.status });
  return j;
}
async function load() {
  try { V = await api("state"); skew = V.serverNow - Date.now(); } catch { V = null; }
  render();
}
async function act(path, body, ok) {
  try { await api(path, body); if (ok) toast(ok); await load(); }
  catch (e) { toast(e.message); if (e.status === 401) load(); }
}

// ---------- shared pieces ----------
const dishHtml = ([n, k]) => `<span class="dish"><i class="dot ${k === "nv" ? "nv" : ""}"></i>${esc(n)}</span>`;
const kpi = (label, val) => `<div class="card kpi"><b>${val}</b><span class="sub">${label}</span></div>`;
const bars = poll => {
  const total = Object.values(poll.votes).reduce((a, b) => a + b, 0) || 1;
  return poll.options.map(o => {
    const v = poll.votes[o] || 0;
    return `<div class="row"><span>${esc(o)}</span><span class="sub">${v} vote${v === 1 ? "" : "s"}</span>` +
      (V.user.role === "student" ? `<button data-vote="${esc(o)}" ${poll.voted ? "disabled" : ""}>Vote</button>` : "") +
      `</div><div class="bar"><i style="width:${Math.round(v / total * 100)}%"></i></div>`;
  }).join("");
};

// ---------- login ----------
function login() {
  $("#main").innerHTML = `<div class="card" style="max-width:380px;margin:30px auto">
    <h2 style="margin-top:0">Sign in</h2>
    <label class="sub" for="lid">ID</label><input id="lid" type="text" autocomplete="username" style="width:100%" placeholder="student16, supervisor or ngo1">
    <label class="sub" for="lpw">Password</label><input id="lpw" type="password" autocomplete="current-password" style="width:100%;font:inherit;padding:7px 10px;border-radius:10px;border:2px solid var(--ink);background:var(--surface);color:var(--text)">
    <div class="btns"><button class="primary" data-login>Sign in</button></div></div>`;
}

// ---------- student ----------
function menuView() {
  const t = ymd(now()), dates = [...Array(7)].map((_, i) => add(t, i));
  const head = dates.map(d => `<th class="${d === t ? "today" : ""}">${wd(d)} ${d.slice(5)}</th>`).join("");
  const rows = V.meals.map(m => `<tr><th>${m.name}<br>${clk(startOf(t, m))}</th>` +
    dates.map(d => `<td>${((V.menus[wd(d)] || {})[m.key] || []).map(dishHtml).join("")}</td>`).join("") + "</tr>").join("");
  return `<div class="card scroll"><table><tr><th></th>${head}</tr>${rows}</table></div>`;
}

function mealsView() {
  const t = ymd(now()), days = [...Array(9)].map((_, i) => add(t, i - 2));
  const chips = days.map(d => `<button data-day="${d}" aria-pressed="${d === day}">${wd(d)} ${d.slice(8)}</button>`).join("");
  const cards = V.meals.map(m => {
    const s = startOf(day, m), cut = s - V.config.cutoffHours * 36e5, out = V.myOptOuts.includes(`${day}-${m.key}`);
    const reviewable = s <= now() && now() - s <= 7 * 864e5 && !out, canSkip = now() <= cut, over = now() > s + 72e5;
    const rows = ((V.menus[wd(day)] || {})[m.key] || []).map(([n, k]) => {
      const mine = V.myRatings[n] || 0, r = V.dishRatings[n], avg = r ? (r[0] / r[1]).toFixed(1) : "–";
      const stars = [1, 2, 3, 4, 5].map(i => `<button class="${i <= mine ? "on" : ""}" data-dish="${esc(n)}" data-n="${i}" data-date="${day}" data-meal="${m.key}" aria-label="${i} stars" ${reviewable ? "" : "disabled"}>★</button>`).join("");
      return `<div class="row"><span>${dishHtml([n, k])} <small class="note">${avg}★</small></span><span class="stars">${stars}</span></div>`;
    }).join("");
    return `<div class="card meal ${out ? "stamped" : ""}"><h3>${m.name}<time>${clk(s)}</time></h3>${rows}
      <button class="skip ${out ? "out" : ""}" data-skip="${m.key}" data-date="${day}" data-out="${out ? 0 : 1}" ${canSkip ? "" : "disabled"}>${out ? "Undo skip" : `Skip this meal (₹${V.config.rebatePerSkip} rebate)`}</button>
      <p class="note">${canSkip ? `Skip until ${clk(cut)} IST` : "Skip window closed"}</p>
      ${reviewable ? `<div class="cm"><input type="text" maxlength="200" placeholder="Comment on this meal"><button data-cm="${m.key}" data-date="${day}">Post</button></div>` : ""}
      ${!over && !out ? `<div class="btns"><button data-pass="${m.key}" data-date="${day}">Meal pass</button></div>` : ""}</div>`;
  }).join("");
  return `<div class="chips">${chips}</div><div class="grid">${cards}</div>`;
}

const pollView = () => `<div class="card"><h3 style="margin-top:0">${esc(V.poll.title)}</h3>${bars(V.poll)}
  <p class="note">One vote per resident.</p></div>`;

async function showPass(date, meal) {
  try {
    const { code } = await api(`pass?date=${date}&meal=${meal}`);
    let h = 2166136261;
    for (const c of code) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const cells = [...Array(49)].map(() => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return `<i class="${h & 1 ? "on" : ""}"></i>`; }).join("");
    $("#dlg").innerHTML = `<h3 style="margin-top:0">Meal pass</h3><div class="pass"><div class="qr">${cells}</div>
      <p class="note" style="word-break:break-all">${esc(code)}</p><p class="note">Show this code at the counter. It is signed by the server and cannot be edited.</p></div>
      <form method="dialog"><button class="primary">Close</button></form>`;
    $("#dlg").showModal();
  } catch (e) { toast(e.message); }
}

// ---------- supervisor ----------
function supDash() {
  const s = V.summary, nd = V.nextDinner;
  const fc = V.forecast.map(f => `<tr><td>${f.day} ${f.date.slice(5)}</td><td>${f.mealName}</td><td>${f.optOuts}</td><td>${f.headcount}</td><td>${f.plan.rice}</td><td>${f.plan.dal}</td><td>${f.plan.veg}</td></tr>`).join("");
  const ng = V.ngoAlerts.slice(0, 5).map(a => `<div class="ngo">${a.date} ${a.meal.toUpperCase()}: ${a.totalKg} kg (${a.surplusKg} kg surplus) · ${a.status === "open" ? "waiting for an NGO" : "accepted by " + esc(a.acceptedBy)}</div>`).join("") || `<p class="note">No alerts yet. Waste above ${V.config.ngoThresholdKg} kg alerts NGOs.</p>`;
  const cm = V.comments.map(c => `<div class="ngo"><b>${esc(c.name)}</b> on ${c.date} ${c.meal.toUpperCase()}: ${esc(c.text)}</div>`).join("") || `<p class="note">No comments yet.</p>`;
  const au = V.audit.map(a => `<div class="note">${clk(a.at)} · ${esc(a.id)} · ${esc(a.action)}</div>`).join("");
  return `<div class="kpis">${kpi("meals skipped", s.skippedMeals)}${kpi("saved (est.)", "₹" + s.moneySaved)}${kpi("rebates (est.)", "₹" + s.rebates)}${kpi("waste prevented", s.wastePreventedKg + " kg")}${nd ? kpi(`diners, dinner ${nd.date.slice(5)}`, nd.headcount) : ""}</div>
  <div class="card scroll" style="margin-bottom:12px"><h3 style="margin-top:0">Cooking plan (kg, includes 5% buffer)</h3>
    <table class="sup"><tr><th>Day</th><th>Meal</th><th>Skips</th><th>Diners</th><th>Rice</th><th>Dal</th><th>Veg</th></tr>${fc}</table></div>
  <div class="two"><div class="card"><h3 style="margin-top:0">Food waste</h3><canvas id="wc" height="160"></canvas>${V.foodWasteLogs.length ? "" : '<p class="note">Log waste in the Counter tab to see the chart.</p>'}</div>
  <div class="card"><h3 style="margin-top:0">NGO alerts</h3>${ng}</div>
  <div class="card"><h3 style="margin-top:0">Recent comments</h3>${cm}</div>
  <div class="card"><h3 style="margin-top:0">Committee poll</h3>${bars(V.poll)}</div>
  <div class="card"><h3 style="margin-top:0">Activity</h3>${au}</div></div>`;
}

function supCounter() {
  const t = ymd(now());
  const dates = [0, -1, -2].map(i => add(t, i)).map(d => `<option value="${d}">${d}</option>`).join("");
  const meals = V.meals.map(m => `<option value="${m.key}">${m.name}</option>`).join("");
  const num = (id, l) => `<label for="${id}">${l} (kg)</label><input id="${id}" type="number" min="0" step="0.1" value="0">`;
  return `<div class="two"><div class="card"><h3 style="margin-top:0">Verify meal pass</h3>
    <div class="cm"><input id="code" type="text" placeholder="Paste pass code"><button class="primary" data-scan>Check</button></div><div id="scanOut" style="text-align:center"></div></div>
  <div class="card"><h3 style="margin-top:0">Log food waste</h3>
    <label for="wd">Date</label><select id="wd">${dates}</select><label for="wm">Meal</label><select id="wm">${meals}</select>
    ${num("wr", "Rice")}${num("wl", "Dal")}${num("wv", "Vegetables")}${num("ws", "Unserved surplus")}
    <div class="btns"><button class="primary" data-waste>Save waste log</button></div></div></div>`;
}

async function scan() {
  try {
    const r = await api("scan", { code: $("#code").value.trim() });
    const who = r.student ? `<b>${esc(r.student.name)}</b> · room ${esc(r.student.room)}<br>${esc(r.meal)} · ${r.date}` : "";
    const msg = { valid: ["✓", "ok", "Valid pass"], opted_out: ["✗", "", "Student opted out of this meal"], expired: ["✗", "", "Pass expired"], invalid: ["✗", "", "Pass not genuine"] }[r.result];
    $("#scanOut").innerHTML = `<div class="cross ${msg[1]}">${msg[0]}</div><p>${msg[2]}</p>${who}${r.result === "valid" && !r.inShiftWindow ? '<p class="note">Outside the serving window.</p>' : ""}`;
  } catch (e) { toast(e.message); }
}

// ---------- NGO ----------
function ngoView() {
  const cards = V.alerts.map(a => `<div class="card" style="margin-bottom:12px"><h3 style="margin-top:0">${a.totalKg} kg available · ${a.date} ${a.meal.toUpperCase()}</h3>
    <p class="note">${a.surplusKg} kg is unserved surplus. Raised ${clk(a.createdAt)} IST.</p>
    ${a.status === "open" ? `<button class="primary" data-accept="${a.id}">Accept pickup</button>` : `<p class="ok">Accepted by ${esc(a.acceptedBy)}</p>`}</div>`).join("");
  return cards || `<div class="card"><p>No pickup alerts right now. They appear when a meal's waste goes above ${V.config.ngoThresholdKg} kg.</p></div>`;
}

// ---------- render ----------
const TABS = {
  student: [["menu", "Weekly menu"], ["meals", "My meals"], ["poll", "Poll"]],
  supervisor: [["dash", "Dashboard"], ["counter", "Counter"]],
  ngo: [["alerts", "Pickups"]],
};
function render() {
  if (chart) { chart.destroy(); chart = null; }
  $("#out").hidden = !V;
  $("#who").textContent = V ? `${V.user.name} (${V.user.role})${V.user.role === "student" ? ` · wallet ₹${V.wallet}` : ""}` : "Plan meals, cut food waste";
  if (!V) return login();
  const tabs = TABS[V.user.role];
  if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
  day = day || ymd(now());
  const body = { menu: menuView, meals: mealsView, poll: pollView, dash: supDash, counter: supCounter, alerts: ngoView }[tab]();
  $("#main").innerHTML = `<nav role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</nav>${body}`;
  const logs = V.foodWasteLogs;
  if (tab === "dash" && logs && logs.length && window.Chart) {
    const last = logs.slice(-10);
    chart = new Chart($("#wc"), { type: "bar", data: { labels: last.map(l => l.date.slice(5) + " " + l.meal.toUpperCase()), datasets: [{ data: last.map(l => l.total), backgroundColor: "#d9341f" }] }, options: { plugins: { legend: { display: false } } } });
  }
}

document.addEventListener("click", async e => {
  const b = e.target.closest("button"), d = b && b.dataset;
  if (!b) return;
  if (d.tab) { tab = d.tab; render(); }
  else if (d.day) { day = d.day; render(); }
  else if (d.skip) act("optout", { date: d.date, meal: d.skip, out: d.out === "1" }, d.out === "1" ? "Meal skipped" : "Skip undone");
  else if (d.dish) act("rate", { date: d.date, meal: d.meal, dish: d.dish, stars: +d.n }, "Rating saved");
  else if (d.cm) act("comment", { date: d.date, meal: d.cm, text: b.previousElementSibling.value }, "Comment posted");
  else if (d.pass) showPass(d.date, d.pass);
  else if (d.vote) act("vote", { option: d.vote }, "Vote counted");
  else if (d.accept) act("ngo/accept/" + d.accept, {}, "Pickup accepted");
  else if (d.scan !== undefined) scan();
  else if (d.waste !== undefined) {
    const v = id => $("#" + id).value;
    act("waste", { date: v("wd"), meal: v("wm"), rice: v("wr"), dal: v("wl"), veg: v("wv"), surplus: v("ws") }, "Waste logged");
  } else if (d.login !== undefined) {
    try { await api("login", { id: $("#lid").value, password: $("#lpw").value }); tab = null; await load(); }
    catch (err) { toast(err.message); }
  } else if (b.id === "out") { await api("logout", {}).catch(() => {}); V = null; render(); }
  else if (b.id === "theme") {
    const r = document.documentElement, dark = matchMedia("(prefers-color-scheme: dark)").matches;
    r.dataset.theme = (r.dataset.theme || (dark ? "dark" : "light")) === "dark" ? "light" : "dark";
  }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "lpw") document.querySelector("[data-login]").click(); });
setInterval(() => { if (V && !document.activeElement.matches("input,select")) load(); }, 30000);
load();
