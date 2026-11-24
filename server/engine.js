"use strict";
// Domain engine. Part 1 is pure, independently testable rule functions (cutoff, headcount, ingredients,
// NGO threshold). Part 2 is createEngine(): the stateful actions that validate input and use those rules.
const crypto = require("crypto");
const { badRequest, conflict, notFound } = require("./errors");

const TZ_OFFSET_MS = 5.5 * 3600e3; // hostel timezone: IST (+05:30)
const DAY_MS = 864e5;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CFG = Object.freeze({
  timezone: "+05:30",
  cutoffHours: 6,
  maxAdvanceDays: 14,
  reviewWindowDays: 7,
  rebatePerSkip: 30,        // estimated rupees credited per advance-skipped meal
  costPerPlate: 16,         // estimated rupees saved per skipped meal
  wasteAvoidedKgPerSkip: 0.33,
  ngoThresholdKg: 15,       // total waste above this fires the NGO beacon
  safetyBuffer: 1.05,       // 5% cooking buffer
  portionKg: Object.freeze({ rice: 0.08, dal: 0.04, veg: 0.15 }),
  maxWasteKg: 500,
  passGraceMinutes: 15,
  passWindowMinutes: 120,
});

const MEALS = Object.freeze([
  { key: "b", name: "Breakfast", hour: 7, minute: 30 },
  { key: "l", name: "Lunch", hour: 12, minute: 30 },
  { key: "s", name: "Snack", hour: 17, minute: 0 },
  { key: "d", name: "Dinner", hour: 22, minute: 0 }, // 10:00 PM, so the cutoff is 4:00 PM
]);

// ================= Part 1: pure rules =================
const pad = n => String(n).padStart(2, "0");
const round2 = n => Math.round(n * 100) / 100;
const findMeal = key => MEALS.find(m => m.key === key);
const istDate = ms => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);

