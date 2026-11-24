"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REQUIRED_IN_PRODUCTION = ["JWT_SECRET", "STUDENT_PASSWORD", "SUPERVISOR_PASSWORD", "NGO_PASSWORD"];

function persistedSecret(dir) {
  const file = path.join(dir, "secret.txt");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

// Reads the environment once. In production the app refuses to start with default credentials.
function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  if (production) {
    const missing = REQUIRED_IN_PRODUCTION.filter(name => !env[name]);
    if (missing.length) throw new Error("Missing required environment variables in production: " + missing.join(", "));
    if (env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters.");
  }
  const dataDir = env.DATA_DIR || path.join(__dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    production,
    port: Number(env.PORT) || 3000,
    dataDir,
    secret: env.JWT_SECRET || persistedSecret(dataDir),
    passwords: {
      student: env.STUDENT_PASSWORD || "mess123",
      supervisor: env.SUPERVISOR_PASSWORD || "mess@123",
      ngo: env.NGO_PASSWORD || "ngo@123",
    },
    bcryptRounds: Number(env.BCRYPT_ROUNDS) || 10,
    trustProxy: env.TRUST_PROXY === "1",
    demoSeed: env.DEMO_SEED !== "off",
  };
}

module.exports = { loadConfig };
