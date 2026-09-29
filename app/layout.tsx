import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ServiceMemory — AI-Powered Field Service",
  description:
    "Every technician learns from the technicians who came before. Evidence-based recommendations from organizational memory.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page-shell">
          {/* Top navigation */}
          <header
            className="glass sticky top-0 z-50"
            style={{
              borderBottom: "1px solid var(--border)",
              padding: "0 1.5rem",
              height: "3.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <a href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                  <path d="M12 5a3 3 0 0 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                  <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
                  <path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>
                  <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
                  <path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>
                  <path d="M19.938 10.5a4 4 0 0 1 .585.396"/>
                  <path d="M6 18a4 4 0 0 1-1.967-.516"/>
                  <path d="M19.967 17.484A4 4 0 0 1 18 18"/>
                </svg>
                <span style={{ fontWeight: 700, fontSize: "1rem", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
                  ServiceMemory
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{ height: "1px", width: "20px", background: "var(--border)" }} />
                <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)", fontStyle: "italic", letterSpacing: "0.03em" }}>
                  Every technician learns from the technicians who came before
                </span>
              </div>
            </a>

            <nav style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <a href="/" className="btn btn-secondary btn-sm" style={{ fontWeight: 500, fontSize: "0.8125rem" }}>
                Dashboard
              </a>
              <a href="/requests/new" className="btn btn-primary btn-sm" style={{ fontSize: "0.8125rem" }}>
                + New Request
              </a>
            </nav>
          </header>

          <div style={{ position: "absolute", top: "4rem", right: "2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--success)", boxShadow: "0 0 12px var(--success-glow)" }} />
            <span className="memory-online">Memory Online</span>
          </div>

          <main style={{ flex: 1, position: "relative" }}>
            {children}
          </main>

          <footer style={{ borderTop: "1px solid var(--border)", padding: "1rem 1.5rem", textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
              <span>ServiceMemory ·</span>
              <span style={{ color: "var(--accent)" }}>●</span>
              <span>HackWith Hyderabad 3.0</span>
              <span style={{ color: "var(--accent)" }}>●</span>
              <span>AI Agents That Learn Using Hindsight</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}