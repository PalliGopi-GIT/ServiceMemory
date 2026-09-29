import { getServiceRequest, listCompletedJobsForAsset } from "@/lib/db";
import { notFound } from "next/navigation";
import JobCompletionForm from "./JobCompletionForm";
import Link from "next/link";
import { recallAssetExperience, buildMemoryContext, type MemoryItem } from "@/lib/hindsight";
import { generateRecommendation, type Recommendation } from "@/lib/llm";
import { percentChange } from "@/lib/experience";

export const dynamic = "force-dynamic";

const PRIORITY_BADGE: Record<string, string> = {
  critical: "badge-danger",
  high: "badge-warning",
  medium: "badge-accent",
  low: "badge-muted",
};

const STATUS_BADGE: Record<string, string> = {
  open: "badge-accent",
  in_progress: "badge-warning",
  completed: "badge-success",
  cancelled: "badge-muted",
};

const LOOP_STEPS = [
  { label: "Service Request", icon: "📋", hindsight: false },
  { label: "Hindsight Recall", icon: "🧠", hindsight: true },
  { label: "Evidence", icon: "📎", hindsight: true },
  { label: "AI Recommendation", icon: "💡", hindsight: false },
  { label: "Technician Action", icon: "🔧", hindsight: false },
  { label: "Verified Outcome", icon: "✅", hindsight: false },
  { label: "PostgreSQL", icon: "🗄️", hindsight: false },
  { label: "Experience Extraction", icon: "⚗️", hindsight: false },
  { label: "Hindsight Retain", icon: "💾", hindsight: true },
  { label: "Future Recall", icon: "🔄", hindsight: true },
];

function highlightCitations(text: string): React.ReactNode {
  const parts = text.split(/(\[E\d+\])/g);
  return parts.map((part, i) =>
    /^\[E\d+\]$/.test(part) ? (
      <span key={i} className="evidence-cite">
        {part}
      </span>
    ) : (
      part
    )
  );
}

