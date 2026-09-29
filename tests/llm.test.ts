import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LLM tests — OpenRouter implementation.
 *
 * Isolation strategy: vi.stubGlobal("fetch", mockFetch) before each test.
 * We never call the real OpenRouter API; all tests are offline.
 *
 * The public interface of generateRecommendation / extractExperience is unchanged.
 */

// ------------------------------------------------------------------ fetch mock

type FetchReturn = { ok: boolean; status: number; json: () => Promise<unknown> };
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

// ------------------------------------------------------------------ imports (after stubbing)

import { generateRecommendation, extractExperience, resetLlmForTests } from "../lib/llm";
import type { MemoryContext } from "../lib/hindsight";

// ------------------------------------------------------------------ helpers

function makeOpenRouterResponse(content: string, status = 200): FetchReturn {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    }),
  };
}

function makeErrorResponse(status: number, message: string): FetchReturn {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  };
}

// ------------------------------------------------------------------ fixtures

const emptyMemory: MemoryContext = { text: "", evidenceCount: 0, included: [] };

const twoItemMemory: MemoryContext = {
  text: "[E1] (2026-09-05) Alignment corrected on P-204, vibration 8.0→2.7 mm/s. RESOLVED.\n[E2] (2026-09-14) Bearing replaced, vibration reduced 6.5→4.1 mm/s. PARTIAL.",
  evidenceCount: 2,
  included: [],
};

const baseExtractionInput = {
  assetCode: "P-204",
  assetType: "Industrial Pump",
  reportedProblem: "Excessive vibration",
  workPerformed: "Alignment corrected",
  partsUsed: null,
  beforeMeasurement: 8.0,
  afterMeasurement: 2.7,
  measurementName: "vibration velocity",
  measurementUnit: "mm/s",
  outcome: "resolved" as const,
  technicianNotes: "Coupling was misaligned.",
};

// ------------------------------------------------------------------ setup

beforeEach(() => {
  // Provide the required env vars for getLlmEnv()
  process.env.OPENROUTER_API_KEY = "sk-or-test-key";
  process.env.OPENROUTER_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";
  delete process.env.OPENROUTER_BASE_URL;

  resetLlmForTests();
  mockFetch.mockReset();
});

// ================================================================== generateRecommendation

describe("generateRecommendation", () => {
  // ── Test 1: successful recommendation ────────────────────────────────────
  it("returns ok:true with a valid recommendation when OpenRouter responds correctly", async () => {
    const payload = {
      summary: "Based on [E1], alignment correction resolves vibration on P-204.",
      steps: ["Check coupling alignment", "Correct if needed", "Measure again"],
      citations: ["E1"],
      limitedEvidence: false,
      confidenceNote: "One strong precedent from [E1].",
    };
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(JSON.stringify(payload)) as unknown as Response
    );

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump 204",
      assetType: "Industrial Pump",
      reportedProblem: "Excessive vibration",
      memory: twoItemMemory,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("should be ok");
    expect(result.recommendation.summary).toContain("[E1]");
    expect(result.recommendation.steps).toHaveLength(3);
    expect(result.recommendation.citations).toEqual(["E1"]);
    expect(result.recommendation.limitedEvidence).toBe(false);
  });

  // ── Test 2: recommendation containing [E1] citations ─────────────────────
  it("exposes [E1] and [E2] citations when evidence is used", async () => {
    const payload = {
      summary:
        "According to [E1] and [E2], both alignment and bearing replacement have been tried on P-204.",
      steps: ["Check alignment first as per [E1]", "Inspect bearing if alignment is fine [E2]"],
      citations: ["E1", "E2"],
      limitedEvidence: false,
    };
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(JSON.stringify(payload)) as unknown as Response
    );

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump",
      assetType: "Pump",
      reportedProblem: "vibration",
      memory: twoItemMemory,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("should be ok");
    expect(result.recommendation.citations).toEqual(["E1", "E2"]);
    expect(result.recommendation.summary).toContain("[E1]");
    expect(result.recommendation.summary).toContain("[E2]");
  });

  // ── Test 3: provider HTTP failure ─────────────────────────────────────────
  it("returns ok:false on a 503 HTTP error from OpenRouter", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(503, "Service temporarily unavailable") as unknown as Response
    );

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump",
      assetType: "Pump",
      reportedProblem: "vibration",
      memory: emptyMemory,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("503");
  });

  // ── Test 4: provider timeout / network failure ────────────────────────────
  it("returns ok:false when fetch rejects (timeout / network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("API timeout"));

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump",
      assetType: "Pump",
      reportedProblem: "vibration",
      memory: emptyMemory,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("API timeout");
  });

  // ── Test 5: invalid JSON ──────────────────────────────────────────────────
  it("returns ok:false when LLM returns non-JSON prose", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse("Sorry, I cannot help with that.") as unknown as Response
    );

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump",
      assetType: "Pump",
      reportedProblem: "vibration",
      memory: emptyMemory,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("not valid JSON");
  });

  // ── Test 6: markdown-fenced JSON ─────────────────────────────────────────
  it("strips markdown code fences and parses the inner JSON correctly", async () => {
    const payload = {
      summary: "Based on [E1], alignment helps.",
      steps: ["Check coupling"],
      citations: ["E1"],
      limitedEvidence: false,
    };
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(
        "```json\n" + JSON.stringify(payload) + "\n```"
      ) as unknown as Response
    );

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump",
      assetType: "Pump",
      reportedProblem: "vibration",
      memory: twoItemMemory,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("should be ok");
    expect(result.recommendation.summary).toContain("[E1]");
  });

  // ── Test 7: Zod/schema failure ────────────────────────────────────────────
  it("returns ok:false when schema validation fails (missing required 'steps' field)", async () => {
    const broken = { summary: "This looks good but steps is missing" };
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(JSON.stringify(broken)) as unknown as Response
    );

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump",
      assetType: "Pump",
      reportedProblem: "vibration",
      memory: emptyMemory,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("validation");
  });

  // ── Extra: <think> reasoning-model tag stripping ─────────────────────────
  it("strips <think>…</think> reasoning blocks before parsing JSON", async () => {
    const payload = {
      summary: "Based on [E1], alignment is recommended.",
      steps: ["Inspect coupling"],
      citations: ["E1"],
      limitedEvidence: false,
    };
    const rawWithThink =
      "<think>Let me reason about this carefully…\nAlignment is typically the cause.</think>\n" +
      JSON.stringify(payload);
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(rawWithThink) as unknown as Response
    );

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump",
      assetType: "Pump",
      reportedProblem: "vibration",
      memory: twoItemMemory,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("should be ok");
    expect(result.recommendation.citations).toEqual(["E1"]);
  });

  // ── Extra: rate limit (429) ───────────────────────────────────────────────
  it("returns ok:false on a 429 rate-limit response", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(429, "Rate limit exceeded") as unknown as Response
    );

    const result = await generateRecommendation({
      assetCode: "P-204",
      assetName: "Feed Pump",
      assetType: "Pump",
      reportedProblem: "vibration",
      memory: emptyMemory,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("429");
  });
});

