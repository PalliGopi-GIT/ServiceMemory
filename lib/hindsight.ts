import { HindsightClient, HindsightError } from "@vectorize-io/hindsight-client";
import { getHindsightEnv } from "./env";
import { percentChange, type ServiceExperience } from "./experience";

/**
 * Hindsight = organizational memory ("what did we learn?").
 * This is the ONLY module that talks to Hindsight. It uses the official
 * `@vectorize-io/hindsight-client` SDK (retain / recall / createBank / getDocument / getVersion).
 * Server-side only: the API key never reaches the browser.
 *
 * Verified against @vectorize-io/hindsight-client@0.10.1 type declarations.
 */

// ------------------------------------------------------------------ config
export const EXPERIENCE_CONTEXT = "field service outcome";
const RETAIN_TIMEOUT_MS = 90_000; // retain is synchronous and runs LLM fact extraction
const RECALL_TIMEOUT_MS = 20_000;

const RETAIN_MISSION =
  "Extract facts about field-service maintenance events on industrial equipment. " +
  "For each service event capture: the asset identifier, the symptom, the intervention performed, " +
  "the measurement before and after the intervention (keep exact numbers and units), and the outcome " +
  "(resolved, partial improvement, or unresolved). Keep each intervention together with its measured " +
  "result in the same fact so cause and effect are never separated.";

const REFLECT_MISSION =
  "You are the organizational memory of a field-service company. Summarize what past service " +
  "interventions on an asset achieved, based only on recorded outcomes. Never claim certainty the evidence does not support.";

// ------------------------------------------------------------------ errors
export class HindsightUnavailableError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "HindsightUnavailableError";
  }
}

function toUnavailable(op: string, e: unknown): HindsightUnavailableError {
  if (e instanceof HindsightUnavailableError) return e;
  if (e instanceof HindsightError) {
    return new HindsightUnavailableError(`Hindsight ${op} failed (HTTP ${e.statusCode ?? "?"}): ${e.message}`, e.statusCode);
  }
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
    return new HindsightUnavailableError(`Hindsight ${op} timed out`);
  }
  return new HindsightUnavailableError(`Hindsight ${op} failed: ${e instanceof Error ? e.message : String(e)}`);
}

// ------------------------------------------------------------------ client
let client: HindsightClient | null = null;

export function getHindsightClient(): HindsightClient {
  if (!client) {
    const env = getHindsightEnv();
    client = new HindsightClient({
      baseUrl: env.HINDSIGHT_BASE_URL,
      apiKey: env.HINDSIGHT_API_KEY,
      userAgent: "servicememory/0.1.0",
    });
  }
  return client;
}

/** Test hook: drop the cached client (and bank cache). */
export function resetHindsightForTests() {
  client = null;
  ensuredBanks.clear();
}

export function getBankId(override?: string): string {
  return override ?? getHindsightEnv().HINDSIGHT_BANK_ID;
}

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

const ensuredBanks = new Set<string>();

/** createBank is "create or update", so this is idempotent. Cached per process. */
export async function ensureBank(bankId?: string, signal?: AbortSignal): Promise<string> {
  const id = getBankId(bankId);
  if (ensuredBanks.has(id)) return id;
  try {
    await getHindsightClient().createBank(id, {
      reflectMission: REFLECT_MISSION,
      retainMission: RETAIN_MISSION,
      signal: withTimeout(RECALL_TIMEOUT_MS, signal),
    });
  } catch (e) {
    throw toUnavailable("createBank", e);
  }
  ensuredBanks.add(id);
  return id;
}

// ------------------------------------------------------------ tags / ids
const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Single source of truth for the asset scoping tag, used by both retain and recall. */
export const assetTag = (assetCode: string) => `asset:${assetCode.trim().toUpperCase()}`;

export const experienceDocumentId = (jobId: string) => `service-job:${jobId}`;

export function experienceTags(exp: ServiceExperience): string[] {
  return [
    assetTag(exp.assetCode),
    `asset-type:${slug(exp.assetType)}`,
    `outcome:${exp.outcome}`,
    `intervention:${slug(exp.extraction.intervention_category)}`,
  ];
}

// ------------------------------------------------------------- narrative
const OUTCOME_LABEL = { resolved: "RESOLVED", partial: "PARTIAL IMPROVEMENT", unresolved: "NOT RESOLVED" } as const;

/**
 * Turn one completed job into a natural-language narrative. Hindsight's retain extracts facts
 * from prose with an LLM, so we give it a clear, self-contained account. Numbers come from the
 * technician's confirmed record; the percent change is computed deterministically.
 */
