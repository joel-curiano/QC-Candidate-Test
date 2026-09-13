/**
 * index.ts — Supabase Edge Function: QC Portal API
 *
 * Single function handling all routes. Verifies its own JWTs (verify_jwt=false
 * in config.toml). CORS is enabled for all origins to support GitHub Pages.
 *
 * Deploy: supabase functions deploy api --project-ref YOUR_REF
 */

import { verifyJwt, signJwt, JwtPayload } from "./_auth.ts";
import * as db from "./_db.ts";
import { sendCandidateInvitation, sendReviewerCredentials, sendTestEmail, EmailDeliveryError } from "./_email.ts";
import { parseQuestions, templateBytes, excelBytes } from "./_excel.ts";

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  // postgres RowList is array-like but not a plain Array; spreading it ensures
  // JSON.stringify produces [...] instead of {}, so .map()/.filter() work on the frontend.
  const payload = Array.isArray(data) ? data : (data != null && typeof (data as any)[Symbol.iterator] === 'function' && typeof data !== 'string') ? [...(data as Iterable<unknown>)] : data;
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}


function jsonError(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function binary(data: Uint8Array, filename: string, mime: string): Response {
  return new Response(data, {
    headers: {
      ...CORS,
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

const JWT_SECRET = () => {
  const s = Deno.env.get("JWT_SECRET");
  if (!s) throw new Error("JWT_SECRET is not set in Supabase secrets.");
  return s;
};

async function requireAuth(req: Request): Promise<JwtPayload> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = token ? await verifyJwt(token, JWT_SECRET()) : null;
  if (!payload) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return payload;
}

// ---------------------------------------------------------------------------
// Route extraction
// ---------------------------------------------------------------------------

function getPath(req: Request): string {
  const url = new URL(req.url);
  // Strip /functions/v1/api prefix to get the route path
  const match = url.pathname.match(/\/api(?:\/(.*))?$/);
  return (match?.[1] ?? "").replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Ensure DB is migrated on cold start
  try {
    await db.initDb();
  } catch (e) {
    return jsonError(`Database init failed: ${(e as Error).message}`, 503);
  }

  const path = getPath(req);
  const method = req.method;

  try {
    // -----------------------------------------------------------------------
    // Public endpoints (no JWT required)
    // -----------------------------------------------------------------------

    if (path === "bootstrap/has-users" && method === "GET") {
      return json({ hasUsers: await db.hasUsers() });
    }

    if (path === "bootstrap/create-admin" && method === "POST") {
      const { username, name, password } = await req.json();
      await db.createUser(username, name, password, "Admin", null, true);
      return json({ ok: true });
    }

    if (path === "auth/login" && method === "POST") {
      const { username, password } = await req.json();
      const user = await db.authenticate(username, password);
      if (!user) return jsonError("Invalid username or password.", 401);
      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
      const token = await signJwt(
        { sub: user.id, role: user.role, name: user.name, exp },
        JWT_SECRET(),
      );
      return json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
    }

    // -----------------------------------------------------------------------
    // Authenticated endpoints
    // -----------------------------------------------------------------------

    const me = await requireAuth(req);
    const actorId: number = me.sub;

    // --- Change password ---
    if (path === "auth/change-password" && method === "POST") {
      const { currentPassword, newPassword } = await req.json();
      await db.changePassword(actorId, currentPassword, newPassword);
      return json({ ok: true });
    }

    // --- Generate password ---
    if (path === "auth/generate-password" && method === "GET") {
      return json({ password: db.generatePassword() });
    }

    // --- Disciplines ---
    if (path === "disciplines" && method === "GET") {
      return json(await db.disciplines());
    }

    // --- Candidates ---
    if (path === "candidates" && method === "GET") {
      return json(await db.candidateAccounts(actorId));
    }

    if (path === "candidates" && method === "POST") {
      const { username, name, email, discipline, iqama_no, employee_no, mobile_no } = await req.json();
      const password = db.generatePassword();
      const id = await db.createUser(username, name, password, "Candidate", actorId, false,
        email, null, discipline, iqama_no, employee_no, mobile_no);
      return json({ id, ok: true });
    }

    const candidateScheduleMatch = path.match(/^candidates\/(\d+)\/schedule$/);
    if (candidateScheduleMatch) {
      const candidateId = parseInt(candidateScheduleMatch[1]);
      if (method === "POST") {
        const { test_date } = await req.json();
        await db.updateCandidateSchedule(actorId, candidateId, test_date);
        return json({ ok: true });
      }
      if (method === "DELETE") {
        await db.removeCandidateSchedule(actorId, candidateId);
        return json({ ok: true });
      }
    }

    const candidateInviteMatch = path.match(/^candidates\/(\d+)\/invite$/);
    if (candidateInviteMatch && method === "POST") {
      const candidateId = parseInt(candidateInviteMatch[1]);
      const { email, name, username, discipline, test_date } = await req.json();
      const temporaryPassword = db.generatePassword();
      await db.setCandidateTemporaryPassword(actorId, candidateId, temporaryPassword);
      await sendCandidateInvitation(email, name, username, temporaryPassword, test_date, discipline);
      await db.markInvitationSent(actorId, candidateId);
      return json({ ok: true });
    }

    // --- Projects ---
    if (path === "projects" && method === "GET") {
      return json(await db.getProjects(actorId));
    }
    if (path === "projects" && method === "POST") {
      const { name } = await req.json();
      await db.addProject(actorId, name);
      return json({ ok: true });
    }
    const projDeleteMatch = path.match(/^projects\/(.+)$/);
    if (projDeleteMatch && method === "DELETE") {
      await db.deleteProject(actorId, decodeURIComponent(projDeleteMatch[1]));
      return json({ ok: true });
    }

    // --- Staff accounts ---
    if (path === "staff" && method === "GET") {
      return json(await db.staffAccounts(actorId));
    }
    if (path === "staff" && method === "POST") {
      const { username, name, email, role, password } = await req.json();
      const id = await db.createUser(username, name, password, role, actorId, false, email);
      return json({ id, ok: true });
    }

    const staffIdMatch = path.match(/^staff\/(\d+)$/);
    if (staffIdMatch && method === "DELETE") {
      await db.deleteUser(actorId, parseInt(staffIdMatch[1]));
      return json({ ok: true });
    }

    const staffEmailMatch = path.match(/^staff\/(\d+)\/email$/);
    if (staffEmailMatch && method === "PUT") {
      const { email } = await req.json();
      await db.updateReviewerEmail(actorId, parseInt(staffEmailMatch[1]), email);
      return json({ ok: true });
    }

    const staffPasswordMatch = path.match(/^staff\/(\d+)\/password$/);
    if (staffPasswordMatch && method === "PUT") {
      const { password } = await req.json();
      await db.setReviewerTemporaryPassword(actorId, parseInt(staffPasswordMatch[1]), password);
      return json({ ok: true });
    }

    const staffProjectsMatch = path.match(/^staff\/(\d+)\/projects$/);
    if (staffProjectsMatch && method === "PUT") {
      const { projects } = await req.json();
      await db.updateStaffProjects(actorId, parseInt(staffProjectsMatch[1]), projects);
      return json({ ok: true });
    }

    const staffEmailSendMatch = path.match(/^staff\/(\d+)\/send-credentials$/);
    if (staffEmailSendMatch && method === "POST") {
      const { email, name, username, password } = await req.json();
      await sendReviewerCredentials(email, name, username, password);
      return json({ ok: true });
    }

    // --- Questions ---
    if (path === "questions" && method === "GET") {
      const url = new URL(req.url);
      const discipline = url.searchParams.get("discipline") ?? undefined;
      const includeInactive = url.searchParams.get("include_inactive") === "true";
      return json(await db.questions(discipline, includeInactive));
    }

    if (path === "questions" && method === "POST") {
      const { discipline, kind, prompt, options, correct, rubric, points } = await req.json();
      await db.addQuestion(actorId, discipline, kind, prompt, options ?? [], correct ?? "", rubric ?? "", points);
      return json({ ok: true });
    }

    const questionActiveMatch = path.match(/^questions\/(\d+)\/active$/);
    if (questionActiveMatch && method === "PATCH") {
      const { active } = await req.json();
      await db.setActive(actorId, parseInt(questionActiveMatch[1]), active);
      return json({ ok: true });
    }

    const questionDeleteMatch = path.match(/^questions\/(\d+)$/);
    if (questionDeleteMatch && method === "DELETE") {
      const url = new URL(req.url);
      const force = url.searchParams.get("force") === "true";
      await db.deleteQuestion(actorId, parseInt(questionDeleteMatch[1]), force);
      return json({ ok: true });
    }

    if (path === "questions/import" && method === "POST") {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      if (!file) return jsonError("No file uploaded.");
      const buffer = await file.arrayBuffer();
      const parsed = parseQuestions(buffer);
      const results = await db.addQuestions(actorId, parsed);
      return json(results);
    }

    if (path === "questions/template" && method === "GET") {
      return binary(templateBytes(), "qc-question-template.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    if (path === "questions/autogenerate" && method === "POST") {
      const { discipline, kind, count } = await req.json();
      await db.autogenerateQuestions(actorId, discipline, kind, count);
      return json({ ok: true });
    }

    if (path === "questions/wipe" && method === "POST") {
      await db.wipeQuestions(actorId);
      return json({ ok: true });
    }

    if (path === "questions/wipe-archived" && method === "POST") {
      await db.wipeArchivedQuestions(actorId);
      return json({ ok: true });
    }

    // --- Submissions ---
    if (path === "submissions" && method === "GET") {
      const rows = await db.submissions(actorId);
      return json(rows.map((r) => ({ ...r, result: db.calcResult(r) })));
    }

    if (path === "submissions" && method === "POST") {
      const { discipline, responses, token, candidate_details, question_ids } = await req.json();
      const sid = await db.submit(actorId, discipline, responses, token, candidate_details, question_ids);
      return json({ id: sid });
    }

    const answersMatch = path.match(/^submissions\/(\d+)\/answers$/);
    if (answersMatch && method === "GET") {
      return json(await db.answerDetails(actorId, parseInt(answersMatch[1])));
    }

    const gradeMatch = path.match(/^submissions\/(\d+)\/grade$/);
    if (gradeMatch && method === "POST") {
      const { scores, comments } = await req.json();
      await db.grade(actorId, parseInt(gradeMatch[1]), scores, comments);
      return json({ ok: true });
    }

    // --- Exports ---
    if (path === "export/csv" && method === "GET") {
      const rows = await db.submissions(actorId);
      const withResult = rows.map((r) => ({ ...r, result: db.calcResult(r) }));
      const headers = ["Reference","Candidate","Candidate Email","Username","Designation","Iqama No","Employee No","Discipline","Project Location","Scheduled Test Date","Exam Date","Submitted (UTC)","Status","Multiple Choice Points","Essay Points","Oral Points","Practicum Points","Practical Points","Maximum Points","Result","Reviewer Comments","Graded (UTC)"];
      const csvLines = [headers.join(",")];
      for (const r of withResult) {
        const vals = [r.id,r.candidate_name,r.email??'',r.username??'',r.designation??'',r.iqama_no??'',r.employee_no??'',r.discipline??'',r.project_location??'',r.scheduled_test_date??'',r.exam_date??'',r.created_at??'Legacy record',r.status??'',r.mcq_score??0,r.status==='Graded'?(r.essay_only_score??0):'',r.status==='Graded'?(r.oral_score??0):'',r.status==='Graded'?(r.practicum_score??0):'',r.status==='Graded'?(r.practical_score??0):'',r.max_possible_points??0,r.result??'',r.reviewer_comments??'',r.graded_at??''];
        csvLines.push(vals.map((v) => {
          const s = String(v ?? '');
          const escaped = /^[=+\-@]/.test(s.trimStart()) ? `'${s}` : s;
          return `"${escaped.replace(/"/g, '""')}"`;
        }).join(","));
      }
      return new Response(csvLines.join("\r\n"), {
        headers: { ...CORS, "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="qc-results.csv"' },
      });
    }

    if (path === "export/excel" && method === "GET") {
      const rows = await db.submissions(actorId);
      const withResult = rows.map((r) => ({ ...r, result: db.calcResult(r) }));
      return binary(excelBytes(withResult), "CTA Record Log.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    // --- Email ---
    if (path === "email/test" && method === "POST") {
      const { email, name } = await req.json();
      await sendTestEmail(email, name);
      return json({ ok: true });
    }

    return jsonError("Not found.", 404);

  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.name === "DatabaseError" || err.name === "EmailDeliveryError" || err.status === 401) {
      return jsonError(err.message, err.status ?? 400);
    }
    console.error("Unhandled error:", err);
    return jsonError("An unexpected server error occurred.", 500);
  }
});
