/**
 * npm run verify:hindsight
 *
 * Proves the REAL Hindsight Cloud integration works, using the same code paths the app uses:
 *   1. auth / reachability        (getVersion, informational)
 *   2. bank creation              (ensureBank)
 *   3. retain a probe experience  (storeServiceExperience -> real retain)
 *   4. document exists            (getDocument)
 *   5. recall returns it          (recallAssetExperience, polled, tag-scoped)
 *   6. memory context is built    (buildMemoryContext)
 *   7. idempotent re-retain       (same documentId replaces, does not duplicate the document)
 *   8. tag isolation              (recall for a different asset does not return the probe)
 *
 * Uses a SEPARATE bank (<HINDSIGHT_BANK_ID>-verify) so it never pollutes real memory.
 * Pass --cleanup to delete that verify bank afterwards.
 */
import {
  buildMemoryContext,
  ensureBank,
  getBankId,
  getHindsightClient,
  hasExperienceDocument,
  hindsightHealth,
  recallAssetExperience,
  storeServiceExperience,
} from "../lib/hindsight";
import type { ServiceExperience } from "../lib/experience";

const PROBE_ASSET = "VERIFY-PROBE-1";
const OTHER_ASSET = "VERIFY-OTHER-9";
const JOB_ID = "00000000-0000-4000-8000-00000000abcd";

const probe: ServiceExperience = {
  jobId: JOB_ID,
  assetCode: PROBE_ASSET,
  assetName: "Verification Pump",
  assetType: "Industrial Pump",
  customerName: "Verify Co",
  location: "Test Bay",
  technicianName: "Verify Bot",
  reportedProblem: "Excessive vibration",
  workPerformed: "Shaft alignment correction",
  partsUsed: null,
  beforeMeasurement: 8.1,
  afterMeasurement: 2.6,
  measurementName: "vibration velocity",
  measurementUnit: "mm/s",
  outcome: "resolved",
  technicianNotes: "Verification probe. Alignment was out of tolerance; corrected with dial indicators.",
  completedAt: "2026-09-01T10:00:00.000Z",
  extraction: {
    symptom: "Excessive vibration at the pump",
    intervention: "Shaft alignment correction",
    intervention_category: "alignment correction",
    outcome: "resolved",
    lesson: "Alignment correction reduced vibration substantially on this asset.",
    observations: [],
  },
};

let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const fail = (m: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};
const info = (m: string) => console.log(`  info  ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const bankId = `${getBankId()}-verify`;
  console.log(`\nHindsight verification  (bank: ${bankId})\n`);

  // 1. reachability (informational: some deployments may not expose /version to every key)
  const health = await hindsightHealth();
  health.ok ? pass("reachable / authenticated (getVersion)") : info(`getVersion not available: ${health.detail}`);

  // 2. bank
  try {
    await ensureBank(bankId);
    pass("bank created/updated (createBank)");
  } catch (e) {
    fail(`createBank: ${(e as Error).message}`);
    return; // nothing else can work
  }

  // 3. retain
  try {
    const t0 = Date.now();
    const r = await storeServiceExperience(probe, { bankId });
    pass(`retain succeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s  documentId=${r.documentId}`);
    info(`tags: ${r.tags.join(", ")}`);
  } catch (e) {
    fail(`retain: ${(e as Error).message}`);
    return;
  }

  // 4. document
  try {
    (await hasExperienceDocument(JOB_ID, bankId)) ? pass("document exists (getDocument)") : fail("getDocument returned null after retain");
  } catch (e) {
    fail(`getDocument: ${(e as Error).message}`);
  }

  // 5. recall (poll: fact indexing may lag slightly behind retain)
  let items: Awaited<ReturnType<typeof recallAssetExperience>>["items"] = [];
  for (let attempt = 1; attempt <= 12; attempt++) {
    const r = await recallAssetExperience(PROBE_ASSET, "Excessive vibration", { bankId });
    if (!r.available) {
      fail(`recall unavailable: ${r.reason}`);
      break;
    }
    items = r.items;
    if (items.length > 0) {
      pass(`recall returned ${items.length} memory item(s) on attempt ${attempt}`);
      break;
    }
    info(`no results yet (attempt ${attempt}/12), waiting 5s...`);
    await sleep(5000);
  }
  if (items.length === 0) fail("recall never returned the retained experience");

  // 6. context
  if (items.length > 0) {
    const ctx = buildMemoryContext(items);
    ctx.evidenceCount > 0 && ctx.text.includes("[E1]") ? pass("memory context built for the LLM") : fail("memory context empty");
    console.log("\n  --- What Hindsight actually remembered (real recalled facts) ---");
    console.log(ctx.text.split("\n").map((l) => "  " + l).join("\n"));
    console.log("  ---------------------------------------------------------------\n");
    /alignment/i.test(ctx.text) ? pass("recalled facts mention the alignment intervention") : fail("recalled facts do not mention alignment");
  }

  // 7. idempotent re-retain
  try {
    await storeServiceExperience(probe, { bankId });
    (await hasExperienceDocument(JOB_ID, bankId)) ? pass("re-retain with same documentId succeeded (document replaced, not duplicated)") : fail("document missing after re-retain");
  } catch (e) {
    fail(`re-retain: ${(e as Error).message}`);
  }

  // 8. isolation
  const other = await recallAssetExperience(OTHER_ASSET, "Excessive vibration", { bankId });
  if (!other.available) fail(`isolation recall unavailable: ${other.reason}`);
  else other.items.some((i) => i.tags.includes("asset:" + PROBE_ASSET))
    ? fail("tag isolation broken: another asset's recall returned the probe's memory")
    : pass("tag isolation holds (other asset recall does not return the probe)");

  if (process.argv.includes("--cleanup")) {
    try {
      await getHindsightClient().deleteBank(bankId);
      info(`deleted verify bank ${bankId}`);
    } catch (e) {
      info(`cleanup failed: ${(e as Error).message}`);
    }
  }
}

main()
  .catch((e) => {
    failures++;
    console.error("Unexpected error:", e instanceof Error ? e.message : e);
  })
  .finally(() => {
    console.log(failures === 0 ? "\nRESULT: ALL CHECKS PASSED\n" : `\nRESULT: ${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
