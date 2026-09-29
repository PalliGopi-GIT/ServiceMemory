"use client";

import { useEffect, useState } from "react";
import type { ExperienceExtraction } from "@/lib/experience";

interface Props {
  requestId: string;
  assetCode: string;
  assetName: string;
  measurementName: string;
  measurementUnit: string;
  problemDescription: string;
}

interface Technician {
  id: string;
  name: string;
}

interface CompletionResult {
  job: { id: string; outcome: string; completed_at: string };
  experience: ExperienceExtraction | null;
  hindsight: {
    status: "stored" | "failed" | "skipped";
    documentId?: string;
    bankId?: string;
    tags?: string[];
    reason?: string;
  };
}

const OUTCOME_OPTS = [
  { value: "resolved", label: "✅ Resolved — Problem fully fixed", color: "var(--success)" },
  { value: "partial", label: "⚡ Partial — Improved but not fully resolved", color: "var(--warning)" },
  { value: "unresolved", label: "❌ Unresolved — Problem persists", color: "var(--danger)" },
];

export default function JobCompletionForm({
  requestId,
  assetCode,
  assetName,
  measurementName,
  measurementUnit,
  problemDescription,
}: Props) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [techId, setTechId] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [beforeMeasurement, setBeforeMeasurement] = useState("");
  const [afterMeasurement, setAfterMeasurement] = useState("");
  const [outcome, setOutcome] = useState<"resolved" | "partial" | "unresolved">("resolved");
  const [techNotes, setTechNotes] = useState("");

  const [phase, setPhase] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [result, setResult] = useState<CompletionResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setTechnicians(list);
        if (list.length === 1) setTechId(list[0].id);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase("submitting");
    setErrorMsg("");

    try {
      // Step 1: Create a job (if not already created)
      let currentJobId = jobId;
      if (!currentJobId) {
        const jobResp = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_request_id: requestId,
            technician_id: techId,
            problem_description: problemDescription,
            measurement_name: measurementName,
            measurement_unit: measurementUnit,
          }),
        });
        const jobData = await jobResp.json();
        if (!jobResp.ok) {
          setErrorMsg(jobData.error ?? "Failed to create job");
          setPhase("error");
          return;
        }
        currentJobId = jobData.id;
        setJobId(currentJobId);
      }

      // Step 2: Complete the job
      const completeResp = await fetch(`/api/jobs/${currentJobId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_performed: workPerformed.trim(),
          parts_used: partsUsed.trim() || null,
          before_measurement: beforeMeasurement ? parseFloat(beforeMeasurement) : null,
          after_measurement: afterMeasurement ? parseFloat(afterMeasurement) : null,
          outcome,
          technician_notes: techNotes.trim() || null,
          evidence_url: null,
        }),
      });

      const completeData = await completeResp.json();
      if (!completeResp.ok) {
        setErrorMsg(completeData.error ?? "Failed to complete job");
        setPhase("error");
        return;
      }

      setResult(completeData as CompletionResult);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setPhase("error");
    }
  }

  if (phase === "done" && result) {
    const hs = result.hindsight;
    return (
      <div className="animate-fade-in">
        <div className="card-elevated" style={{ marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <span style={{ fontSize: "1.5rem" }}>✅</span>
            <div>
              <h2 className="section-title">Job Completed</h2>
              <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                Outcome: <strong style={{ color: outcome === "resolved" ? "var(--success)" : outcome === "partial" ? "var(--warning)" : "var(--danger)" }}>{outcome.toUpperCase()}</strong>
              </p>
            </div>
          </div>

          {/* Learning loop pipeline */}
          <div style={{ display: "flex", gap: "0", alignItems: "center", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            {[
              { label: "PostgreSQL", done: true },
              { label: "LLM Extraction", done: result.experience !== null },
              { label: "Hindsight Retain", done: hs.status === "stored" },
            ].map(({ label, done }, i, arr) => (
              <div key={label} style={{ display: "flex", alignItems: "center" }}>
                <div className={`pipeline-node ${done ? "done" : "idle"}`}>
                  {done ? "✓" : "○"} <span>{label}</span>
                </div>
                {i < arr.length - 1 && <span className="pipeline-arrow">→</span>}
              </div>
            ))}
          </div>

          {result.experience && (
            <div style={{ marginBottom: "1rem" }}>
              <p className="label" style={{ marginBottom: "0.5rem" }}>Extracted Experience</p>
              <div className="evidence-block">
                <strong>Symptom:</strong> {result.experience.symptom}{"\n"}
                <strong>Intervention:</strong> {result.experience.intervention}{"\n"}
                <strong>Category:</strong> {result.experience.intervention_category}{"\n"}
                <strong>Lesson:</strong> {result.experience.lesson}
              </div>
            </div>
          )}

          <div className={`alert ${hs.status === "stored" ? "alert-success" : hs.status === "failed" ? "alert-warning" : "alert-info"}`}>
            <span>{hs.status === "stored" ? "🧠" : hs.status === "failed" ? "⚠️" : "ℹ️"}</span>
            <div>
              {hs.status === "stored" && (
                <>
                  <strong>Retained in Hindsight.</strong> This outcome will improve future recommendations for{" "}
                  {assetCode}. Document: <code style={{ fontSize: "0.8rem" }}>{hs.documentId}</code>
                </>
              )}
              {hs.status === "failed" && (
                <>
                  <strong>Hindsight retain failed</strong> (job is saved in PostgreSQL).{" "}
                  <span style={{ fontSize: "0.8125rem" }}>{hs.reason}</span>
                  <br />
                  <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    The experience is marked &apos;failed&apos; and can be retried.
                  </span>
                </>
              )}
              {hs.status === "skipped" && (
                <>Experience extraction skipped: {hs.reason}</>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <a href="/" className="btn btn-primary">Back to Dashboard</a>
          <a href="/requests/new" className="btn btn-secondary">New Request</a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div className="card-elevated">
        <h2 className="section-title" style={{ marginBottom: "1.25rem" }}>
          🔧 Complete Service Job
        </h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
          Record what was done. Your outcome is the source of truth — the LLM will extract a lesson
          and retain it in Hindsight to improve future recommendations.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="technician" className="form-label">Technician *</label>
            <select
              id="technician"
              className="form-select"
              value={techId}
              onChange={(e) => setTechId(e.target.value)}
              required
            >
              <option value="">Select technician…</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {technicians.length === 0 && (
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                No technicians found. Add users with role &apos;technician&apos; to the database.
              </p>
            )}
          </div>

          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="workPerformed" className="form-label">Work Performed *</label>
            <textarea
              id="workPerformed"
              className="form-textarea"
              value={workPerformed}
              onChange={(e) => setWorkPerformed(e.target.value)}
              placeholder="Describe exactly what was done…"
              required
              rows={3}
            />
          </div>

          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="partsUsed" className="form-label">Parts Used (optional)</label>
            <input
              id="partsUsed"
              type="text"
              className="form-input"
              value={partsUsed}
              onChange={(e) => setPartsUsed(e.target.value)}
              placeholder="e.g. Coupling insert, bearing 6205"
            />
          </div>

          <div className="form-group">
            <label htmlFor="before" className="form-label">
              {measurementName} Before ({measurementUnit})
            </label>
            <input
              id="before"
              type="number"
              step="any"
              className="form-input"
              value={beforeMeasurement}
              onChange={(e) => setBeforeMeasurement(e.target.value)}
              placeholder="e.g. 8.0"
            />
          </div>

          <div className="form-group">
            <label htmlFor="after" className="form-label">
              {measurementName} After ({measurementUnit})
            </label>
            <input
              id="after"
              type="number"
              step="any"
              className="form-input"
              value={afterMeasurement}
              onChange={(e) => setAfterMeasurement(e.target.value)}
              placeholder="e.g. 2.5"
            />
          </div>

          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Outcome * (Technician is the source of truth)</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.25rem" }}>
              {OUTCOME_OPTS.map((opt) => (
                <label
                  key={opt.value}
                  htmlFor={`outcome-${opt.value}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    border: `1px solid ${outcome === opt.value ? opt.color : "var(--border)"}`,
                    background: outcome === opt.value ? `${opt.color}18` : "transparent",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontSize: "0.875rem",
                    color: "var(--text-secondary)",
                  }}
                >
                  <input
                    id={`outcome-${opt.value}`}
                    type="radio"
                    name="outcome"
                    value={opt.value}
                    checked={outcome === opt.value}
                    onChange={() => setOutcome(opt.value as typeof outcome)}
                    style={{ accentColor: opt.color }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="techNotes" className="form-label">Technician Notes (optional)</label>
            <textarea
              id="techNotes"
              className="form-textarea"
              value={techNotes}
              onChange={(e) => setTechNotes(e.target.value)}
              placeholder="Any observations, root cause findings, or notes for future technicians…"
              rows={3}
            />
          </div>
        </div>
      </div>

      {phase === "error" && (
        <div className="alert alert-danger">
          <span>✖</span>
          <span>{errorMsg}</span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <button
          id="complete-job"
          type="submit"
          className="btn btn-success"
          disabled={phase === "submitting" || !techId || !workPerformed.trim()}
          style={{ padding: "0.75rem 2rem" }}
        >
          {phase === "submitting" ? (
            <>
              <span className="spinner" />
              Completing & retaining experience…
            </>
          ) : (
            "Complete Job & Retain to Memory"
          )}
        </button>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          This will extract a lesson and retain it in Hindsight for future recall.
        </p>
      </div>
    </form>
  );
}
