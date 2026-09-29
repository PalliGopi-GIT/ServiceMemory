import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleExperience } from "./fixtures";

// These tests stub the SDK *transport* to verify how lib/hindsight.ts calls it and how it
// degrades. They do NOT prove the live service works: `npm run verify:hindsight` does that.
const calls = { createBank: [] as unknown[][], retain: [] as unknown[][], recall: [] as unknown[][] };
let recallImpl: () => Promise<unknown>;
let retainImpl: () => Promise<unknown>;

vi.mock("@vectorize-io/hindsight-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vectorize-io/hindsight-client")>();
  class FakeClient {
    async createBank(...a: unknown[]) { calls.createBank.push(a); return {}; }
    async retain(...a: unknown[]) { calls.retain.push(a); return retainImpl(); }
    async recall(...a: unknown[]) { calls.recall.push(a); return recallImpl(); }
    async getDocument() { return { id: "x" }; }
    async getVersion() { return { version: "test" }; }
  }
  return { ...actual, HindsightClient: FakeClient };
});

import { HindsightError } from "@vectorize-io/hindsight-client";
import {
  assetTag, buildExperienceNarrative, buildMemoryContext, experienceDocumentId,
  experienceTags, recallAssetExperience, resetHindsightForTests, storeServiceExperience,
  HindsightUnavailableError,
} from "../lib/hindsight";

beforeEach(() => {
  process.env.HINDSIGHT_API_KEY = "hsk_test";
  process.env.HINDSIGHT_BANK_ID = "test-bank";
  calls.createBank.length = calls.retain.length = calls.recall.length = 0;
  retainImpl = async () => ({ success: true });
  recallImpl = async () => ({ results: [] });
  resetHindsightForTests();
});

describe("narrative + tags", () => {
  it("includes the technician's numbers, outcome, and a computed reduction", () => {
    const n = buildExperienceNarrative(sampleExperience);
    expect(n).toContain("8 mm/s");
    expect(n).toContain("2.7 mm/s");
    expect(n).toContain("66% reduction");
    expect(n).toContain("RESOLVED");
    expect(n).not.toContain("undefined");
  });
  it("normalizes the asset tag identically for retain and recall", () => {
    expect(assetTag(" p-204 ")).toBe("asset:P-204");
    expect(experienceTags(sampleExperience)).toContain("asset:P-204");
    expect(experienceTags(sampleExperience)).toContain("intervention:alignment-correction");
  });
});

describe("storeServiceExperience", () => {
  it("retains with idempotent documentId, timestamp, context and tags; ensures bank once", async () => {
    await storeServiceExperience(sampleExperience);
    await storeServiceExperience(sampleExperience);
    expect(calls.createBank).toHaveLength(1);
    const [bank, content, opts] = calls.retain[0] as [string, string, Record<string, unknown>];
    expect(bank).toBe("test-bank");
    expect(content).toContain("Alignment corrected");
    expect(opts.documentId).toBe(experienceDocumentId(sampleExperience.jobId));
    expect(opts.timestamp).toBe(sampleExperience.completedAt);
    expect(opts.context).toBe("field service outcome");
    expect(opts.tags).toContain("asset:P-204");
  });
  it("throws HindsightUnavailableError when Hindsight fails (caller keeps the DB job)", async () => {
    retainImpl = async () => { throw new HindsightError("boom", 503); };
    await expect(storeServiceExperience(sampleExperience)).rejects.toBeInstanceOf(HindsightUnavailableError);
  });
});

describe("recallAssetExperience", () => {
  it("filters by the asset tag and returns items in chronological order", async () => {
    recallImpl = async () => ({
      results: [
        { id: "2", text: "later", occurred_start: "2026-09-21T00:00:00Z", tags: ["asset:P-204"] },
        { id: "1", text: "earlier", occurred_start: "2026-09-05T00:00:00Z", document_id: "d1" },
        { id: "3", text: "undated" },
      ],
    });
    const r = await recallAssetExperience("p-204", "vibration");
    expect(r.available).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    const [, , opts] = calls.recall[0] as [string, string, Record<string, unknown>];
    expect(opts.tags).toEqual(["asset:P-204"]);
    expect(opts.tagsMatch).toBe("any_strict");
  });
  it("degrades to available:false (never throws, never fabricates) when Hindsight is down", async () => {
    recallImpl = async () => { throw new HindsightError("down", 503); };
    const r = await recallAssetExperience("P-204", "vibration");
    expect(r.available).toBe(false);
    expect(r.items).toEqual([]);
  });
});

describe("buildMemoryContext", () => {
  it("numbers evidence [E1].. so the LLM can cite it", () => {
    const ctx = buildMemoryContext([
      { id: "1", text: "Bearing replaced.  8.2 to 5.4", type: null, occurredAt: "2026-09-05T00:00:00Z", documentId: null, tags: [] },
      { id: "2", text: "Alignment corrected", type: null, occurredAt: null, documentId: null, tags: [] },
    ]);
    expect(ctx.evidenceCount).toBe(2);
    expect(ctx.text).toContain("[E1] (2026-09-05) Bearing replaced. 8.2 to 5.4");
    expect(ctx.text).toContain("[E2] (date unknown)");
  });
  it("is empty when there is no memory", () => {
    expect(buildMemoryContext([]).evidenceCount).toBe(0);
  });
});
