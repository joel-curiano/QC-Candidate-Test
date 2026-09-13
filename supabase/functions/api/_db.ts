/**
 * _db.ts — PostgreSQL data access layer.
 *
 * Replaces database.py. Uses the npm `postgres` driver (Deno-compatible).
 * All queries target the private `qc_portal` schema set via search_path.
 *
 * Connection string is read from the SUPABASE_DB_URL environment variable
 * (Supabase Edge Function secret) — same value used in .streamlit/secrets.toml.
 */

import postgres from "npm:postgres@3.4.5";
import { passwordHash, verifyPassword, generatePassword } from "./_auth.ts";
import seedData from "./seed_questions.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Singleton connection pool
// ---------------------------------------------------------------------------

let _sql: postgres.Sql | null = null;

function sql(): postgres.Sql {
  if (!_sql) {
    const url = Deno.env.get("SUPABASE_DB_URL");
    if (!url) throw new DatabaseError("Set SUPABASE_DB_URL in Supabase Edge Function secrets.");
    _sql = postgres(url, {
      ssl: "require",
      prepare: false, // required for PgBouncer/Supabase pooler
      max: 3,
      connection: { search_path: "qc_portal" },
    });
  }
  return _sql;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

const STARTER_DISCIPLINES = [
  "Civil QC", "Coating QC", "Communications QC", "Electrical QC", "E&I QC",
  "Instrumentation QC", "Mechanical QC", "NDT QC", "Piping QC", "Welding QC",
  "Pipeline QC", "PQCS",
];

// ---------------------------------------------------------------------------
// Helper: require user by role
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function requireUser(userId: number, roles: string[]): Promise<Record<string, any>> {
  const db = sql();
  const rows = await db`SELECT id,username,name,email,role FROM users WHERE id=${userId}`;
  const user = rows[0];
  if (!user || !roles.includes(user.role)) {
    throw new DatabaseError("You do not have permission for this action.");
  }
  return user;
}

// ---------------------------------------------------------------------------
// Schema migrations + seeding (idempotent; run on cold start)
// ---------------------------------------------------------------------------

let _initialized = false;

export async function initDb(): Promise<void> {
  if (_initialized) return;
  const db = sql();
  try {
    await db.begin(async (t) => {
      await t`SELECT pg_advisory_xact_lock(74192001)`;
      await t`ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_q_type_check`;
      await t`ALTER TABLE questions ADD CONSTRAINT questions_q_type_check
                CHECK (q_type IN ('mcq','essay','practicum','oral','practical'))`;
      await t`UPDATE questions SET max_points=1 WHERE q_type='mcq' AND max_points<>1`;
      await t`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS designation TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS iqama_no TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS employee_no TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS exam_date DATE NOT NULL DEFAULT CURRENT_DATE`;
      await t`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS project_location TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS test_date DATE`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ`;
      await t`CREATE TABLE IF NOT EXISTS projects (name TEXT PRIMARY KEY)`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_projects TEXT[] NOT NULL DEFAULT '{}'`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS discipline TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS iqama_no TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_no TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_no TEXT NOT NULL DEFAULT ''`;
      await t`ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_schedules JSONB NOT NULL DEFAULT '[]'::jsonb`;

      // Seed only when database is completely empty (no users, no questions)
      const hasUsers = (await t`SELECT 1 FROM users LIMIT 1`)[0];
      const hasQuestions = (await t`SELECT 1 FROM questions LIMIT 1`)[0];

      if (!hasUsers && !hasQuestions) {
        const originalQuestions = (seedData as unknown[][]).map((row) => {
          const r = row as [string, string, string, string | null, string | null, string, number];
          return {
            discipline: r[0], q_type: r[1], question_text: r[2],
            options: r[3], correct_answer: r[4], rubric: r[5],
            max_points: r[1] === "mcq" ? 1 : r[6],
          };
        });
        for (const q of originalQuestions) {
          await t`INSERT INTO questions(discipline,q_type,question_text,options,correct_answer,rubric,max_points)
                  VALUES(${q.discipline},${q.q_type},${q.question_text},${q.options},${q.correct_answer},${q.rubric},${q.max_points})`;
        }
        // Extra Electrical QC and Instrumentation QC starter questions
        const extraPrompts: Record<string, string> = {
          "Electrical QC": "Describe how you would inspect an electrical installation against approved drawings and test records. Explain how you would document and close an identified discrepancy.",
          "Instrumentation QC": "Describe how you would review instrument calibration and loop-check records. Explain traceability checks and how you would handle a failed result.",
        };
        for (const [discipline, essay] of Object.entries(extraPrompts)) {
          const opts = JSON.stringify(["Record and report the nonconformance","Ignore the result","Change the acceptance criteria","Approve without evidence"]);
          await t`INSERT INTO questions(discipline,q_type,question_text,options,correct_answer,rubric,max_points)
                  VALUES(${discipline},'mcq',${`During a ${discipline} inspection, a result does not meet the approved acceptance criteria. What should you do?`},${opts},'Record and report the nonconformance','',1)`;
          await t`INSERT INTO questions(discipline,q_type,question_text,options,correct_answer,rubric,max_points)
                  VALUES(${discipline},'essay',${essay},NULL,NULL,'Award up to 5 points each for: approved documents and criteria; inspection steps and evidence; nonconformance handling; verified closure and traceability.',20)`;
        }
      }

      // Seed Civil QC when discipline is missing (fresh databases without prior Civil questions)
      if (!hasUsers && !(await t`SELECT 1 FROM questions WHERE discipline='Civil QC' LIMIT 1`)[0]) {
        const civil = (seedData as unknown[][]).filter((r) => r[0] === "Civil QC") as [string, string, string, string | null, string | null, string, number][];
        for (const r of civil) {
          await t`INSERT INTO questions(discipline,q_type,question_text,options,correct_answer,rubric,max_points)
                  VALUES(${r[0]},${r[1]},${r[2]},${r[3]},${r[4]},${r[5]},${r[1] === "mcq" ? 1 : r[6]})`;
        }
      }
    });
    _initialized = true;
  } catch (e) {
    throw new DatabaseError(`Database initialisation failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function hasUsers(): Promise<boolean> {
  const db = sql();
  const rows = await db`SELECT 1 FROM users LIMIT 1`;
  return rows.length > 0;
}

export async function createUser(
  username: string, name: string, password: string, role: string,
  actor: number | null, bootstrap: boolean,
  email = "", testDate: string | null = null,
  discipline = "", iqamaNo = "", employeeNo = "", mobileNo = "",
): Promise<number> {
  username = username.trim().toLowerCase();
  name = name.trim();
  email = email.trim().toLowerCase();
  if (!username || !name || password.length < 6) {
    throw new DatabaseError("Enter a username, full name, and password of at least 6 characters.");
  }
  const hashed = await passwordHash(password);
  const db = sql();

  return await db.begin(async (t) => {
    await t`SELECT pg_advisory_xact_lock(74192002)`;
    if (bootstrap) {
      if ((await t`SELECT 1 FROM users LIMIT 1`)[0]) throw new DatabaseError("Initial setup is already complete.");
      role = "Admin";
    } else if (actor !== null) {
      const actor_user = await requireUser(actor, ["Admin", "Reviewer"]);
      if (actor_user.role === "Reviewer" && role !== "Candidate") throw new DatabaseError("Reviewers can only create Candidate accounts.");
    } else {
      throw new DatabaseError("Only Admin and Reviewer users can create Candidate accounts.");
    }
    if ((role === "Candidate" || role === "Reviewer") && !email) throw new DatabaseError(`${role} email is required.`);
    if (!["Candidate","Reviewer","Admin"].includes(role)) throw new DatabaseError("Invalid role.");

    try {
      const rows = await t`
        INSERT INTO users(username,name,email,test_date,password,role,discipline,iqama_no,employee_no,mobile_no)
        VALUES(${username},${name},${email},${testDate},${hashed},${role},${discipline},${iqamaNo},${employeeNo},${mobileNo})
        RETURNING id`;
      return rows[0].id;
    } catch (e) {
      if ((e as Error).message.includes("unique")) throw new DatabaseError("That username is already in use.");
      throw e;
    }
  });
}

export async function authenticate(
  username: string, password: string,
// deno-lint-ignore no-explicit-any
): Promise<Record<string, any> | null> {
  const db = sql();
  const rows = await db`SELECT * FROM users WHERE username=${username.trim().toLowerCase()}`;
  const user = rows[0];
  const stored: string = user?.password ?? await passwordHash("dummy", "0".repeat(32));
  const valid = await verifyPassword(password, stored);
  if (!valid || !user) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (user.role === "Candidate" && user.test_date?.toISOString?.()?.slice(0, 10) !== today) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role, email: user.email, test_date: user.test_date };
}

export async function changePassword(actorId: number, currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 6) throw new DatabaseError("New password must be at least 6 characters.");
  const db = sql();
  const rows = await db`SELECT id,password FROM users WHERE id=${actorId} FOR UPDATE`;
  if (!rows[0]) throw new DatabaseError("Account not found. Please sign in again.");
  const stored: string = rows[0].password;
  if (!await verifyPassword(currentPassword, stored)) throw new DatabaseError("Current password is incorrect.");
  if (await verifyPassword(newPassword, stored)) throw new DatabaseError("New password must be different from the current password.");
  await db`UPDATE users SET password=${await passwordHash(newPassword)} WHERE id=${actorId}`;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export async function candidateAccounts(actor: number): Promise<Record<string, any>[]> {
  await requireUser(actor, ["Admin", "Reviewer"]);
  const db = sql();
  return await db`SELECT id,username,name,email,test_date,invitation_sent_at,discipline,iqama_no,employee_no,mobile_no,previous_schedules
                  FROM users WHERE role='Candidate' ORDER BY test_date NULLS LAST, name`;
}

export async function updateCandidateSchedule(actor: number, candidateId: number, testDate: string): Promise<void> {
  if (!testDate) throw new DatabaseError("Candidate test date is required.");
  const db = sql();
  await requireUser(actor, ["Admin", "Reviewer"]);
  const rows = await db`SELECT email,test_date,previous_schedules FROM users WHERE id=${candidateId}`;
  if (!rows[0]) throw new DatabaseError("Candidate account not found.");
  const current = rows[0];
  const history: unknown[] = current.previous_schedules ?? [];
  const currentDate = current.test_date?.toISOString?.()?.slice(0, 10);
  if (currentDate && currentDate !== testDate) {
    history.push({ test_date: currentDate, scheduled_at: new Date().toISOString() });
  }
  await db`UPDATE users SET test_date=${testDate},previous_schedules=${JSON.stringify(history)}::jsonb,invitation_sent_at=NULL
           WHERE id=${candidateId} AND role='Candidate'`;
}

export async function removeCandidateSchedule(actor: number, candidateId: number): Promise<void> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  const rows = await db`UPDATE users SET test_date=NULL,invitation_sent_at=NULL WHERE id=${candidateId} AND role='Candidate' RETURNING id`;
  if (!rows[0]) throw new DatabaseError("Candidate account not found.");
}

export async function markInvitationSent(actor: number, candidateId: number): Promise<void> {
  await requireUser(actor, ["Admin", "Reviewer"]);
  const db = sql();
  const rows = await db`UPDATE users SET invitation_sent_at=CURRENT_TIMESTAMP WHERE id=${candidateId} AND role='Candidate' RETURNING id`;
  if (!rows[0]) throw new DatabaseError("Candidate account not found.");
}

export async function setCandidateTemporaryPassword(actor: number, candidateId: number, temporaryPassword: string): Promise<void> {
  if (temporaryPassword.length < 6) throw new DatabaseError("Temporary password must be at least 6 characters.");
  await requireUser(actor, ["Admin", "Reviewer"]);
  const db = sql();
  const rows = await db`UPDATE users SET password=${await passwordHash(temporaryPassword)} WHERE id=${candidateId} AND role='Candidate' RETURNING id`;
  if (!rows[0]) throw new DatabaseError("Candidate account not found.");
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function getProjects(actor: number): Promise<string[]> {
  await requireUser(actor, ["Admin", "Reviewer", "Candidate"]);
  const db = sql();
  return (await db`SELECT name FROM projects ORDER BY name`).map((r) => r.name);
}

export async function addProject(actor: number, name: string): Promise<void> {
  name = name.trim();
  if (!name) throw new DatabaseError("Project name cannot be empty.");
  await requireUser(actor, ["Admin"]);
  const db = sql();
  try {
    await db`INSERT INTO projects(name) VALUES(${name})`;
  } catch (e) {
    if ((e as Error).message.includes("unique")) throw new DatabaseError("Project already exists.");
    throw e;
  }
}

export async function deleteProject(actor: number, name: string): Promise<void> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  await db`DELETE FROM projects WHERE name=${name}`;
}

// ---------------------------------------------------------------------------
// Staff accounts
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export async function staffAccounts(actor: number): Promise<Record<string, any>[]> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  return await db`SELECT id,username,name,email,role,assigned_projects FROM users WHERE role IN ('Reviewer','Admin') ORDER BY role,name`;
}

export async function deleteUser(actor: number, userId: number): Promise<void> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  const target = (await db`SELECT id,role FROM users WHERE id=${userId}`)[0];
  if (!target) throw new DatabaseError("Account not found.");
  if (target.id === actor) throw new DatabaseError("Cannot delete your own account.");
  if (target.role === "Candidate") {
    const subs = await db`SELECT id FROM submissions WHERE user_id=${userId}`;
    if (subs.length) {
      const ids = subs.map((s) => s.id);
      await db`DELETE FROM answers WHERE submission_id=ANY(${ids})`;
      await db`DELETE FROM submissions WHERE id=ANY(${ids})`;
    }
  } else {
    await db`UPDATE submissions SET reviewer_id=NULL WHERE reviewer_id=${userId}`;
  }
  await db`DELETE FROM users WHERE id=${userId}`;
}

export async function updateStaffProjects(actor: number, staffId: number, projects: string[]): Promise<void> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  const staff = (await db`SELECT role FROM users WHERE id=${staffId}`)[0];
  if (!staff || !["Reviewer","Admin"].includes(staff.role)) throw new DatabaseError("Invalid staff account.");
  await db`UPDATE users SET assigned_projects=${projects} WHERE id=${staffId}`;
}

