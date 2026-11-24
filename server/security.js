"use strict";
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "mm_session";
const SESSION_HOURS = 8;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 4);

// ---- passwords (bcrypt) ----
const hashPassword = (password, rounds = 10) => bcrypt.hashSync(password, rounds);

// Always runs one bcrypt comparison, even for unknown users, so response time does not reveal valid IDs.
function checkPassword(password, hash) {
  const matches = bcrypt.compareSync(password, hash || DUMMY_HASH);
  return Boolean(hash) && matches;
}

// ---- session (signed JWT kept in an HttpOnly cookie) ----
const signSession = (secret, user) =>
  jwt.sign({ sub: user.id }, secret, { algorithm: "HS256", expiresIn: SESSION_HOURS + "h" });

function readSession(secret, token) {
  try {
    return jwt.verify(token, secret, { algorithms: ["HS256"] }).sub;
  } catch {
    return null;
  }
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    try {
      cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return cookies;
}

const cookieOptions = production => ({ httpOnly: true, sameSite: "strict", secure: production, path: "/" });

// ---- abuse protection ----
function rateLimit({ windowMs, max, message, keyFn = req => req.ip }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn(req);
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, times] of hits) if (!times.some(t => now - t < windowMs)) hits.delete(k);
    next();
  };
}

// Counts failed logins per account so a password cannot be guessed across many IPs.
function createFailureTracker({ max, windowMs }) {
  const failures = new Map();
  const recent = key => (failures.get(key) || []).filter(t => Date.now() - t < windowMs);
  return {
    isLocked: key => recent(key).length >= max,
    record: key => failures.set(key, [...recent(key), Date.now()]),
    clear: key => failures.delete(key),
  };
}

// State-changing requests must come from our own origin and carry JSON (blocks cross-site form posts).
function sameOriginGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const site = req.get("sec-fetch-site");
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* invalid origin header */
    }
    if (host !== req.get("host")) return res.status(403).json({ error: "Cross-origin request blocked." });
  } else if (site && !["same-origin", "none"].includes(site)) {
    return res.status(403).json({ error: "Cross-origin request blocked." });
  }
  if (!req.is("application/json")) return res.status(415).json({ error: "Send JSON (Content-Type: application/json)." });
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Your account cannot perform this action." });

// ---- HMAC-signed meal pass ----
const passKey = secret => crypto.createHmac("sha256", secret).update("messmeter-meal-pass-v1").digest();
const sign = (secret, body) => crypto.createHmac("sha256", passKey(secret)).update(body).digest();

function signPass(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + sign(secret, body).toString("base64url");
}

// Returns the payload when the signature is genuine, otherwise null.
function verifyPass(secret, code) {
  if (typeof code !== "string" || code.length > 400) return null;
  const parts = code.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = sign(secret, parts[0]);
  const given = Buffer.from(parts[1], "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return payload && payload.v === 1 ? payload : null;
  } catch {
    return null;
  }
}

module.exports = {
  COOKIE_NAME, hashPassword, checkPassword, signSession, readSession, parseCookies, cookieOptions,
  rateLimit, createFailureTracker, sameOriginGuard, requireRole, signPass, verifyPass,
};
