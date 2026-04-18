"use client";

import { Component, type ReactNode } from "react";
import { Button } from "../ui/button";

interface State {
  err: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err);
  }

  reset = () => this.setState({ err: null });

  render() {
    if (this.state.err) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-surface-0">
          <div className="max-w-lg w-full bg-surface-1 border border-border-default rounded-md p-5 space-y-3">
            <div className="text-lg font-semibold text-danger-fg">
              Something broke on the client
            </div>
            <pre className="text-xs font-mono bg-surface-4 p-2 rounded overflow-auto max-h-64 text-fg-secondary">
              {this.state.err.stack ?? this.state.err.message}
            </pre>
            <div className="flex gap-2">
              <Button variant="primary" onClick={this.reset}>
                Reset
              </Button>
              <Button onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