export async function updateReviewerEmail(actor: number, reviewerId: number, email: string): Promise<void> {
  email = email.trim().toLowerCase();
  if (!email || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) throw new DatabaseError("Enter a valid Reviewer email address.");
  await requireUser(actor, ["Admin"]);
  const db = sql();
  const rows = await db`UPDATE users SET email=${email} WHERE id=${reviewerId} AND role='Reviewer' RETURNING id`;
  if (!rows[0]) throw new DatabaseError("Reviewer account not found.");
}

export async function setReviewerTemporaryPassword(actor: number, reviewerId: number, temporaryPassword: string): Promise<void> {
  if (temporaryPassword.length < 6) throw new DatabaseError("Temporary password must be at least 6 characters.");
  await requireUser(actor, ["Admin"]);
  const db = sql();
  const rows = await db`UPDATE users SET password=${await passwordHash(temporaryPassword)} WHERE id=${reviewerId} AND role='Reviewer' RETURNING id`;
  if (!rows[0]) throw new DatabaseError("Reviewer account not found.");
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export async function questions(discipline?: string, includeInactive = false): Promise<Record<string, any>[]> {
  const db = sql();
  const rows = await db`
    SELECT q.*, EXISTS(SELECT 1 FROM answers a WHERE a.question_id=q.id) AS is_used
    FROM questions q ORDER BY q.discipline, q.id`;
  return rows.filter((q) =>
    (includeInactive || q.active) && (discipline === undefined || q.discipline === discipline)
  );
}

export async function disciplines(): Promise<string[]> {
  const db = sql();
  const rows = await db`SELECT DISTINCT discipline FROM questions ORDER BY discipline`;
  const fromDb = new Set(rows.map((r) => r.discipline));
  const all = [...new Set([...STARTER_DISCIPLINES, ...fromDb])];
  return all.sort();
}

export async function addQuestion(
  actor: number, discipline: string, kind: string, prompt: string,
  options: string[], correct: string, rubric: string, points: number,
): Promise<void> {
  const q = validateQuestion(discipline, kind, prompt, options, correct, rubric, points);
  await requireUser(actor, ["Admin", "Reviewer"]);
  const db = sql();
  await insertQuestion(db, q);
}

function validateQuestion(
  discipline: string, kind: string, prompt: string, options: string[],
  correct: string, rubric: string, points: number,
): [string, string, string, string[], string, string, number] {
  options = options.map((v) => v.trim()).filter(Boolean);
  if (!discipline.trim() || !prompt.trim() || points < 1 || points > 100) throw new DatabaseError("Discipline, question, and points (1-100) are required.");
  if (!["mcq","essay","practicum","oral","practical"].includes(kind)) throw new DatabaseError("Invalid question type.");
  if (kind === "mcq" && points !== 1) throw new DatabaseError("Multiple Choice questions must be worth exactly 1 point.");
  if (kind === "mcq" && (options.length < 2 || new Set(options).size !== options.length || !options.includes(correct))) {
    throw new DatabaseError("Provide unique options and an exact matching correct answer.");
  }
  if (["essay","practicum","oral","practical"].includes(kind) && !rubric.trim()) throw new DatabaseError("Essay, oral, and practical questions require a scoring rubric.");
  return [discipline.trim(), kind, prompt.trim(), options, correct.trim(), rubric.trim(), points];
}

async function insertQuestion(
  db: postgres.Sql,
  q: [string, string, string, string[], string, string, number],
): Promise<void> {
  const [discipline, kind, prompt, options, correct, rubric, points] = q;
  const existing = await db`SELECT id FROM questions WHERE discipline=${discipline} AND q_type=${kind} AND question_text=${prompt}`;
  if (existing[0]) throw new DatabaseError("Duplicate question found.");
  await db`INSERT INTO questions(discipline,q_type,question_text,options,correct_answer,rubric,max_points)
           VALUES(${discipline},${kind},${prompt},${kind==="mcq"?JSON.stringify(options):null},${kind==="mcq"?correct:null},${rubric},${points})`;
}

// deno-lint-ignore no-explicit-any
export async function addQuestions(actor: number, parsed: Record<string, any>[]): Promise<Record<string, any>[]> {
  await requireUser(actor, ["Admin", "Reviewer"]);
  const db = sql();
  for (const result of parsed) {
    if (!result.success) continue;
    const q = result.question;
    try {
      const validated = validateQuestion(q.discipline, q.kind, q.prompt, q.options, q.correct, q.rubric, q.points);
      await insertQuestion(db, validated);
    } catch (e) {
      result.success = false;
      result.error = (e as Error).message;
    }
  }
  return parsed;
}

export async function autogenerateQuestions(actor: number, discipline: string, kind: string, count: number): Promise<void> {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new DatabaseError("Count must be between 1 and 500.");
  if (!["mcq","essay","practicum","oral","practical"].includes(kind)) throw new DatabaseError("Invalid question type.");
  await requireUser(actor, ["Admin"]);
  const db = sql();
  const existing = (await db`SELECT COUNT(*) AS cnt FROM questions WHERE discipline=${discipline} AND q_type=${kind} AND question_text LIKE 'Auto-generated %'`)[0].cnt;
  for (let i = Number(existing) + 1; i <= Number(existing) + count; i++) {
    const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const prompt = `Auto-generated ${kind.toUpperCase()} Question ${i} for ${discipline} (${uid})`;
    try {
      if (kind === "mcq") {
        await insertQuestion(db, [discipline, kind, prompt, ["Option A","Option B"], "Option A", "", 1]);
      } else {
        await insertQuestion(db, [discipline, kind, prompt, [], "", "Award points for any reasonable answer.", 10]);
      }
    } catch { /* skip duplicates */ }
  }
}

export async function setActive(actor: number, questionId: number, active: boolean): Promise<void> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  await db`UPDATE questions SET active=${active?1:0} WHERE id=${questionId}`;
}

