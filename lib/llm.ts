import { z } from "zod";
import { getLlmEnv } from "./env";
import { ExperienceExtractionSchema, type ExperienceExtraction } from "./experience";
import type { MemoryContext } from "./hindsight";

/**
 * LLM module — OpenRouter (OpenAI-compatible HTTP API).
 * Provider: nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free via https://openrouter.ai/api/v1
 * Server-side only: the API key never reaches the browser.
 *
 * Rules:
 *  - Recommendations are derived ONLY from Hindsight recalled evidence.
 *  - If Hindsight is unavailable (available:false), do not generate a recommendation.
 *  - If evidence is empty, state clearly that memory is limited.
 *  - Evidence must be cited as [E1], [E2], etc. in the recommendation text.
 *  - Never invent historical service events.
 *  - The technician's outcome is the source of truth; LLM extraction is validated against it.
 *
 * No new dependencies are added: the implementation uses the built-in `fetch` API
 * with the OpenRouter OpenAI-compatible /chat/completions endpoint.
 */

// ------------------------------------------------------------------ constants

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// ------------------------------------------------------------------ HTTP helper

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterChoice {
  message: { role: string; content: string | null };
  finish_reason: string | null;
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
  error?: { message: string; code?: number };
}

/**
 * Internal: call OpenRouter /chat/completions.
 * Returns the text of the first choice, or throws on HTTP/parse failure.
 * Caller (generateRecommendation / extractExperience) wraps in try/catch.
 */
async function callOpenRouter(
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const { OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_BASE_URL: envBase } = getLlmEnv();
  const baseUrl = envBase ?? OPENROUTER_BASE_URL;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      // OpenRouter-recommended headers (informational; not secret)
      "HTTP-Referer": "https://servicememory.app",
      "X-Title": "ServiceMemory",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: maxTokens,
      messages,
      // Do NOT use response_format — not guaranteed on free models.
    }),
    signal: AbortSignal.timeout(60_000), // 60 s hard ceiling per call
  });

  if (!resp.ok) {
    // Try to extract a provider error message; fall back to HTTP status.
    let detail = `HTTP ${resp.status}`;
    try {
      const errBody = await resp.json() as { error?: { message?: string } };
      if (errBody?.error?.message) detail = `HTTP ${resp.status}: ${errBody.error.message}`;
    } catch { /* ignore parse error */ }
    throw new Error(`OpenRouter request failed: ${detail}`);
  }

  let body: OpenRouterResponse;
  try {
    body = await resp.json() as OpenRouterResponse;
  } catch {
    throw new Error("OpenRouter returned a non-JSON response body");
  }

  // Provider-level error embedded in a 200 response (some providers do this)
  if (body.error?.message) {
    throw new Error(`OpenRouter provider error: ${body.error.message}`);
  }

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("OpenRouter returned no text content in choices[0].message.content");
  }

  return content;
}

// ------------------------------------------------------------------ JSON parser

/**
 * Robustly extract JSON from a model response.
 * Handles:
 *   - plain JSON
 *   - JSON with leading/trailing whitespace
 *   - ```json … ``` fenced blocks
 *   - ``` … ``` fenced blocks (no language tag)
 *   - thinking-model tags like <think>…</think> wrapping the JSON
 * Throws SyntaxError if no valid JSON found.
 */
function parseModelJson(raw: string): unknown {
  // 1. Strip <think>…</think> reasoning blocks emitted by Nemotron reasoning models
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 2. Strip markdown code fences (```json … ``` or ``` … ```)
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // 3. If the text still contains a ``` block, try to extract the inner content
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  return JSON.parse(text);
}

// ------------------------------------------------------------------ test hook

/**
 * Test hook: no-op — there is no cached client to reset.
 * The function is exported so tests that import it don't break.
 * The real isolation point is vi.stubGlobal("fetch", …) in the test suite.
 */
export function resetLlmForTests(): void {
  // Nothing to reset: this implementation uses fetch directly, not a cached SDK client.
}

// ------------------------------------------------------------------ schemas

