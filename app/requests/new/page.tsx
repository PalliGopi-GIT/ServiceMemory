"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetRow } from "@/lib/types";
import type { Recommendation } from "@/lib/llm";

type Phase =
  | "idle"
  | "recalling"
  | "recommending"
  | "saving"
  | "done"
  | "error";

interface ApiResult {
  request: { id: string };
  asset: AssetRow;
  memory: { available: boolean; evidenceCount: number; reason?: string };
  recommendation: { ok: boolean; recommendation?: Recommendation; reason?: string } | null;
}

const PRIORITY_OPTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export default function NewRequestPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);

  const [assetCode, setAssetCode] = useState("");
  const [problem, setProblem] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [measurement, setMeasurement] = useState("");
  const [measName, setMeasName] = useState("vibration velocity");
  const [measUnit, setMeasUnit] = useState("mm/s");

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const selectedAsset = assets.find((a) => a.asset_code === assetCode);

  useEffect(() => {
    fetch("/api/assets")
      .then((r) => r.json())
      .then((data) => {
        setAssets(Array.isArray(data) ? data : []);
        setLoadingAssets(false);
      })
      .catch(() => setLoadingAssets(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assetCode || !problem.trim()) return;

    setPhase("recalling");
    setResult(null);
    setErrorMsg("");

    try {
      setPhase("recommending");
      const body = {
        asset_code: assetCode,
        reported_problem: problem.trim(),
        priority,
        current_measurement: measurement ? parseFloat(measurement) : null,
        measurement_name: measName,
        measurement_unit: measUnit,
      };

      setPhase("saving");
      const resp = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(data.error ?? "Failed to create request");
        setPhase("error");
        return;
      }

      setResult(data as ApiResult);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setPhase("error");
    }
  }

  const isSubmitting = phase === "recalling" || phase === "recommending" || phase === "saving";

  const phaseLabel: Record<Phase, string> = {
    idle: "",
    recalling: "Recalling organizational memory…",
    recommending: "Generating evidence-based recommendation…",
    saving: "Saving request…",
    done: "",
    error: "",
  };

  function renderRecommendation(rec: ApiResult) {
    if (!rec.recommendation) {
      return (
        <div className="alert alert-warning" style={{ marginTop: "1.25rem" }}>
          <span>⚠️</span>
          <span>
            Hindsight was unavailable during request creation.{" "}
            {rec.memory.reason && <em>{rec.memory.reason}</em>}
            {" "}No recommendation could be generated. The request was saved.
          </span>
        </div>
      );
    }
    if (!rec.recommendation.ok) {
      return (
        <div className="alert alert-warning" style={{ marginTop: "1.25rem" }}>
          <span>⚠️</span>
          <span>Recommendation could not be generated: {rec.recommendation.reason}</span>
        </div>
      );
    }

    const r = rec.recommendation.recommendation!;
    const noMemory = rec.memory.evidenceCount === 0;

    return (
      <div className="recommendation-box animate-fade-in" style={{ marginTop: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <span style={{ fontSize: "1.25rem" }}>💡</span>
          <h3 className="section-title" style={{ margin: 0 }}>
            Evidence-Based Recommendation
          </h3>
          <span
            className={`badge ${noMemory ? "badge-warning" : r.limitedEvidence ? "badge-warning" : "badge-success"}`}
            style={{ marginLeft: "auto" }}
          >
            {noMemory ? "No Prior Memory" : r.limitedEvidence ? "Limited Evidence" : `${rec.memory.evidenceCount} Evidence Items`}
          </span>
        </div>

        {noMemory && (
          <div className="alert alert-info" style={{ marginBottom: "1rem" }}>
            <span>🔍</span>
            <span>
              This asset has no prior service records in organizational memory. The recommendation
              below is based on general field-service knowledge only.
            </span>
          </div>
        )}

        <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem", lineHeight: 1.6, marginBottom: "1.25rem" }}>
          {highlightCitations(r.summary)}
        </p>

        {r.steps.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <p className="label" style={{ marginBottom: "0.5rem" }}>Recommended Steps</p>
            <ol style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {r.steps.map((step, i) => (
                <li key={i} style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {highlightCitations(step)}
                </li>
              ))}
            </ol>
          </div>
        )}

        {r.confidenceNote && (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontStyle: "italic" }}>
            {r.confidenceNote}
          </p>
        )}

        {r.citations.length > 0 && (
          <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.375rem", flexWrap: "wrap", alignItems: "center" }}>
            <span className="label">Cited evidence:</span>
            {r.citations.map((c) => (
              <span key={c} className="evidence-cite">[{c}]</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="main-content" style={{ maxWidth: "780px" }}>
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <a href="/" style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: "0.875rem" }}>
            Dashboard
          </a>
          <span style={{ color: "var(--text-muted)" }}>›</span>
          <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>New Request</span>
        </div>
        <h1 className="page-title">New Service Request</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem", marginTop: "0.375rem" }}>
          Submit a service request. ServiceMemory will recall what the organization has learned about
          this asset and generate an evidence-based recommendation before saving.
        </p>
      </div>

      {/* Pipeline visualization */}
      <div className="card" style={{ marginBottom: "1.75rem", padding: "1rem 1.25rem" }}>
        <div className="pipeline">
          {[
            { label: "Request", phase: "idle" as Phase },
            { label: "Hindsight Recall", phase: "recalling" as Phase },
            { label: "Recommendation", phase: "recommending" as Phase },
            { label: "Save", phase: "saving" as Phase },
          ].map(({ label, phase: p }, i, arr) => (
            <div key={label} className="pipeline-step">
              <div
                className={`pipeline-node ${
                  phase === "done" ? "done" :
                  phase === p ? "active" :
                  ["recalling","recommending","saving","done"].indexOf(phase) > ["recalling","recommending","saving","done"].indexOf(p) ? "done" :
                  "idle"
                }`}
              >
                {(phase === "done" || ["recalling","recommending","saving","done"].indexOf(phase) > ["recalling","recommending","saving","done"].indexOf(p)) ? "✓" : (i + 1)}
                <span>{label}</span>
              </div>
              {i < arr.length - 1 && <span className="pipeline-arrow">→</span>}
            </div>
          ))}
        </div>
        {isSubmitting && (
          <p style={{ fontSize: "0.8125rem", color: "var(--accent)", marginTop: "0.625rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="spinner" />
            {phaseLabel[phase]}
          </p>
        )}
      </div>

      {phase !== "done" ? (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="card-elevated">
            <h2 className="section-title" style={{ marginBottom: "1.25rem" }}>Asset & Problem</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="asset" className="form-label">Asset *</label>
                <select
                  id="asset"
                  className="form-select"
                  value={assetCode}
                  onChange={(e) => setAssetCode(e.target.value)}
                  required
                  disabled={loadingAssets}
                >
                  <option value="">
                    {loadingAssets ? "Loading assets…" : "Select an asset…"}
                  </option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.asset_code}>
                      {a.asset_code} — {a.name} ({a.customer_name})
                    </option>
                  ))}
                </select>
                {selectedAsset && (
                  <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    {selectedAsset.type} · {selectedAsset.location} ·{" "}
                    <span
                      className={`badge badge-sm ${selectedAsset.status === "operational" ? "badge-success" : selectedAsset.status === "degraded" ? "badge-warning" : "badge-danger"}`}
                    >
                      {selectedAsset.status}
                    </span>
                  </p>
                )}
              </div>

              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="problem" className="form-label">Reported Problem *</label>
                <textarea
                  id="problem"
                  className="form-textarea"
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  placeholder="Describe the symptom or fault observed…"
                  required
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label htmlFor="priority" className="form-label">Priority</label>
                <select
                  id="priority"
                  className="form-select"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                >
                  {PRIORITY_OPTS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="measurement" className="form-label">Current Measurement (optional)</label>
                <input
                  id="measurement"
                  type="number"
                  step="any"
                  className="form-input"
                  value={measurement}
                  onChange={(e) => setMeasurement(e.target.value)}
                  placeholder="e.g. 8.3"
                />
              </div>

              <div className="form-group">
                <label htmlFor="measName" className="form-label">Measurement Name</label>
                <input
                  id="measName"
                  type="text"
                  className="form-input"
                  value={measName}
                  onChange={(e) => setMeasName(e.target.value)}
                  placeholder="vibration velocity"
                />
              </div>

              <div className="form-group">
                <label htmlFor="measUnit" className="form-label">Unit</label>
                <input
                  id="measUnit"
                  type="text"
                  className="form-input"
                  value={measUnit}
                  onChange={(e) => setMeasUnit(e.target.value)}
                  placeholder="mm/s"
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

          <button
            id="submit-request"
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting || !assetCode || !problem.trim()}
            style={{ alignSelf: "flex-start", padding: "0.75rem 2rem" }}
          >
            {isSubmitting ? (
              <>
                <span className="spinner" />
                Processing…
              </>
            ) : (
              "Submit & Recall Memory"
            )}
          </button>
        </form>
      ) : (
        result && (
          <div className="animate-fade-in">
            <div className="alert alert-success" style={{ marginBottom: "1.25rem" }}>
              <span>✓</span>
              <span>
                Request created for <strong>{result.asset.asset_code}</strong> — {result.asset.name}.
                Memory available: {result.memory.available ? `Yes (${result.memory.evidenceCount} item${result.memory.evidenceCount !== 1 ? "s" : ""})` : "No"}.
              </span>
            </div>

            {renderRecommendation(result)}

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.75rem" }}>
              <a href={`/requests/${result.request.id}`} className="btn btn-primary">
                View Request →
              </a>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setPhase("idle");
                  setResult(null);
                  setProblem("");
                  setMeasurement("");
                  setAssetCode("");
                }}
              >
                New Request
              </button>
              <a href="/" className="btn btn-secondary">
                Dashboard
              </a>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/** Replace [E1] [E2] etc with highlighted spans in JSX. */
function highlightCitations(text: string): React.ReactNode {
  const parts = text.split(/(\[E\d+\])/g);
  return parts.map((part, i) =>
    /^\[E\d+\]$/.test(part) ? (
      <span key={i} className="evidence-cite">{part}</span>
    ) : (
      part
    )
  );
}