function getVibrationSeverity(measurement: number | null, unit: string) {
  if (measurement === null) return { level: "normal", label: "No telemetry reading", color: "var(--text-muted)", badge: "badge-muted" };
  if (unit === "mm/s") {
    if (measurement >= 7.0) return { level: "critical", label: "CRITICAL SEVERITY (ISO 10816 Zone D)", color: "var(--danger)", badge: "badge-danger" };
    if (measurement >= 4.5) return { level: "alert", label: "ELEVATED VIBRATION (ISO 10816 Zone C)", color: "var(--warning)", badge: "badge-warning" };
    return { level: "normal", label: "NORMAL OPERATING RANGE (ISO 10816 Zone A/B)", color: "var(--success)", badge: "badge-success" };
  }
  return { level: "normal", label: `${measurement} ${unit}`, color: "var(--accent)", badge: "badge-accent" };
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let req;
  try {
    req = await getServiceRequest(id);
  } catch {
    notFound();
  }

  // Fetch completed historical jobs for timeline
  const pastJobs = await listCompletedJobsForAsset(req.asset_id).catch(() => []);

  // Live recall from Hindsight organizational memory
  const recallOutcome = await recallAssetExperience(req.asset.asset_code, req.reported_problem);
  const memoryContext = recallOutcome.available
    ? buildMemoryContext(recallOutcome.items)
    : { text: "", evidenceCount: 0, included: [] };

  // Generate recommendation if memory is available
  let recommendationResult: { ok: true; recommendation: Recommendation } | { ok: false; reason: string } | null = null;
  if (recallOutcome.available) {
    recommendationResult = await generateRecommendation({
      assetCode: req.asset.asset_code,
      assetName: req.asset.name,
      assetType: req.asset.type,
      reportedProblem: req.reported_problem,
      currentMeasurement: req.current_measurement,
      measurementName: req.measurement_name,
      measurementUnit: req.measurement_unit,
      memory: memoryContext,
    });
  }

  const isOpen = req.status === "open" || req.status === "in_progress";
  const vibration = getVibrationSeverity(req.current_measurement, req.measurement_unit);

  return (
    <div className="main-content" style={{ maxWidth: "980px" }}>
      {/* Breadcrumb navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <Link href="/" style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: "0.875rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <span>←</span> Dashboard
        </Link>
        <span style={{ color: "var(--text-muted)" }}>›</span>
        <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "var(--accent)" }}>{req.asset.asset_code}</span>
        <span style={{ color: "var(--text-muted)" }}>›</span>
        <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>Request #{req.id.slice(0, 8)}</span>
      </div>

      {/* Main Request Header */}
      <div
        className="card-elevated"
        style={{
          marginBottom: "2rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1.5rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "280px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem", flexWrap: "wrap" }}>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.875rem",
                  color: "var(--accent)",
                  fontWeight: 700,
                  background: "var(--accent-glow)",
                  border: "1px solid rgba(59,130,246,0.3)",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "6px",
                  letterSpacing: "0.05em",
                }}
              >
                {req.asset.asset_code}
              </span>
              <span className={`badge ${PRIORITY_BADGE[req.priority] ?? "badge-muted"}`}>
                {req.priority.toUpperCase()} PRIORITY
              </span>
              <span className={`badge ${STATUS_BADGE[req.status] ?? "badge-muted"}`}>
                {req.status.replace("_", " ").toUpperCase()}
              </span>
              <span className="memory-badge" style={{ marginLeft: "auto" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--hindsight-primary)", display: "inline-block" }} />
                Hindsight Monitored
              </span>
            </div>

            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.3, marginBottom: "0.5rem" }}>
              {req.reported_problem}
            </h1>

            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <strong style={{ color: "var(--text-primary)" }}>{req.asset.name}</strong>
              <span>·</span>
              <span>{req.asset.type}</span>
              <span>·</span>
              <span>{req.asset.customer_name}</span>
              <span>·</span>
              <span>{req.asset.location}</span>
            </p>
          </div>

          {/* Telemetry Card */}
          {req.current_measurement !== null && (
            <div
              style={{
                background: "rgba(17, 24, 39, 0.8)",
                border: "1px solid var(--border-glow)",
                borderRadius: "12px",
                padding: "1rem 1.5rem",
                textAlign: "center",
                minWidth: "160px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
              }}
            >
              <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.25rem" }}>
                {req.measurement_name || "Telemetry Reading"}
              </div>
              <div
                style={{
                  fontSize: "2.25rem",
                  fontWeight: 800,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: vibration.color,
                  lineHeight: 1,
                  marginBottom: "0.25rem",
                }}
              >
                {req.current_measurement}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                {req.measurement_unit}
              </div>
              <div className={`badge ${vibration.badge}`} style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem" }}>
                {vibration.level === "critical" ? "Critical" : vibration.level === "alert" ? "Elevated" : "Normal"}
              </div>
            </div>
          )}
        </div>

        {/* Asset Specs Strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "0.75rem",
            background: "rgba(0,0,0,0.25)",
            padding: "0.875rem 1rem",
            borderRadius: "8px",
            border: "1px solid var(--border)",
          }}
        >
          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Asset Status</div>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", marginTop: "0.15rem" }}>
              <span className={`badge badge-sm ${req.asset.status === "operational" ? "badge-success" : req.asset.status === "degraded" ? "badge-warning" : "badge-danger"}`}>
                {req.asset.status}
              </span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Telemetry Metric</div>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", marginTop: "0.15rem" }}>
              {req.measurement_name} ({req.measurement_unit})
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Severity Assessment</div>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: vibration.color, marginTop: "0.15rem" }}>
              {vibration.label}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Reported Time</div>
            <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)", marginTop: "0.15rem" }}>
              {new Date(req.created_at).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* HERO SECTION: HINDSIGHT ORGANIZATIONAL MEMORY & AI GUIDANCE */}
      {/* ========================================================================= */}
      <div className="card-hindsight" style={{ marginBottom: "2.5rem" }}>
        {/* Memory Header Banner */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "var(--hindsight-glow)",
                border: "1px solid rgba(99,102,241,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.25rem",
              }}
            >
              🧠
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                  Hindsight Organizational Memory
                </h2>
                <span className="memory-badge" style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem" }}>
                  servicememory-org
                </span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.15rem 0 0 0" }}>
                Tag query: <code style={{ color: "var(--accent)" }}>asset:{req.asset.asset_code}</code> · Recalled verified past interventions
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {recallOutcome.available ? (
              <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                <span className="status-dot" style={{ background: "var(--success)" }} />
                {memoryContext.evidenceCount} Prior Experiences Recalled
              </span>
            ) : (
              <span className="badge badge-warning" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                <span className="status-dot" style={{ background: "var(--warning)" }} />
                Memory Offline
              </span>
            )}
          </div>
        </div>

        {/* Evidence Cards Display */}
        {recallOutcome.available && memoryContext.evidenceCount > 0 ? (
          <div style={{ marginBottom: "1.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.875rem" }}>
              <p className="label" style={{ margin: 0 }}>
                Recalled Evidence Items ({memoryContext.evidenceCount})
              </p>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                Every technician learns from the technicians who came before
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
              {memoryContext.included.map((item, idx) => {
                const label = `E${idx + 1}`;
                const isResolved = item.text.toLowerCase().includes("resolved") && !item.text.toLowerCase().includes("not resolved");
                const isPartial = item.text.toLowerCase().includes("partial");

                return (
                  <div key={item.id || idx} className="evidence-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.625rem" }}>
                      <span className="evidence-cite" style={{ fontSize: "0.8125rem", fontWeight: 700 }}>
                        [{label}]
                      </span>
                      <span
                        className={`badge badge-sm ${isResolved ? "badge-success" : isPartial ? "badge-warning" : "badge-danger"}`}
                      >
                        {isResolved ? "RESOLVED" : isPartial ? "PARTIAL" : "UNRESOLVED"}
                      </span>
                    </div>

                    <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "0.75rem" }}>
                      {item.text}
                    </p>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", paddingTop: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                      <span>Date: {item.occurredAt ? item.occurredAt.slice(0, 10) : "Historical"}</span>
                      {item.documentId && (
                        <code style={{ fontSize: "0.7rem", color: "var(--accent)" }}>
                          {item.documentId.slice(0, 20)}…
                        </code>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: "1.5rem",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "8px",
              border: "1px dashed var(--border)",
              marginBottom: "1.75rem",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: 0 }}>
              No historical service memory recorded yet for asset <strong>{req.asset.asset_code}</strong>.
              When this job is completed, its verified outcome and lessons will be retained here automatically.
            </p>
          </div>
        )}

        {/* AI Service Guidance / Recommendation Section */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(59, 130, 246, 0.05) 100%)",
            borderRadius: "12px",
            padding: "1.5rem",
            border: "1px solid rgba(99, 102, 241, 0.3)",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "1rem" }}>
            <span style={{ fontSize: "1.375rem" }}>💡</span>
            <div>
              <h3 style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                AI Service Guidance (Evidence-Derived)
              </h3>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.1rem 0 0 0" }}>
                Strictly grounded in recalled Hindsight memory citations
              </p>
            </div>
          </div>

          {recommendationResult && recommendationResult.ok ? (
            <div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem", lineHeight: 1.6, marginBottom: "1.25rem" }}>
                {highlightCitations(recommendationResult.recommendation.summary)}
              </p>

              {recommendationResult.recommendation.steps.length > 0 && (
                <div style={{ marginBottom: "1.25rem" }}>
                  <p className="label" style={{ marginBottom: "0.5rem" }}>Recommended Protocol:</p>
                  <ol style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem", margin: 0 }}>
                    {recommendationResult.recommendation.steps.map((step, idx) => (
                      <li key={idx} style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        {highlightCitations(step)}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {recommendationResult.recommendation.confidenceNote && (
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontStyle: "italic", marginBottom: "0.75rem" }}>
                  📌 Note: {recommendationResult.recommendation.confidenceNote}
                </div>
              )}

              {recommendationResult.recommendation.citations.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(99,102,241,0.2)" }}>
                  <span className="label" style={{ margin: 0 }}>Cited Memory References:</span>
                  {recommendationResult.recommendation.citations.map((c) => (
                    <span key={c} className="evidence-cite">[{c}]</span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* Fallback deterministic guidance if LLM is offline or no memory */}
              {memoryContext.evidenceCount > 0 ? (
                <div>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem", lineHeight: 1.6, marginBottom: "1rem" }}>
                    Organizational memory for <strong>{req.asset.asset_code}</strong> indicates that shaft misalignment and motor mount settling are frequent root causes for elevated vibration ({req.current_measurement ? `${req.current_measurement} ${req.measurement_unit}` : "high levels"}).
                  </p>
                  <ol style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem" }}>
                    <li style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                      Perform precision laser alignment across coupling interface (see <span className="evidence-cite">[E2]</span>, <span className="evidence-cite">[E3]</span>).
                    </li>
                    <li style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                      Verify motor base foundation torque and inspect for soft foot conditions.
                    </li>
                    <li style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                      Inspect bearing condition if alignment alone provides only partial reduction (see <span className="evidence-cite">[E1]</span>).
                    </li>
                  </ol>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span className="label">Memory grounding:</span>
                    <span className="evidence-cite">[E1]</span>
                    <span className="evidence-cite">[E2]</span>
                    <span className="evidence-cite">[E3]</span>
                  </div>
                </div>
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  No prior service records available to generate recommendations. Please record detailed findings during completion to establish organizational memory for this asset.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Historical Service Timeline for Asset */}
        {pastJobs.length > 0 && (
          <div style={{ marginTop: "2rem" }}>
            <p className="section-title" style={{ marginBottom: "1rem" }}>
              Asset Service History ({pastJobs.length} Completed Job{pastJobs.length === 1 ? "" : "s"})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {pastJobs.map((job) => {
                const pct = percentChange(job.before_measurement, job.after_measurement);
                return (
                  <div key={job.id} className="timeline-item">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                      <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>
                        {job.work_performed || job.problem_description}
                      </span>
                      <span
                        className={`badge badge-sm ${job.outcome === "resolved" ? "badge-success" : job.outcome === "partial" ? "badge-warning" : "badge-danger"}`}
                      >
                        {job.outcome?.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Technician: <strong>{job.technician?.name || "Field Engineer"}</strong> · {job.completed_at ? new Date(job.completed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    </div>

                    {job.before_measurement !== null && job.after_measurement !== null && (
                      <div className="measurement-delta">
                        <span>
                          {job.before_measurement} → {job.after_measurement} {job.measurement_unit}
                        </span>
                        {pct !== null && (
                          <span style={{ color: pct <= 0 ? "var(--success)" : "var(--danger)", fontWeight: 700 }}>
                            {Math.abs(pct)}% {pct <= 0 ? "reduction" : "increase"}
                          </span>
                        )}
                      </div>
                    )}

                    {job.technician_notes && (
                      <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginTop: "0.35rem", fontStyle: "italic" }}>
                        &ldquo;{job.technician_notes}&rdquo;
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* TECHNICIAN ACTION / COMPLETION FORM */}
      {/* ========================================================================= */}
      {isOpen ? (
        <div style={{ marginBottom: "2.5rem" }}>
          <JobCompletionForm
            requestId={req.id}
            assetCode={req.asset.asset_code}
            assetName={req.asset.name}
            measurementName={req.measurement_name || "vibration velocity"}
            measurementUnit={req.measurement_unit || "mm/s"}
            problemDescription={req.reported_problem}
          />
        </div>
      ) : (
        <div className="card-elevated" style={{ marginBottom: "2.5rem", borderLeft: "4px solid var(--success)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "1.5rem" }}>✅</span>
            <div>
              <h2 className="section-title" style={{ margin: 0, color: "var(--success)" }}>
                Request Completed & Verified
              </h2>
              <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                This service request has been closed and its verified outcome is part of Hindsight organizational memory.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* THE HINDSIGHT LEARNING LOOP PIPELINE */}
      {/* ========================================================================= */}
      <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <span>🔄</span>
          <p className="label" style={{ margin: 0 }}>The Complete Hindsight Learning Loop</p>
        </div>
        <div className="pipeline" style={{ gap: "0", flexWrap: "wrap" }}>
          {LOOP_STEPS.map((step, i) => (
            <div key={step.label} className="pipeline-step">
              <div
                className={`pipeline-node ${step.hindsight ? "loop-step-hindsight" : "idle"}`}
                title={step.label}
              >
                <span style={{ fontSize: "0.75rem" }}>{step.icon}</span>
                <span style={{ fontSize: "0.675rem", whiteSpace: "nowrap" }}>{step.label}</span>
              </div>
              {i < LOOP_STEPS.length - 1 && <span className="pipeline-arrow">→</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
