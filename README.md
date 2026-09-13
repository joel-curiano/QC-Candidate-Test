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

## Quick start at a glance

If you are setting this up for the first time, do these in order:

1. Create a Supabase project
2. Run `supabase/schema.sql` in the SQL editor
3. Add the required secrets in Supabase
4. Update `frontend/js/config.js` with your project URL
5. Deploy the Edge Function
6. Enable GitHub Pages
7. Open the site and create the first admin account

This app uses GitHub Pages for the frontend and Supabase Edge Functions for the backend. You do not need Supabase Auth for the normal login flow.

## Step-by-step setup

### Step 1: Prepare your tools

Make sure you have:

- A [Supabase](https://supabase.com) project
- The schema applied from `supabase/schema.sql`
- A [Brevo](https://www.brevo.com) account for email delivery
- A GitHub repository with GitHub Pages enabled

---

### Step 2: Create the Supabase database schema

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Open `supabase/schema.sql` in your repo.
4. Copy the contents and paste them into the SQL editor.
5. Click **Run**.
6. Confirm the tables were created successfully.

If you skip this step, the app will not have the required tables.

---

### Step 3: Add the required Supabase secrets

In **Supabase Dashboard → Project → Edge Functions → Secrets**, add the following values:

| Secret | What to enter |
|---|---|
| `SUPABASE_DB_URL` | Copy the PostgreSQL **session pooler** URI from Supabase → **Connect** → **Session pooler**. Keep the username, password, host, port, and database name exactly as shown. |
| `JWT_SECRET` | Generate a strong random value with at least 32 characters. Example: `openssl rand -base64 32` in Bash or Git Bash. This is used to sign your app JWTs. |
| `BREVO_API_KEY` | Create an API key in Brevo → **SMTP & API** → **API Keys**. |
| `SMTP_FROM` | Use a verified sender email from Brevo → **Senders & IP** → **Senders**. |
| `APP_URL` | Use your GitHub Pages URL, for example `https://yourusername.github.io/QC-Candidate-Test`. You can check it later in GitHub → **Repo** → **Settings** → **Pages**. |

> If you are not sure what to enter, the values are usually all available inside your Supabase dashboard and your Brevo account.

---

### Step 4: Update the frontend API URL

Open `frontend/js/config.js` and replace the placeholder with your project URL:

```js
const CONFIG = {
  API_URL: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/api',
};
```

Example:

```js
const CONFIG = {
  API_URL: 'https://abc123xyz.supabase.co/functions/v1/api',
};
```

To find the value:

1. Open your Supabase project
2. Go to **Settings** → **API**
3. Copy the **Project URL**
4. Use only the part before `.supabase.co`

Example:

```text
Project URL: https://abc123xyz.supabase.co
Project reference: abc123xyz
```

So the final API URL becomes:

```text
https://abc123xyz.supabase.co/functions/v1/api
```

---

### Step 5: Deploy the Supabase Edge Function

This is the backend code that handles login, question data, candidate submissions, and exports.

#### Option A — GitHub Actions (recommended)

Add these repository secrets in **GitHub → Repo → Settings → Secrets and variables → Actions**:

| Secret | What to enter |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Create a token in Supabase → **Account** → **Access Tokens**. |
| `SUPABASE_PROJECT_REF` | Use the project reference from your Supabase project URL, such as `abc123xyz`. |

Then push to `main`. The workflow in `.github/workflows/deploy-edge-functions.yml` deploys automatically.

#### Option B — Supabase CLI (local)

If you prefer to deploy from your computer:

```bash
npm install -g supabase
supabase login
supabase functions deploy api --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

Example:

```bash
supabase functions deploy api --project-ref fnbsrjljyyvvcsaxyqvk --no-verify-jwt
``` 

> Note: local Supabase CLI deployment may require Docker Desktop or Podman to be installed and available on your PATH.

---

### Step 6: Enable GitHub Pages

1. Open **GitHub → Repo → Settings → Pages**
2. Set **Source** to **GitHub Actions**
3. Push your code to `main` (this is the step that triggers the Pages workflow)
4. Wait for the workflow to finish
5. Copy the generated Pages URL from the same **Pages** screen

Your site will usually look like this:

```text
https://yourusername.github.io/QC-Candidate-Test
```

Use that exact URL as `APP_URL` in your Supabase secrets.

---

### Step 7: Create the first admin account

1. Open the GitHub Pages URL in your browser
2. If no users exist, the app will show an **Initial Setup** page
3. Create the first administrator account
4. Sign in and start creating reviewers, candidates, and schedules

This first account is the important one because it gives you the administrator access needed to set up the rest of the portal.

---

## Roles and grading

| Role | Access |
|---|---|
| Candidate | Sign in on the assigned date, take the randomized assessment, and view own results |
| Reviewer | Create/schedule candidates, send invitations, add questions, review and grade submissions, export results |
| Admin | All Reviewer access plus account management, projects, and question bank admin |

Assessments: 20 MCQ + 5 Essay + 5 Oral + 5 Practicum questions. MCQ worth 1 point each. Passing score: 70%. Final grades are immutable.

---

## Local scripts

Generate the expanded Excel question bank:

```bash
python scripts/generate_aramco_question_template.py
```

---

## Project files

| File | Purpose |
|---|---|
| `frontend/` | Static GitHub Pages site (HTML, CSS, Vanilla JS) |
| `frontend/js/config.js` | Edge Function URL — edit before deploying |
| `supabase/functions/api/index.ts` | Edge Function router (all API endpoints) |
| `supabase/functions/api/_db.ts` | PostgreSQL data layer |
| `supabase/functions/api/_auth.ts` | JWT + PBKDF2 password hashing |
| `supabase/functions/api/_email.ts` | Brevo HTTP email delivery |
| `supabase/functions/api/_excel.ts` | Excel import/export via SheetJS |
| `supabase/schema.sql` | One-time PostgreSQL schema setup |
| `seed_questions.json` | Sample question bank |
| `scripts/generate_aramco_question_template.py` | Local utility to generate a 2,000-row question workbook |
| `.github/workflows/deploy-pages.yml` | Deploy frontend to GitHub Pages |
| `.github/workflows/deploy-edge-functions.yml` | Deploy Edge Function to Supabase |

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| Login returns 401 | Verify `JWT_SECRET` is set in Supabase secrets and matches across deployments |
| "Set SUPABASE_DB_URL…" error | Add `SUPABASE_DB_URL` to Supabase Edge Function secrets |
| Email not delivered | Verify `BREVO_API_KEY` and `SMTP_FROM` secrets; confirm the sender email is verified in Brevo |
| GitHub Pages shows blank page | Check `API_URL` in `frontend/js/config.js` matches your Supabase project URL |
| Edge Function 500 error | Check Supabase Dashboard → Edge Functions → Logs |
| Candidate cannot log in | Confirm their `test_date` matches today and the invitation was sent |
| Civil QC missing | Create a Reviewer/Admin account and add Civil QC questions via the Question Bank |
