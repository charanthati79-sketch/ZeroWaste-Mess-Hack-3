"use strict";
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const sec = require("./security");
const { createStore } = require("./store");
const { createEngine } = require("./engine");
const { HttpError } = require("./errors");

// One account per student (student1..student50), one supervisor, one per NGO. Hashes are computed once at startup.
function buildAccounts(S, cfg) {
  const hash = {};
  for (const [role, pw] of Object.entries(cfg.passwords)) hash[role] = sec.hashPassword(pw, cfg.bcryptRounds);
  const list = S.students.map(s => ({ id: "student" + s.id, role: "student", name: s.name, sid: s.id, hash: hash.student }));
  list.push({ id: "supervisor", role: "supervisor", name: "Mess Supervisor", hash: hash.supervisor });
  S.ngos.forEach((n, i) => list.push({ id: "ngo" + (i + 1), role: "ngo", name: n, ngoName: n, hash: hash.ngo }));
  return new Map(list.map(a => [a.id, a]));
}

function createApp(cfg) {
  const store = createStore(cfg);
  const engine = createEngine(store);
  const accounts = buildAccounts(store.state, cfg);
  const app = express();
  if (cfg.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), "upgrade-insecure-requests": null } },
  }));
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use("/vendor/chart.js", express.static(path.join(__dirname, "..", "node_modules", "chart.js", "dist")));

  const api = express.Router();
  api.use(sec.rateLimit({ windowMs: 60e3, max: 300, message: "Too many requests. Slow down." }));
  api.use(sec.sameOriginGuard, express.json({ limit: "10kb" }));
  api.use((req, res, next) => (res.set("Cache-Control", "no-store"), next()));

  const failures = sec.createFailureTracker({ max: 5, windowMs: 15 * 60e3 });
  const loginLimit = sec.rateLimit({ windowMs: 60e3, max: 10, message: "Too many login attempts. Wait a minute." });

  api.post("/login", loginLimit, (req, res) => {
    const id = String(req.body?.id || "").trim().toLowerCase().slice(0, 40);
    const password = String(req.body?.password || "").slice(0, 200);
    if (failures.isLocked(id)) return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
    const account = accounts.get(id);
    if (!sec.checkPassword(password, account && account.hash)) {
      failures.record(id);
      return res.status(401).json({ error: "Wrong ID or password." });
    }
    failures.clear(id);
    res.cookie(sec.COOKIE_NAME, sec.signSession(cfg.secret, account), { ...sec.cookieOptions(cfg.production), maxAge: 8 * 3600e3 });
    store.audit(account, "login", {});
    res.json({ ok: true });
  });

  api.post("/logout", (req, res) => {
    res.clearCookie(sec.COOKIE_NAME, sec.cookieOptions(cfg.production));
    res.json({ ok: true });
  });

  // Everything below needs a valid session. The account is re-read from the server on every request.
  const auth = (req, res, next) => {
    const id = sec.readSession(cfg.secret, sec.parseCookies(req.headers.cookie)[sec.COOKIE_NAME]);
    const user = id && accounts.get(id);
    if (!user) return res.status(401).json({ error: "Please sign in." });
    req.user = user;
    next();
  };
  const body = req => req.body || {};
  const route = (method, p, role, fn) => api[method](p, auth, sec.requireRole(role), (req, res) => res.json(fn(req)));

  api.get("/state", auth, (req, res) => res.json(engine.viewFor(req.user)));

  route("post", "/optout", "student", r => engine.setOptOut(r.user.sid, body(r)));
  route("post", "/rate", "student", r => engine.rate(r.user.sid, body(r)));
  route("post", "/comment", "student", r => engine.comment(r.user.sid, body(r)));
  route("post", "/vote", "student", r => engine.vote(r.user.sid, body(r)));
  route("get", "/pass", "student", r => ({
    code: sec.signPass(cfg.secret, engine.issuePass(r.user.sid, String(r.query.date), String(r.query.meal))),
  }));
  route("post", "/scan", "supervisor", r => {
    const payload = sec.verifyPass(cfg.secret, body(r).code);
    return payload ? engine.scan(payload) : { result: "invalid" };
  });
  route("post", "/waste", "supervisor", r => engine.logWaste(r.user, body(r)));
  route("post", "/ngo/accept/:id", "ngo", r => engine.acceptAlert(r.user, r.params.id));

  api.use((req, res) => res.status(404).json({ error: "Not found." }));
  app.use("/api", api);

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: "Bad request." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return { app, store, engine };
}

module.exports = { createApp };