export async function deleteQuestion(actor: number, questionId: number, force = false): Promise<void> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  const isUsed = (await db`SELECT 1 FROM answers WHERE question_id=${questionId}`)[0];
  if (isUsed) {
    if (!force) throw new DatabaseError("Cannot delete a question that has been answered by a candidate.");
    const subs = await db`SELECT submission_id FROM answers WHERE question_id=${questionId}`;
    const ids = subs.map((s) => s.submission_id);
    if (ids.length) {
      await db`DELETE FROM answers WHERE submission_id=ANY(${ids})`;
      await db`DELETE FROM submissions WHERE id=ANY(${ids})`;
    }
  }
  await db`DELETE FROM questions WHERE id=${questionId}`;
}

export async function wipeQuestions(actor: number): Promise<void> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  await db`DELETE FROM questions WHERE id NOT IN (SELECT question_id FROM answers)`;
  await db`UPDATE questions SET active=0`;
}

export async function wipeArchivedQuestions(actor: number): Promise<void> {
  await requireUser(actor, ["Admin"]);
  const db = sql();
  const archived = await db`SELECT id FROM questions WHERE active=0`;
  for (const q of archived) {
    await deleteQuestion(actor, q.id, true);
  }
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export async function submit(
  actor: number, discipline: string,
  responses: Record<number, string>, token: string,
  candidateDetails: Record<string, unknown> = {},
  questionIds: number[] | null = null,
): Promise<number> {
  if (!token?.trim()) throw new DatabaseError("A submission reference is required.");
  const db = sql();

  return await db.begin(async (t) => {
    await t`SELECT pg_advisory_xact_lock(hashtextextended(${token},0))`;
    const user = (await t`SELECT id,username,name,email,role FROM users WHERE id=${actor}`)[0];
    if (!user || user.role !== "Candidate") throw new DatabaseError("You do not have permission for this action.");

    const existing = (await t`SELECT id,user_id FROM submissions WHERE token=${token}`)[0];
    if (existing) {
      if (existing.user_id !== actor) throw new DatabaseError("Invalid submission reference.");
      return existing.id;
    }

    let qs;
    if (questionIds === null) {
      qs = await t`SELECT * FROM questions WHERE discipline=${discipline} AND active=1 ORDER BY id FOR SHARE`;
    } else {
      if (new Set(questionIds).size !== questionIds.length) throw new DatabaseError("The assessment contains duplicate questions.");
      qs = await t`SELECT * FROM questions WHERE discipline=${discipline} AND active=1 AND id=ANY(${questionIds}) ORDER BY id FOR SHARE`;
    }

    const qIds = new Set(qs.map((q) => q.id));
    const rIds = new Set(Object.keys(responses).map(Number));
    if (!qs.length || qIds.size !== rIds.size || [...qIds].some((id) => !rIds.has(id))) {
      throw new DatabaseError("The question set changed. Reload the assessment before submitting.");
    }

    if (questionIds !== null) {
      const counts: Record<string, number> = { mcq: 0, essay: 0, oral: 0, practicum: 0 };
      for (const q of qs) if (counts[q.q_type] !== undefined) counts[q.q_type]++;
      if (counts.mcq !== 20 || counts.essay !== 5 || counts.oral !== 5 || counts.practicum !== 5) {
        throw new DatabaseError("The assessment must contain 20 MCQ, 5 Essay, 5 Oral, and 5 Practicum questions.");
      }
    }

    for (const q of qs) {
      const answer = responses[q.id];
      if (!answer?.trim() || answer.length > 20000) throw new DatabaseError("Answer every question (maximum 20,000 characters per answer).");
      if (q.q_type === "mcq" && !JSON.parse(q.options).includes(answer)) throw new DatabaseError("Choose a valid option for every MCQ.");
    }

    const candidateName = String(candidateDetails.name ?? user.name).trim();
    if (!candidateName) throw new DatabaseError("Candidate name is required.");
    const mcqScore = qs.filter((q) => q.q_type === "mcq" && responses[q.id] === q.correct_answer).reduce((s, q) => s + q.max_points, 0);
    const hasReviewer = qs.some((q) => ["essay","practicum","oral","practical"].includes(q.q_type));
    const status = hasReviewer ? "Pending Review" : "Graded";
    const maxPoints = qs.reduce((s, q) => s + q.max_points, 0);

    const sid = (await t`
      INSERT INTO submissions(candidate_name,designation,iqama_no,employee_no,exam_date,project_location,discipline,mcq_score,max_possible_points,status,user_id,token,created_at)
      VALUES(${candidateName},${String(candidateDetails.designation??'')},${String(candidateDetails.iqama_no??'')},${String(candidateDetails.employee_no??'')},${candidateDetails.exam_date??null},${String(candidateDetails.project_location??'')},${discipline},${mcqScore},${maxPoints},${status},${actor},${token},CURRENT_TIMESTAMP)
      RETURNING id`)[0].id;

    for (const q of qs) {
      const score = q.q_type === "mcq" && responses[q.id] === q.correct_answer ? q.max_points : 0;
      await t`INSERT INTO answers(submission_id,question_id,submitted_answer,awarded_score,snapshot)
              VALUES(${sid},${q.id},${responses[q.id]},${score},${JSON.stringify(q)})`;
    }
    await t`UPDATE users SET test_date=NULL WHERE id=${actor} AND role='Candidate'`;
    return sid;
  });
}

// deno-lint-ignore no-explicit-any
export async function submissions(actor: number): Promise<Record<string, any>[]> {
  const db = sql();
  const user = await requireUser(actor, ["Candidate","Reviewer","Admin"]);
  const projRow = (await db`SELECT assigned_projects FROM users WHERE id=${actor}`)[0];
  const assignedProjects: string[] = projRow?.assigned_projects ?? [];
  return await db`
    SELECT s.*, u.email, u.username, u.test_date AS scheduled_test_date,
           (SELECT COALESCE(SUM(a.awarded_score),0) FROM answers a WHERE a.submission_id=s.id AND a.snapshot::json->>'q_type'='essay') AS essay_only_score,
           (SELECT COALESCE(SUM(a.awarded_score),0) FROM answers a WHERE a.submission_id=s.id AND a.snapshot::json->>'q_type'='oral') AS oral_score,
           (SELECT COALESCE(SUM(a.awarded_score),0) FROM answers a WHERE a.submission_id=s.id AND a.snapshot::json->>'q_type'='practicum') AS practicum_score,
           (SELECT COALESCE(SUM(a.awarded_score),0) FROM answers a WHERE a.submission_id=s.id AND a.snapshot::json->>'q_type'='practical') AS practical_score
    FROM submissions s LEFT JOIN users u ON u.id=s.user_id
    WHERE s.user_id=${actor} OR ${user.role}='Admin' OR (${user.role}='Reviewer' AND s.project_location=ANY(${assignedProjects}))
    ORDER BY s.id DESC`;
}

// deno-lint-ignore no-explicit-any
export async function answerDetails(actor: number, sid: number): Promise<Record<string, any>[]> {
  await requireUser(actor, ["Reviewer","Admin"]);
  const db = sql();
  return await db`SELECT * FROM answers WHERE submission_id=${sid} ORDER BY id`;
}

export async function grade(
  actor: number, sid: number,
  scores: Record<number, number>, comments: string,
): Promise<void> {
  await requireUser(actor, ["Reviewer","Admin"]);
  const db = sql();
  const sub = (await db`SELECT * FROM submissions WHERE id=${sid} FOR UPDATE`)[0];
  if (!sub || sub.status === "Graded") throw new DatabaseError("This assessment has already been graded or is unavailable.");
  const essays = (await db`SELECT * FROM answers WHERE submission_id=${sid}`)
    .filter((a) => ["essay","practicum","oral","practical"].includes(JSON.parse(a.snapshot).q_type));
  const essayIds = new Set(essays.map((a) => a.id));
  const scoreIds = new Set(Object.keys(scores).map(Number));
  if (essayIds.size !== scoreIds.size || [...essayIds].some((id) => !scoreIds.has(id))) throw new DatabaseError("Score every essay before finalizing.");
  for (const a of essays) {
    const score = scores[a.id];
    const maxPoints = JSON.parse(a.snapshot).max_points;
    if (typeof score !== "number" || !isFinite(score) || score < 0 || score > maxPoints) throw new DatabaseError("Each score must be within the question's point range.");
    await db`UPDATE answers SET awarded_score=${score} WHERE id=${a.id}`;
  }
  const essayTotal = Object.values(scores).reduce((s, v) => s + v, 0);
  await db`UPDATE submissions SET essay_score=${essayTotal},status='Graded',reviewer_comments=${comments.trim()},reviewer_id=${actor},graded_at=CURRENT_TIMESTAMP WHERE id=${sid}`;
}

// deno-lint-ignore no-explicit-any
export function calcResult(sub: Record<string, any>): string {
  if (sub.status !== "Graded") return "Pending Review";
  const pct = sub.max_possible_points
    ? 100 * (Number(sub.mcq_score) + Number(sub.essay_score)) / Number(sub.max_possible_points)
    : 0;
  return `${pct >= 70 ? "PASS" : "FAIL"} (${pct.toFixed(1)}%)`;
}

export { generatePassword };
