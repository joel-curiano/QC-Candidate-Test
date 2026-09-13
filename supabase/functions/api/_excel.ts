/**
 * _excel.ts — Excel question-bank import and CTA Record Log export.
 *
 * Replaces question_import.py and result_export.py.
 * Uses SheetJS (xlsx) via npm: import, which is supported in Deno/Edge Functions.
 */

// @deno-types="npm:@types/xlsx"
import * as XLSX from "npm:xlsx@0.18.5";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedQuestion {
  rowNumber: number;
  success: boolean;
  error: string | null;
  prompt: string;
  question: {
    discipline: string;
    kind: string;
    prompt: string;
    options: string[];
    correct: string;
    rubric: string;
    points: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Template column headers (matches Python HEADERS list)
// ---------------------------------------------------------------------------

const HEADERS = [
  "Discipline",
  "Question type",
  "Question",
  "Multiple Choice options",
  "Correct answer",
  "Scoring rubric",
  "Maximum points",
];

const LEGACY_HEADERS = [
  "Discipline",
  "Question type",
  "Question",
  "MCQ options",
  "Correct answer",
  "Scoring rubric",
  "Maximum points",
];

// ---------------------------------------------------------------------------
// Parse uploaded Excel workbook
// ---------------------------------------------------------------------------

export function parseQuestions(buffer: ArrayBuffer): ParsedQuestion[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  } catch {
    throw new Error("The uploaded file is not a readable Excel workbook.");
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];

  if (!rows.length) throw new Error("The workbook does not contain any question rows.");

  const header = rows[0].slice(0, HEADERS.length).map((v) => String(v).trim());
  if (
    JSON.stringify(header) !== JSON.stringify(HEADERS) &&
    JSON.stringify(header) !== JSON.stringify(LEGACY_HEADERS)
  ) {
    throw new Error("The first row must contain the template headers in the expected order.");
  }

  const results: ParsedQuestion[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i].slice(0, HEADERS.length).map((v) => String(v ?? "").trim());
    if (row.every((v) => !v)) continue; // skip blank rows

    while (row.length < HEADERS.length) row.push("");
    const [discipline, kind, prompt, optionsRaw, correct, rubric, pointsRaw] = row;
    const rowNumber = i + 1;
    const entry: ParsedQuestion = {
      rowNumber,
      success: true,
      error: null,
      prompt,
      question: null,
    };

    try {
      if (!discipline || !prompt) throw new Error("Discipline and question are required.");
      if (!["mcq", "essay", "practicum", "oral", "practical"].includes(kind)) {
        throw new Error("Question type must be mcq, essay, practicum, oral, or practical.");
      }
      const maxPoints = parseInt(pointsRaw, 10);
      if (isNaN(maxPoints) || maxPoints < 1 || maxPoints > 100) {
        throw new Error("Maximum points must be a whole number from 1 to 100.");
      }
      const options = optionsRaw
        .split(/[;\n]/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (kind === "mcq") {
        if (options.length < 2 || new Set(options).size !== options.length || !options.includes(correct)) {
          throw new Error("Multiple Choice questions need unique options and an exact correct answer.");
        }
        if (maxPoints !== 1) throw new Error("Multiple Choice questions must have Maximum points set to 1.");
      } else if (!rubric) {
        throw new Error("Essay, oral, and practical questions require a scoring rubric.");
      }
      entry.question = { discipline, kind, prompt, options, correct, rubric, points: maxPoints };
    } catch (e) {
      entry.success = false;
      entry.error = (e as Error).message;
    }
    results.push(entry);
  }

  if (!results.length) throw new Error("The workbook does not contain any question rows.");
  return results;
}

// ---------------------------------------------------------------------------
// Generate blank template workbook
// ---------------------------------------------------------------------------

export function templateBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([HEADERS]);
  ws["!cols"] = [22, 16, 65, 45, 35, 65, 16].map((w) => ({ wch: w }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, "Questions");

  const instructions = XLSX.utils.aoa_to_sheet([
    ["Question bank import instructions"],
    ["Fill the Questions sheet and leave no completely blank rows between questions."],
    ["Question type must be mcq, essay, practicum, oral, or practical. For Multiple Choice questions, put one option per line in Multiple Choice options."],
    ["MCQ rows must use Maximum points = 1. Essay, oral, practicum, and practical rows may use a whole number from 1 to 100. Keep the headers unchanged."],
  ]);
  instructions["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

// ---------------------------------------------------------------------------
// CTA Record Log Excel export
// ---------------------------------------------------------------------------

const RESULT_HEADERS = [
  "Reference", "Candidate", "Candidate Email", "Username", "Designation",
  "Iqama No", "Employee No", "Discipline", "Project Location",
  "Scheduled Test Date", "Exam Date", "Submitted (UTC)", "Status",
  "Multiple Choice Points", "Essay Points", "Oral Points",
  "Practicum Points", "Practical Points", "Maximum Points",
  "Result", "Reviewer Comments", "Graded (UTC)",
];

function safeCell(value: unknown): unknown {
  if (typeof value === "string" && /^[=+\-@]/.test(value.trimStart())) return `'${value}`;
  return value ?? "";
}

// deno-lint-ignore no-explicit-any
function rowValues(row: Record<string, any>): unknown[] {
  const graded = row.status === "Graded";
  return [
    row.id, row.candidate_name, row.email ?? "", row.username ?? "",
    row.designation ?? "", row.iqama_no ?? "", row.employee_no ?? "",
    row.discipline ?? "", row.project_location ?? "",
    row.scheduled_test_date ?? "", row.exam_date ?? "",
    row.created_at ?? "Legacy record", row.status ?? "",
    row.mcq_score ?? 0,
    graded ? (row.essay_only_score ?? 0) : null,
    graded ? (row.oral_score ?? 0) : null,
    graded ? (row.practicum_score ?? 0) : null,
    graded ? (row.practical_score ?? 0) : null,
    row.max_possible_points ?? 0, row.result ?? "",
    row.reviewer_comments ?? "", row.graded_at ?? "",
  ];
}

// deno-lint-ignore no-explicit-any
export function excelBytes(rows: Record<string, any>[]): Uint8Array {
  const data = [RESULT_HEADERS, ...rows.map((r) => rowValues(r).map(safeCell))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!cols"] = [12, 24, 30, 18, 20, 18, 18, 18, 24, 20, 16, 22, 18, 20, 16, 16, 16, 16, 18, 18, 42, 22].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CTA Record Log");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}