function isDateString(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekday = date => DAY_NAMES[new Date(date + "T00:00:00Z").getUTCDay()];

// Meal start as a Date, or null when the date or meal key is invalid.
function mealStart(date, key) {
  const meal = findMeal(key);
  if (!meal || !isDateString(date)) return null;
  return new Date(`${date}T${pad(meal.hour)}:${pad(meal.minute)}:00${CFG.timezone}`);
}

const cutoffTime = (date, key) => new Date(mealStart(date, key).getTime() - CFG.cutoffHours * 3600e3);
const isBeforeCutoff = (date, key, nowMs) => nowMs <= cutoffTime(date, key).getTime();

const expectedHeadcount = (enrolled, optOutCount) => Math.max(0, enrolled - optOutCount);

// Raw material (kg) = expected diners x per-capita portion x 1.05
function ingredientPlan(headcount) {
  const plan = {};
  for (const [item, portion] of Object.entries(CFG.portionKg)) plan[item] = round2(headcount * portion * CFG.safetyBuffer);
  return plan;
}

const wasteTotal = log => round2(log.rice + log.dal + log.veg + log.surplus);
const shouldAlertNgo = totalKg => totalKg > CFG.ngoThresholdKg;
const rebateFor = skippedMeals => skippedMeals * CFG.rebatePerSkip;
const savingsFor = skippedMeals => skippedMeals * CFG.costPerPlate;

function formatClock(ms) {
  const d = new Date(ms + TZ_OFFSET_MS);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${pad(d.getUTCMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

// ================= Part 2: stateful engine =================
function createEngine(store, clock = Date.now) {
  const S = store.state;
  const slotKey = (date, meal) => `${date}-${meal}`;
  const optedOut = (date, meal, student) => (S.optOuts[slotKey(date, meal)] || []).includes(student);
  const menuFor = (date, meal) => (S.menus[weekday(date)] || {})[meal] || [];
  const studentById = id => S.students[id - 1];

  function requireStudent(id) {
    if (!Number.isInteger(id) || id < 1 || id > S.students.length) throw badRequest("Unknown student.");
    return studentById(id);
  }

  function requireSlot(date, meal) {
    const start = mealStart(date, meal);
    if (!start) throw badRequest("Unknown meal or date.");
    return start.getTime();
  }

  function assertReviewWindow(start, now, what) {
    if (start > now) throw conflict(`${what} open once the meal starts.`);
    if (now - start > CFG.reviewWindowDays * DAY_MS) throw conflict(`${what} closed ${CFG.reviewWindowDays} days after the meal.`);
  }

  function parseKg(value, label) {
    if (value === undefined || value === null || value === "") return 0;
    const n = typeof value === "string" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > CFG.maxWasteKg) {
      throw badRequest(`${label} must be a number between 0 and ${CFG.maxWasteKg} kg.`);
    }
    return round2(n);
  }

  function slotsFrom(nowMs, count) {
    const slots = [];
    for (let date = istDate(nowMs); slots.length < count; date = addDays(date, 1)) {
      for (const meal of MEALS) {
        if (mealStart(date, meal.key).getTime() > nowMs && slots.length < count) slots.push({ date, meal });
      }
    }
    return slots;
  }

  // ---- student actions ----
  function setOptOut(student, { date, meal, out }) {
    requireStudent(student);
    const start = requireSlot(date, meal);
    const now = clock();
    if (typeof out !== "boolean") throw badRequest("'out' must be true or false.");
    if (!isBeforeCutoff(date, meal, now)) {
      const cutoff = formatClock(cutoffTime(date, meal).getTime());
      throw conflict(`Cutoff passed: opt-outs must be submitted at least ${CFG.cutoffHours} hours before the meal starts (${cutoff} IST for this meal).`);
    }
    if (start - now > CFG.maxAdvanceDays * DAY_MS) throw badRequest(`Opt-outs open ${CFG.maxAdvanceDays} days ahead.`);
    const list = S.optOuts[slotKey(date, meal)] || (S.optOuts[slotKey(date, meal)] = []);
    const i = list.indexOf(student);
    if (out && i < 0) list.push(student);
    else if (!out && i >= 0) list.splice(i, 1);
    store.audit({ id: "S" + pad(student), role: "student" }, out ? "optout.set" : "optout.clear", { date, meal });
    store.persist();
    return { optedOut: out };
  }

  function rate(student, { date, meal, dish, stars }) {
    requireStudent(student);
    assertReviewWindow(requireSlot(date, meal), clock(), "Rating opens");
    if (optedOut(date, meal, student)) throw conflict("You skipped this meal, so it cannot be rated.");
    if (typeof dish !== "string" || !menuFor(date, meal).some(d => d[0] === dish)) throw badRequest("That dish is not on this meal's menu.");
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw badRequest("Stars must be a whole number from 1 to 5.");
    const mineKey = student + "|" + dish;
    const previous = S.myRatings[mineKey] || 0;
    const totals = S.dishRatings[dish] || (S.dishRatings[dish] = [0, 0]);
    totals[0] += stars - previous;
    if (!previous) totals[1] += 1;
    S.myRatings[mineKey] = stars;
    S.ratingLog.push({ student, dish, date, meal, stars, at: clock() });
    store.persist();
    return { stars, updated: previous > 0 };
  }

  function comment(student, { date, meal, text }) {
    requireStudent(student);
    assertReviewWindow(requireSlot(date, meal), clock(), "Comments");
    if (optedOut(date, meal, student)) throw conflict("You skipped this meal, so it cannot be commented on.");
    const clean = String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
    if (!clean) throw badRequest("Write a comment first.");
    S.comments.unshift({ student, date, meal, text: clean, at: clock() });
    S.comments.length = Math.min(S.comments.length, 500);
    store.persist();
    return {};
  }

  function vote(student, { option }) {
    requireStudent(student);
    const poll = S.polls;
    if (poll.voted.includes(student)) throw conflict("You already voted.");
    if (typeof option !== "string" || !poll.options.includes(option)) throw badRequest("Unknown poll option.");
    poll.votes[option] = (poll.votes[option] || 0) + 1;
    poll.voted.push(student);
    store.audit({ id: "S" + pad(student), role: "student" }, "poll.vote", {});
    store.persist();
    return {};
  }

  // ---- meal pass ----
  function issuePass(student, date, meal) {
    requireStudent(student);
    const start = requireSlot(date, meal);
    const expires = start + CFG.passWindowMinutes * 60e3;
    if (clock() > expires) throw conflict("This meal is over, so no pass is issued.");
    if (start - clock() > CFG.maxAdvanceDays * DAY_MS) throw badRequest("Passes open " + CFG.maxAdvanceDays + " days ahead.");
    return { v: 1, sid: student, date, meal, exp: expires };
  }

  // Called with an already-verified pass payload; decides what the counter screen shows.
  function scan(payload) {
    const start = payload && Number.isInteger(payload.sid) ? mealStart(payload.date, payload.meal) : null;
    const student = start ? studentById(payload.sid) : null;
    if (!student) return { result: "invalid" };
    const now = clock();
    const base = { student: { name: student.name, room: student.room }, date: payload.date, meal: findMeal(payload.meal).name };
    if (now > payload.exp) return { ...base, result: "expired" };
    return {
      ...base,
      result: optedOut(payload.date, payload.meal, payload.sid) ? "opted_out" : "valid",
      inShiftWindow: now >= start.getTime() - CFG.passGraceMinutes * 60e3 && now <= payload.exp,
    };
  }

  // ---- supervisor and NGO actions ----
  function logWaste(actor, body) {
    const start = requireSlot(body.date, body.meal);
    if (start > clock()) throw conflict("Log waste only after the meal has started.");
    const log = {
      id: crypto.randomUUID(), date: body.date, meal: body.meal,
      rice: parseKg(body.rice, "Rice waste"), dal: parseKg(body.dal, "Dal waste"),
      veg: parseKg(body.veg, "Vegetable waste"), surplus: parseKg(body.surplus, "Unserved surplus"),
      at: clock(), by: actor.id,
    };
    log.total = wasteTotal(log);
    S.foodWasteLogs.push(log);
    let alert = null;
    if (shouldAlertNgo(log.total)) {
      alert = {
        id: crypto.randomUUID(), date: log.date, meal: log.meal, totalKg: log.total, surplusKg: log.surplus,
        notified: [...S.ngos], createdAt: clock(), status: "open", acceptedBy: null, acceptedAt: null,
      };
      S.ngoAlerts.unshift(alert);
    }
    store.audit(actor, "waste.log", { date: log.date, meal: log.meal, totalKg: log.total, ngoAlert: Boolean(alert) });
    store.persist();
    return { log, alert };
  }

  function acceptAlert(actor, id) {
    const alert = S.ngoAlerts.find(a => a.id === id);
    if (!alert) throw notFound("Alert not found.");
    if (alert.status !== "open") throw conflict(`Already accepted by ${alert.acceptedBy}.`);
    Object.assign(alert, { status: "accepted", acceptedBy: actor.ngoName, acceptedAt: clock() });
    store.audit(actor, "ngo.accept", { alert: id });
    store.persist();
    return { alert };
  }

  // ---- role-based views: each role receives only the data it needs ----
  function viewFor(user) {
    const now = clock();
    const view = {
      serverNow: now,
      user: { id: user.id, role: user.role, name: user.name, sid: user.sid || null, ngoName: user.ngoName || null },
      config: { cutoffHours: CFG.cutoffHours, rebatePerSkip: CFG.rebatePerSkip, ngoThresholdKg: CFG.ngoThresholdKg },
      meals: MEALS,
      hostel: S.hostels[0],
      menus: S.menus,
    };
    if (user.role === "student") return studentView(view, user.sid);
    if (user.role === "supervisor") return supervisorView(view, now);
    return { ...view, alerts: S.ngoAlerts };
  }

  function studentView(view, sid) {
    const mine = {};
    for (const [key, stars] of Object.entries(S.myRatings)) if (key.startsWith(sid + "|")) mine[key.slice(String(sid).length + 1)] = stars;
    const myOptOuts = Object.keys(S.optOuts).filter(key => S.optOuts[key].includes(sid));
    return {
      ...view, myOptOuts, myRatings: mine, dishRatings: S.dishRatings,
      wallet: rebateFor(myOptOuts.length),
      poll: { title: S.polls.title, options: S.polls.options, votes: S.polls.votes, voted: S.polls.voted.includes(sid) },
    };
  }

  function supervisorView(view, now) {
    const enrolled = S.hostels[0].enrolled;
    const optOutCounts = {};
    for (const [key, ids] of Object.entries(S.optOuts)) optOutCounts[key] = ids.length;
    const forecast = slotsFrom(now, 8).map(({ date, meal }) => {
      const outs = optOutCounts[slotKey(date, meal.key)] || 0;
      const headcount = expectedHeadcount(enrolled, outs);
      return { date, day: weekday(date), meal: meal.key, mealName: meal.name, optOuts: outs, headcount, plan: ingredientPlan(headcount) };
    });
    const nextDinner = forecast.find(f => f.meal === "d");
    const skipped = Object.values(optOutCounts).reduce((a, b) => a + b, 0);
    return {
      ...view, optOutCounts, forecast, nextDinner,
      fullHousePlan: ingredientPlan(enrolled),
      summary: {
        skippedMeals: skipped, moneySaved: savingsFor(skipped), rebates: rebateFor(skipped),
        wastePreventedKg: round2(skipped * CFG.wasteAvoidedKgPerSkip),
      },
      foodWasteLogs: S.foodWasteLogs, dishRatings: S.dishRatings, demoSeed: S.demoSeed || null,
      comments: S.comments.slice(0, 10).map(c => ({ name: studentById(c.student).name, date: c.date, meal: c.meal, text: c.text, at: c.at })),
      poll: { title: S.polls.title, options: S.polls.options, votes: S.polls.votes, voted: false },
      ngoAlerts: S.ngoAlerts, audit: S.audit.slice(-12).reverse(),
    };
  }

  return { setOptOut, rate, comment, vote, issuePass, scan, logWaste, acceptAlert, viewFor };
}

module.exports = {
  CFG, MEALS, DAY_NAMES, istDate, addDays, weekday, isDateString, mealStart, cutoffTime, isBeforeCutoff,
  expectedHeadcount, ingredientPlan, wasteTotal, shouldAlertNgo, rebateFor, savingsFor, round2, createEngine,
};