// ================================================================== extractExperience

describe("extractExperience", () => {
  // ── Test 8: extraction success ────────────────────────────────────────────
  it("returns ok:true with valid extraction when LLM responds correctly", async () => {
    const payload = {
      symptom: "Excessive vibration",
      intervention: "Alignment corrected using dial gauge",
      intervention_category: "alignment correction",
      outcome: "resolved",
      lesson: "Alignment correction resolves vibration on feed pumps.",
      observations: ["Coupling was misaligned by 0.5mm"],
    };
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(JSON.stringify(payload)) as unknown as Response
    );

    const result = await extractExperience(baseExtractionInput);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("should be ok");
    expect(result.extraction.outcome).toBe("resolved");
    expect(result.extraction.intervention_category).toBe("alignment correction");
    expect(result.extraction.observations).toEqual(["Coupling was misaligned by 0.5mm"]);
  });

  // ── Test 9: technician outcome contradiction rejection ────────────────────
  it("returns ok:false when extracted outcome contradicts the technician-confirmed outcome", async () => {
    const payload = {
      symptom: "Excessive vibration",
      intervention: "Alignment corrected",
      intervention_category: "alignment correction",
      outcome: "unresolved", // WRONG — technician confirmed "resolved"
      lesson: "Alignment did not help.",
      observations: [],
    };
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(JSON.stringify(payload)) as unknown as Response
    );

    const result = await extractExperience(baseExtractionInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("contradicts technician outcome");
  });

  // ── Test 10: missing/invalid required fields ──────────────────────────────
  it("returns ok:false when required fields are missing from the extraction", async () => {
    // Missing 'lesson', 'outcome', 'intervention_category'
    const incomplete = {
      symptom: "vibration",
      intervention: "alignment corrected",
    };
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(JSON.stringify(incomplete)) as unknown as Response
    );

    const result = await extractExperience(baseExtractionInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("validation");
  });

  // ── Extra: invalid JSON from provider ────────────────────────────────────
  it("returns ok:false when LLM returns non-JSON text", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse("not json at all") as unknown as Response
    );

    const result = await extractExperience(baseExtractionInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("not valid JSON");
  });

  // ── Extra: provider throws / rejects ─────────────────────────────────────
  it("returns ok:false when fetch rejects (rate limited)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("rate limited"));

    const result = await extractExperience(baseExtractionInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("rate limited");
  });

  // ── Extra: markdown-fenced JSON from extraction ───────────────────────────
  it("strips markdown fences from extraction response", async () => {
    const payload = {
      symptom: "Excessive vibration",
      intervention: "Alignment corrected",
      intervention_category: "alignment correction",
      outcome: "resolved",
      lesson: "Alignment correction is effective for vibration on industrial pumps.",
      observations: [],
    };
    mockFetch.mockResolvedValueOnce(
      makeOpenRouterResponse(
        "```json\n" + JSON.stringify(payload) + "\n```"
      ) as unknown as Response
    );

    const result = await extractExperience(baseExtractionInput);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("should be ok");
    expect(result.extraction.outcome).toBe("resolved");
  });

  // ── Extra: HTTP error during extraction ──────────────────────────────────
  it("returns ok:false on a 500 HTTP error during extraction", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(500, "Internal server error") as unknown as Response
    );

    const result = await extractExperience(baseExtractionInput);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should be error");
    expect(result.reason).toContain("500");
  });
});
