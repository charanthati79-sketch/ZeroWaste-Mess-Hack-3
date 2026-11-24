"use strict";
// Owns seed data and JSON persistence. The engine reads and mutates store.state, then calls store.persist().
const fs = require("fs");
const path = require("path");
const { istDate, addDays, DAY_NAMES } = require("./engine");

// "*" prefix marks a non-veg dish.
const B = [["Chole Bhature", "Sweet Lassi"], ["Poha", "*Boiled Egg", "Tea"], ["Idli Sambar", "Coconut Chutney"], ["Aloo Paratha", "Curd"], ["Upma", "Banana"], ["Masala Dosa", "Sambar"], ["Puri Bhaji", "Tea"]];
const L = [["*Chicken Curry", "Jeera Rice", "Roti"], ["Rajma", "Rice", "Roti"], ["Dal Tadka", "Bhindi Fry", "Rice"], ["Chole", "Rice", "Roti"], ["Sambar Rice", "Papad"], ["Kadhi Pakora", "Rice"], ["Veg Pulao", "Raita"]];
const S = [["Samosa"], ["Bread Pakora"], ["Sprouts Chaat"], ["Veg Sandwich"], ["Maggi"], ["Pav Bhaji"], ["Kachori"]];
const D = [["Paneer Butter Masala", "Naan"], ["Mix Veg", "Dal", "Roti"], ["*Egg Curry", "Rice", "Roti"], ["Lauki Kofta", "Roti", "Rice"], ["Aloo Gobi", "Dal Fry", "Roti"], ["*Fish Curry", "Rice"], ["Palak Paneer", "Roti"]];
const dish = d => (d[0] === "*" ? [d.slice(1), "nv"] : [d, "v"]);

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Isha", "Vikram", "Ananya", "Arjun", "Sneha"];
const LAST = ["Sharma", "Reddy", "Khan", "Patel", "Iyer"];

function freshState(cfg) {
  const students = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: FIRST[i % 10] + " " + LAST[Math.floor(i / 10)],
    room: String.fromCharCode(65 + Math.floor(i / 10)) + "-" + (101 + (i % 10)),
  }));
  const menus = {};
  DAY_NAMES.forEach((day, i) => {
    menus[day] = { b: B[i].map(dish), l: L[i].map(dish), s: S[i].map(dish), d: D[i].map(dish) };
  });
  const state = {
    hostels: [{ name: "Sunrise Hostel", enrolled: students.length }],
    students, menus, ngos: ["Robin Hood Army", "Feeding India"],
    optOuts: {}, myRatings: {}, dishRatings: {}, ratingLog: [], comments: [],
    polls: { title: "Weekend special?", options: ["Biryani", "Pizza night", "Chaat counter"], votes: {}, voted: [] },
    foodWasteLogs: [], ngoAlerts: [], audit: [], demoSeed: null,
  };
  if (cfg.demoSeed) {
    const date = addDays(istDate(Date.now()), 1);
    state.optOuts[date + "-d"] = Array.from({ length: 15 }, (_, i) => i + 1); // students 1-15; student16 stays free to demo
    state.demoSeed = { date, meal: "d", optedOut: 15 };
  }
  return state;
}

function createStore(cfg) {
  const file = path.join(cfg.dataDir, "db.json");
  let state;
  try {
    state = { ...freshState({ demoSeed: false }), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    state = freshState(cfg);
  }
  const persist = () => {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file); // atomic swap so a crash never leaves a half-written db
  };
  const audit = (actor, action, detail = {}) => {
    state.audit.push({ at: Date.now(), id: actor.id, role: actor.role, action, detail });
    if (state.audit.length > 500) state.audit.splice(0, state.audit.length - 500);
  };
  persist();
  return { state, persist, audit };
}

module.exports = { createStore };
