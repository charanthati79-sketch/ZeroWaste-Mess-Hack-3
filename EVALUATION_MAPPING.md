# MessMeter — Evaluation Rubric Mapping

This note maps the implementation to the six categories in the supplied evaluation report. It is an evidence guide for the demo, not a prediction or guarantee of a particular mark.

| Evaluation category | What the evaluator checks | Evidence in this project | Suggested demo proof |
|---|---|---|---|
| **1. Requirements Fulfilment** | Feature completeness, scope, edge cases and testing | Seven-day / 28-slot menu; student opt-in/out; six-hour cutoff; per-meal headcount; waste logger; 1–5 dish feedback; 14-day analytics; NGO, rebate, poll and ingredient scaling stretch features | Show the Weekly menu, skip a future meal, view the headcount change, record waste, submit feedback and open analytics |
| **2. Code Quality & Best Practices** | Readability, modularity, naming, maintainability and reuse | `server/engine.js` isolates business rules; `server/store.js` owns seed data and persistence; `server/app.js` exposes REST routes; `public/app.js` handles UI; shared API and formatting helpers; centralized error handling | Open the engine and point to the independent headcount, ingredient, cutoff and NGO-threshold functions |
| **3. Functionality & Reliability** | Correctness, error handling, stability and expected behavior | Server-authoritative calculations; strict cutoff response; input range checks; duplicate-vote prevention; feedback update behavior; signed pass verification; structured request logs; automated API and engine tests | Try an opt-out after cutoff, an invalid waste value, a second poll vote and a valid / opted-out meal-pass verification |
| **4. System Design & Architecture** | Architecture, data design, separation of concerns and scalability | Three layers: browser UI → Express REST API → domain engine / JSON persistence; separate data collections for students, meals, opt-outs, waste logs, ratings, polls, alerts and audit events | Explain one complete flow: browser submits opt-out → API authenticates and validates → engine checks cutoff and recomputes headcount → store persists the updated response |
| **5. Security & Robustness** | Secure coding, validation, authentication, authorization and resilience | bcrypt password hashes; JWT in HttpOnly / SameSite cookie; student, supervisor and NGO roles; role-protected routes; Helmet headers and CSP; same-origin checks for state-changing requests; request-size and rate limits; server-side validation; HMAC-signed meal pass | Sign in as a student and attempt a supervisor-only waste request (403); then sign in as supervisor and verify a meal-pass code |
| **6. Innovation & Technical Complexity** | Originality, engineering depth and problem solving | NGO rescue beacon over 15 kg; estimated ₹30 rebate per advance skipped meal; committee poll with one vote per resident; raw-material quantity advisor with 5% buffer; HMAC pass and red opted-out status; Chart.js waste insight | Log more than 15 kg waste, switch to the NGO account, accept the alert and explain how the ingredient advisor uses the 1.05 multiplier |

## Important implementation detail

The report's previous security score was the weakest category. This version does not rely on a name dropdown or client-side role selection: the server reads the signed session, retrieves the account and applies role checks to protected routes. The six-hour deadline is enforced in the API even if someone bypasses the browser controls.

## Demo values

- Student profiles: **50**
- Weekly menu: **7 days × 4 meal services = 28 slots**
- Seeded example: **15 opted out → 35 expected diners**
- Tomorrow's dinner: **Lauki Kofta**, at **10:00 PM**
- Cutoff: **4:00 PM**, exactly six hours before dinner
- Ingredient formula: **expected diners × standard portion × 1.05**
- NGO trigger: **total waste greater than 15 kg**
- Estimated rebate: **₹30 per advance skipped meal**

The initial 15 opt-outs are marked as a demonstration seed scenario. Use `student16` to demonstrate a further opt-out while the meal is still outside its cutoff window.
