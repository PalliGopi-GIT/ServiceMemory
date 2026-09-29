import { listOpenRequests } from "@/lib/db";
import Link from "next/link";
import type { ServiceRequestWithAsset } from "@/lib/types";

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

function getVibrationLevel(measurement: number | null, unit: string): { level: "normal" | "alert" | "critical"; label: string } {
  if (measurement === null) return { level: "normal", label: "No reading" };
  if (unit === "mm/s") {
    if (measurement >= 7.0) return { level: "critical", label: `${measurement} mm/s — Critical` };
    if (measurement >= 4.5) return { level: "alert", label: `${measurement} mm/s — Elevated` };
    return { level: "normal", label: `${measurement} mm/s — Normal` };
  }
  return { level: "normal", label: `${measurement} ${unit}` };
}

async function getRequests(): Promise<ServiceRequestWithAsset[]> {
  try {
    return await listOpenRequests();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const requests = await getRequests();
  const openCount = requests.filter((r) => r.status === "open").length;
  const inProgressCount = requests.filter((r) => r.status === "in_progress").length;
  const criticalCount = requests.filter((r) => r.priority === "critical").length;

  return (
    <div className="main-content">
      {/* Hero section */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <span className="memory-badge">
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--hindsight-primary)", display: "inline-block" }} />
            Hindsight Active
          </span>
        </div>
        <h1 className="page-title" style={{ marginBottom: "0.5rem" }}>
          Service intelligence that remembers
        </h1>
        <p className="subheading" style={{ maxWidth: "600px" }}>
          Every technician learns from the technicians who came before.
          Hindsight recalls what the organization has already learned — so you never solve the same problem twice.
        </p>
      </div>

      {/* Learning loop visualization */}
      <div className="card-hindsight" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.875rem" }}>🧠</span>
          <p className="label" style={{ margin: 0 }}>The Hindsight Learning Loop</p>
        </div>
        <div className="pipeline" style={{ gap: "0" }}>
          {[
            { label: "Request", icon: "📋" },
            { label: "Hindsight Recall", icon: "🧠", hindsight: true },
            { label: "Evidence", icon: "📎" },
            { label: "AI Recommendation", icon: "💡" },
            { label: "Technician Action", icon: "🔧" },
            { label: "Verified Outcome", icon: "✅" },
            { label: "Experience Extract", icon: "⚗️" },
            { label: "Hindsight Retain", icon: "💾", hindsight: true },
            { label: "Future Recall", icon: "🔄", hindsight: true },
          ].map((step, i, arr) => (
            <div key={step.label} className="pipeline-step">
              <div className={`pipeline-node ${step.hindsight ? "loop-step-hindsight" : "idle"}`} title={step.label}>
                <span style={{ fontSize: "0.75rem" }}>{step.icon}</span>
                <span style={{ fontSize: "0.675rem", whiteSpace: "nowrap" }}>{step.label}</span>
              </div>
              {i < arr.length - 1 && <span className="pipeline-arrow">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div className="card-metric">
          <div className="metric-value" style={{ color: "var(--accent)" }}>{openCount}</div>
          <div className="metric-label">Open Requests</div>
        </div>
        <div className="card-metric">
          <div className="metric-value" style={{ color: "var(--warning)" }}>{inProgressCount}</div>
          <div className="metric-label">In Progress</div>
        </div>
        <div className="card-metric">
          <div className="metric-value" style={{ color: "var(--danger)" }}>{criticalCount}</div>
          <div className="metric-label">Critical Priority</div>
        </div>
        <div className="card-metric">
          <div className="metric-value" style={{ color: "var(--success)" }}>{requests.length}</div>
          <div className="metric-label">Total Active</div>
        </div>
        <div className="card-metric">
          <div className="metric-value" style={{ color: "var(--hindsight-primary)", fontSize: "1.5rem" }}>3</div>
          <div className="metric-label">Experiences Retained</div>
          <div className="metric-subtext">P-204 learning history</div>
        </div>
      </div>

      {/* Request list */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 className="section-title">Active Requests</h2>
        <Link href="/requests/new" className="btn btn-primary btn-sm">
          + New Request
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🧠</div>
          <p style={{ fontWeight: 500, color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
            No active service requests
          </p>
          <p style={{ fontSize: "0.875rem", marginBottom: "1.5rem" }}>
            Create a request to get evidence-based recommendations from organizational memory.
          </p>
          <Link href="/requests/new" className="btn btn-primary">
            Create First Request
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {requests.map((req) => {
            const vibration = getVibrationLevel(req.current_measurement, req.measurement_unit);
            return (
              <Link key={req.id} href={`/requests/${req.id}`} style={{ textDecoration: "none" }}>
                <div className="card" style={{ cursor: "pointer" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "1rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.375rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            color: "var(--accent)",
                            fontWeight: 600,
                            background: "var(--accent-glow)",
                            padding: "0.1rem 0.4rem",
                            borderRadius: "4px",
                          }}
                        >
                          {req.asset.asset_code}
                        </span>
                        <span className={`badge ${PRIORITY_BADGE[req.priority] ?? "badge-muted"}`}>
                          {req.priority}
                        </span>
                        <span className={`badge ${STATUS_BADGE[req.status] ?? "badge-muted"}`}>
                          {req.status.replace("_", " ")}
                        </span>
                      </div>
                      <p
                        style={{
                          fontWeight: 500,
                          fontSize: "0.9375rem",
                          color: "var(--text-primary)",
                          marginBottom: "0.25rem",
                        }}
                        className="truncate-2"
                      >
                        {req.reported_problem}
                      </p>
                      <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                        {req.asset.name} · {req.asset.customer_name} · {req.asset.location}
                      </p>
                    </div>

                    {/* Vibration telemetry */}
                    {req.current_measurement !== null && (
                      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ marginBottom: "0.25rem" }}>
                          <span style={{ fontWeight: 700, fontSize: "1.125rem", color: "var(--text-primary)", fontFamily: "'JetBrains Mono', monospace" }}>
                            {req.current_measurement}
                          </span>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "0.25rem" }}>
                            {req.measurement_unit}
                          </span>
                        </div>
                        <span className={`vibration-indicator ${vibration.level === "critical" ? "vibration-critical" : vibration.level === "alert" ? "vibration-alert" : "vibration-normal"}`}>
                          {vibration.level === "critical" && "🔴"}
                          {vibration.level === "alert" && "🟡"}
                          {vibration.level === "normal" && "🟢"}
                          {vibration.label}
                        </span>
                      </div>
                    )}

                    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {new Date(req.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}