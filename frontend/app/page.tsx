/**
 * Scaffold placeholder. Agent D replaces this with the real shell:
 *   - Left sidebar: folder input + strata list
 *   - Top bar: stage switcher (scan / taste / batch)
 *   - Main pane: view slot for active stage
 */
export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-xl space-y-4 text-center">
        <h1 className="text-2xl font-semibold">agent-wire-docling</h1>
        <p className="text-fg-secondary">
          Pre-flight complete. Wave 1 replaces this scaffold with the real shell.
        </p>
        <p className="text-fg-muted text-sm">
          Backend: <code className="kbd">localhost:8000</code> ·
          <span className="ml-2">
            API proxy: <code className="kbd">/api/*</code>
          </span>
        </p>
      </div>
    </main>
  );
}
