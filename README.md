# QC Candidate Interview Portal

Static GitHub Pages frontend + Supabase Edge Functions backend. Candidate, Reviewer, and Admin accounts use the portal's own login system; Supabase Auth is not required. Only Admin and Reviewer users can create Candidate accounts.

## Architecture

```
GitHub Pages (frontend/)              Supabase Edge Functions
┌────────────────────────┐            ┌──────────────────────────────────┐
│ index.html             │   HTTPS    │ supabase/functions/api/index.ts  │
│ css/styles.css         │◄──────────►│  (all API routes, JWT auth)      │
│ js/app.js              │   JWT      └──────────────────────────────────┘
│ img/                   │                          │
└────────────────────────┘                          ▼
                                         Supabase PostgreSQL
                                         (existing qc_portal schema)
```

---

## 1. Prerequisites

- A [Supabase](https://supabase.com) project with the schema already applied (`supabase/schema.sql`)
- A [Brevo](https://www.brevo.com) account (free tier — 300 emails/day) for invitation emails. Go to **Senders & IP → Senders → Add a new sender**, enter an email address you own, and click Brevo's confirmation link. No domain is required.
- A GitHub repository with GitHub Pages enabled

---

## 2. Supabase Edge Function secrets

In **Supabase Dashboard → Project → Edge Functions → Secrets**, add:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | The PostgreSQL **session pooler** URI from Supabase → Connect → Session pooler. Keep the URI's username, password, host, port, and database name unchanged. |
| `JWT_SECRET` | A strong random string (≥32 characters) used to sign and verify the app’s own JWT login tokens. This secret must match across all deployments of the same project; generate it with a secure random password generator, PowerShell, or Bash, and store it only in Supabase Edge Function secrets. |

Generate it locally with:
```bash
# Bash / Git Bash / macOS / Linux
openssl rand -base64 32
```
| `BREVO_API_KEY` | From Brevo dashboard → SMTP & API → API Keys → Create a new API key |
| `SMTP_FROM`     | Your verified sender email address — any email you own (e.g. `yourname@gmail.com`). Verify it at Brevo → Senders & IP → Senders. |
| `APP_URL` | Your GitHub Pages URL, e.g. `https://yourusername.github.io/QC-Candidate-Test`. You can get this from GitHub → Repository → Settings → Pages, where GitHub shows the live Pages URL after deployment. |

---

## 3. Configure the frontend

Open `frontend/js/config.js` and replace the placeholder with your Supabase project URL:

```js
const CONFIG = {
  API_URL: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/api',
};
```

Find `YOUR_PROJECT_REF` at Supabase Dashboard → Project → Settings → API → Project URL.

---

## 4. Deploy the Edge Function

### Option A — GitHub Actions (recommended)

Add these secrets to **GitHub → Repo → Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | From https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | Your project reference ID |

Push to `main` — the included `.github/workflows/deploy-edge-functions.yml` workflow deploys automatically.

### Option B — Supabase CLI (local)

```bash
npm install -g supabase
supabase login
supabase functions deploy api --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

---

## 5. Enable GitHub Pages

1. Go to **GitHub → Repo → Settings → Pages**
2. Source: **GitHub Actions**
3. Push to `main` — the included `.github/workflows/deploy-pages.yml` workflow deploys `frontend/` automatically

Open your GitHub Pages URL. On the first visit, create the initial administrator. This account is stored in Supabase and works in all deployments sharing the same database.

---

## 6. Bootstrap & first use

1. Open the GitHub Pages URL
2. If no users exist, the portal shows an **Initial Setup** form — create the first Admin account
3. Sign in and begin creating Reviewers, Candidates, and scheduling assessments

---

## Roles and grading

| Role | Access |
|---|---|
| Candidate | Sign in on the assigned date, take the randomized assessment, view own results |
| Reviewer | Create/schedule Candidates, send invitations, add questions, review and grade submissions, export results |
| Admin | All Reviewer access plus account management, projects, and question bank admin |

Assessments: 20 MCQ + 5 Essay + 5 Oral + 5 Practicum questions. MCQ worth 1 point each. Passing score: 70%. Final grades are immutable.

---

## Local scripts (unchanged)

Generate the expanded Excel question bank:

```bash
python scripts/generate_aramco_question_template.py
```

---

## Files

| File | Purpose |
|---|---|
| `frontend/` | Static GitHub Pages site (HTML, CSS, Vanilla JS) |
| `frontend/js/config.js` | Edge Function URL — **edit before deploying** |
| `supabase/functions/api/index.ts` | Edge Function router (all API endpoints) |
| `supabase/functions/api/_db.ts` | PostgreSQL data layer (replaces `database.py`) |
| `supabase/functions/api/_auth.ts` | JWT + PBKDF2 password hashing |
| `supabase/functions/api/_email.ts` | Brevo HTTP email delivery (replaces `email_service.py`) |
| `supabase/functions/api/_excel.ts` | Excel import/export via SheetJS |
| `supabase/schema.sql` | One-time PostgreSQL schema setup (unchanged) |
| `seed_questions.json` | Sample question bank |
| `scripts/generate_aramco_question_template.py` | Local utility to generate 2,000-row question workbook |
| `.github/workflows/deploy-pages.yml` | Deploy frontend to GitHub Pages on push |
| `.github/workflows/deploy-edge-functions.yml` | Deploy Edge Function to Supabase on push |

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| Login returns 401 | Verify `JWT_SECRET` is set in Supabase secrets and matches across deployments |
| "Set SUPABASE_DB_URL…" error | Add `SUPABASE_DB_URL` to Supabase Edge Function secrets |
| Email not delivered | Verify `BREVO_API_KEY` and `SMTP_FROM` secrets; confirm the sender address is verified in Brevo → Senders & IP → Senders |
| GitHub Pages shows blank page | Check `API_URL` in `frontend/js/config.js` matches your Supabase project URL |
| Edge Function 500 error | Check Supabase Dashboard → Edge Functions → Logs |
| Candidate cannot log in | Confirm their `test_date` matches today; invitation must have been sent |
| Civil QC missing | Create a Reviewer/Admin account and add Civil QC questions via the Question Bank |