/**
 * The full structured recommendation response validated with Zod.
 */
export const RecommendationSchema = z.object({
  summary: z.string().min(10).max(2000),
  steps: z.array(z.string().min(1).max(500)).min(1).max(20),
  /** Which evidence items were cited, e.g. ["E1","E3"]. Empty if no evidence. */
  citations: z.array(z.string().regex(/^E\d+$/)).default([]),
  /** True when evidence was available but limited (< 2 items). */
  limitedEvidence: z.boolean().default(false),
  confidenceNote: z.string().max(400).optional(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

// ------------------------------------------------------------------ recommendation

const RECOMMENDATION_SYSTEM = `You are an expert field-service advisor for industrial equipment.
Your role is to recommend the most likely intervention for a technician, based SOLELY on
organizational memory recalled from past service events.

STRICT RULES — your responses must comply with all of these:
1. Ground every claim in the recalled evidence. Do not invent facts or events.
2. Cite evidence using its label [E1], [E2], etc. whenever you draw on it.
3. If the evidence list is empty, say so explicitly and state that memory is limited.
4. If evidence is limited (< 2 items), note this in confidenceNote.
5. Never fabricate measurement values, dates, or service events.
6. The technician makes the final call; you advise based on evidence only.
7. Return ONLY valid JSON that matches the schema — no markdown fences, no prose outside JSON.`;

const RECOMMENDATION_SCHEMA_DESCRIPTION = `{
  "summary": "string — max 2000 chars, cites evidence with [E#]",
  "steps": ["array of action strings, max 20 items"],
  "citations": ["array of cited evidence labels, e.g. [\\"E1\\",\\"E2\\"]"],
  "limitedEvidence": "boolean — true when fewer than 2 evidence items",
  "confidenceNote": "optional string — note any caveats about the evidence quality"
}`;

export interface RecommendationInput {
  assetCode: string;
  assetName: string;
  assetType: string;
  reportedProblem: string;
  currentMeasurement?: number | null;
  measurementName?: string;
  measurementUnit?: string;
  memory: MemoryContext;
}

export type RecommendationResult =
  | { ok: true; recommendation: Recommendation }
  | { ok: false; reason: string };

/**
 * Generate an evidence-based recommendation from recalled Hindsight memory.
 * Returns `{ ok: false }` when:
 *  - the LLM call fails (HTTP error, timeout, provider error)
 *  - the response is not valid JSON
 *  - the response fails Zod validation
 * Never throws.
 */
export async function generateRecommendation(
  input: RecommendationInput
): Promise<RecommendationResult> {
  const {
    assetCode,
    assetName,
    assetType,
    reportedProblem,
    currentMeasurement,
    measurementName,
    measurementUnit,
    memory,
  } = input;

  const measurementLine =
    currentMeasurement !== null && currentMeasurement !== undefined && measurementName
      ? `Current ${measurementName}: ${currentMeasurement}${measurementUnit ? ` ${measurementUnit}` : ""}.`
      : null;

  const evidenceSection =
    memory.evidenceCount === 0
      ? "NO RECALLED EVIDENCE — organizational memory has no records for this asset."
      : `RECALLED EVIDENCE (${memory.evidenceCount} item${memory.evidenceCount === 1 ? "" : "s"}):\n${memory.text}`;

  const userPrompt = `Asset: ${assetCode} (${assetName}, ${assetType})
Reported problem: ${reportedProblem}${measurementLine ? `\n${measurementLine}` : ""}

${evidenceSection}

Produce a JSON recommendation object matching this schema:
${RECOMMENDATION_SCHEMA_DESCRIPTION}

Base your recommendation ONLY on the recalled evidence above.
If evidence is empty or limited, say so clearly in the summary and set limitedEvidence:true.`;

  try {
    const rawText = await callOpenRouter(
      [
        { role: "system", content: RECOMMENDATION_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      1024
    );

    let parsed: unknown;
    try {
      parsed = parseModelJson(rawText);
    } catch {
      return {
        ok: false,
        reason: `LLM response was not valid JSON: ${rawText.slice(0, 200)}`,
      };
    }

    const result = RecommendationSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return { ok: false, reason: `LLM response failed validation: ${issues}` };
    }

    return { ok: true, recommendation: result.data };
  } catch (e) {
    return {
      ok: false,
      reason: `LLM call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ------------------------------------------------------------------ extraction

const EXTRACTION_SYSTEM = `You are a field-service data analyst.
Given a completed service job's details, extract structured facts.
Return ONLY valid JSON matching the schema. No markdown, no prose outside JSON.
RULES:
- The "outcome" field MUST exactly match the technician-confirmed outcome provided.
- Never invent measurements or facts not present in the input.
- Keep labels short and consistent (e.g. "alignment correction", "bearing replacement").`;

const EXTRACTION_SCHEMA_DESCRIPTION = `{
  "symptom": "string 3-300 chars — the root symptom in the technician's own words",
  "intervention": "string 3-300 chars — what was done, in plain English",
  "intervention_category": "string 2-60 chars — short label for tagging (e.g. 'alignment correction')",
  "outcome": "exactly one of: resolved | partial | unresolved — must match technician outcome",
  "lesson": "string 10-600 chars — the transferable lesson from this job",
  "observations": ["array of strings ≤ 8, each ≤ 300 chars — notable observations"]
}`;

export interface ExtractionInput {
  assetCode: string;
  assetType: string;
  reportedProblem: string;
  workPerformed: string;
  partsUsed: string | null;
  beforeMeasurement: number | null;
  afterMeasurement: number | null;
  measurementName: string;
  measurementUnit: string;
  /** The technician-confirmed outcome. Must match extraction.outcome or it's rejected. */
  outcome: "resolved" | "partial" | "unresolved";
  technicianNotes: string | null;
}

export type ExtractionResult =
  | { ok: true; extraction: ExperienceExtraction }
  | { ok: false; reason: string };

/**
 * Extract a structured ServiceExperience from a completed job.
 * Validates with Zod. Never throws.
 * The outcome in the extraction must match the technician's confirmed outcome
 * (also enforced in assembleExperience — this is a second guard here in the LLM layer).
 */
export async function extractExperience(input: ExtractionInput): Promise<ExtractionResult> {
  const lines: string[] = [
    `Asset: ${input.assetCode} (${input.assetType})`,
    `Reported problem: ${input.reportedProblem}`,
    `Work performed: ${input.workPerformed}`,
  ];
  if (input.partsUsed) lines.push(`Parts used: ${input.partsUsed}`);
  if (input.beforeMeasurement !== null)
    lines.push(
      `${input.measurementName} before: ${input.beforeMeasurement} ${input.measurementUnit}`
    );
  if (input.afterMeasurement !== null)
    lines.push(
      `${input.measurementName} after: ${input.afterMeasurement} ${input.measurementUnit}`
    );
  lines.push(`Technician-confirmed outcome: ${input.outcome}`);
  if (input.technicianNotes) lines.push(`Technician notes: ${input.technicianNotes}`);

  const userPrompt = `${lines.join("\n")}

Extract the JSON experience record matching this schema:
${EXTRACTION_SCHEMA_DESCRIPTION}

The "outcome" field MUST be exactly "${input.outcome}".`;

  try {
    const rawText = await callOpenRouter(
      [
        { role: "system", content: EXTRACTION_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      800
    );

    let parsed: unknown;
    try {
      parsed = parseModelJson(rawText);
    } catch {
      return {
        ok: false,
        reason: `LLM response not valid JSON: ${rawText.slice(0, 200)}`,
      };
    }

    const result = ExperienceExtractionSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return { ok: false, reason: `Extraction failed validation: ${issues}` };
    }

    // Double-check outcome consistency before returning (technician is source of truth)
    if (result.data.outcome !== input.outcome) {
      return {
        ok: false,
        reason: `LLM outcome "${result.data.outcome}" contradicts technician outcome "${input.outcome}"`,
      };
    }

    return { ok: true, extraction: result.data };
  } catch (e) {
    return {
      ok: false,
      reason: `LLM extraction call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