export function buildExperienceNarrative(exp: ServiceExperience): string {
  const date = exp.completedAt.slice(0, 10);
  const unit = exp.measurementUnit;
  const pct = percentChange(exp.beforeMeasurement, exp.afterMeasurement);
  const lines = [
    `Service outcome for asset ${exp.assetCode} (${exp.assetName}, ${exp.assetType}) at ${exp.customerName}, ${exp.location}, completed on ${date} by technician ${exp.technicianName}.`,
    `Reported problem: ${exp.reportedProblem}.`,
    `Symptom: ${exp.extraction.symptom}.`,
  ];
  if (exp.beforeMeasurement !== null)
    lines.push(`Measured ${exp.measurementName} before the intervention: ${exp.beforeMeasurement} ${unit}.`);
  lines.push(`Intervention performed on ${exp.assetCode}: ${exp.workPerformed}.`);
  if (exp.partsUsed) lines.push(`Parts used: ${exp.partsUsed}.`);
  if (exp.afterMeasurement !== null)
    lines.push(
      `Measured ${exp.measurementName} after the intervention: ${exp.afterMeasurement} ${unit}` +
        (pct !== null ? ` (a ${Math.abs(pct)}% ${pct <= 0 ? "reduction" : "increase"}).` : ".")
    );
  lines.push(`Outcome of the ${exp.extraction.intervention_category} on ${exp.assetCode}: ${OUTCOME_LABEL[exp.outcome]}.`);
  if (exp.technicianNotes) lines.push(`Technician notes: ${exp.technicianNotes}`);
  for (const o of exp.extraction.observations) lines.push(`Observation: ${o}.`);
  lines.push(`Lesson learned: ${exp.extraction.lesson}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- retain
export interface StoreResult {
  bankId: string;
  documentId: string;
  tags: string[];
}

/**
 * Persist one verified service experience into Hindsight.
 * Idempotent: documentId = service-job:<jobId>, so re-retaining the same job REPLACES its
 * facts (per Hindsight document semantics) instead of duplicating them.
 * Throws HindsightUnavailableError on any failure; callers must keep the DB job saved and
 * mark the experience 'failed' so it can be retried.
 */
export async function storeServiceExperience(
  exp: ServiceExperience,
  opts: { bankId?: string; signal?: AbortSignal } = {}
): Promise<StoreResult> {
  const bankId = await ensureBank(opts.bankId, opts.signal);
  const documentId = experienceDocumentId(exp.jobId);
  const tags = experienceTags(exp);
  try {
    await getHindsightClient().retain(bankId, buildExperienceNarrative(exp), {
      timestamp: exp.completedAt,
      context: EXPERIENCE_CONTEXT,
      documentId,
      tags,
      metadata: {
        asset_code: exp.assetCode,
        job_id: exp.jobId,
        outcome: exp.outcome,
        intervention: exp.extraction.intervention_category,
        before: String(exp.beforeMeasurement ?? ""),
        after: String(exp.afterMeasurement ?? ""),
        unit: exp.measurementUnit,
      },
      signal: withTimeout(RETAIN_TIMEOUT_MS, opts.signal),
    });
  } catch (e) {
    throw toUnavailable("retain", e);
  }
  return { bankId, documentId, tags };
}

// ---------------------------------------------------------------- recall
export interface MemoryItem {
  id: string;
  text: string;
  /** Hindsight fact type (e.g. world / experience / observation), when reported. */
  type: string | null;
  /** ISO date the remembered event occurred, when Hindsight extracted one. */
  occurredAt: string | null;
  documentId: string | null;
  tags: string[];
}

export type RecallOutcome =
  | { available: true; items: MemoryItem[] }
  | { available: false; reason: string; items: [] };

/**
 * Recall what the organization has learned about an asset. Never throws: if Hindsight is
 * unreachable the caller gets `available: false` and must NOT fabricate a recommendation.
 */
export async function recallAssetExperience(
  assetCode: string,
  problem: string,
  opts: { bankId?: string; signal?: AbortSignal; maxTokens?: number } = {}
): Promise<RecallOutcome> {
  try {
    const bankId = getBankId(opts.bankId);
    const res = await getHindsightClient().recall(
      bankId,
      `Service history of asset ${assetCode} for the problem "${problem}": which interventions were tried and what were the measured outcomes?`,
      {
        tags: [assetTag(assetCode)],
        tagsMatch: "any_strict",
        budget: "mid",
        maxTokens: opts.maxTokens ?? 4096,
        signal: withTimeout(RECALL_TIMEOUT_MS, opts.signal),
      }
    );
    const items: MemoryItem[] = res.results.map((r) => ({
      id: r.id,
      text: r.text,
      type: r.type ?? null,
      occurredAt: r.occurred_start ?? null,
      documentId: r.document_id ?? null,
      tags: r.tags ?? [],
    }));
    // Chronological order reads naturally as a history; undated items go last.
    items.sort((a, b) => (a.occurredAt ?? "9999").localeCompare(b.occurredAt ?? "9999"));
    return { available: true, items };
  } catch (e) {
    return { available: false, reason: toUnavailable("recall", e).message, items: [] };
  }
}

// --------------------------------------------------------------- context
export interface MemoryContext {
  text: string;
  evidenceCount: number;
  /** Items actually included, in the order they were numbered [E1]...[En]. */
  included: MemoryItem[];
}

/**
 * Format recalled memories as numbered evidence for the LLM. Pure function.
 * The recommendation prompt must cite these [E#] labels and may not go beyond them.
 */
export function buildMemoryContext(items: MemoryItem[], maxItems = 12): MemoryContext {
  const included = items.slice(0, maxItems);
  const text = included
    .map((it, i) => {
      const when = it.occurredAt ? it.occurredAt.slice(0, 10) : "date unknown";
      return `[E${i + 1}] (${when}) ${it.text.replace(/\s+/g, " ").trim()}`;
    })
    .join("\n");
  return { text, evidenceCount: included.length, included };
}

// ------------------------------------------------------- health / checks
export async function hasExperienceDocument(jobId: string, bankId?: string): Promise<boolean> {
  try {
    const doc = await getHindsightClient().getDocument(getBankId(bankId), experienceDocumentId(jobId), {
      signal: withTimeout(RECALL_TIMEOUT_MS),
    });
    return doc !== null;
  } catch (e) {
    throw toUnavailable("getDocument", e);
  }
}

export async function hindsightHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const v = await getHindsightClient().getVersion({ signal: withTimeout(RECALL_TIMEOUT_MS) });
    return { ok: true, detail: JSON.stringify(v) };
  } catch (e) {
    return { ok: false, detail: toUnavailable("getVersion", e).message };
  }
}
