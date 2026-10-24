// Catches a crash while rendering a page so the user sees what went wrong
// (and can reload or go home) instead of a blank white screen. Mounted around
// the routes inside AppLayout and keyed by the URL, so moving to another page
// starts fresh.

import React from "react";
import { AlertTriangle, RotateCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State {
  error: Error | null;
}

export class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Page crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg py-10 px-4 text-center space-y-4" data-testid="page-error">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
        <div>
          <h2 className="text-lg font-semibold">This page couldn't be shown</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Something went wrong while opening it. Reload to try again. If it keeps happening, send this message to support:
          </p>
        </div>
        <pre className="text-left text-xs bg-muted rounded-md p-3 whitespace-pre-wrap break-words max-h-40 overflow-auto">
          {error.name}: {error.message}
        </pre>
        <div className="flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RotateCw className="w-4 h-4 mr-2" /> Reload
          </Button>
          <Button variant="outline" onClick={() => { window.location.href = import.meta.env.BASE_URL || "/"; }}>
            <Home className="w-4 h-4 mr-2" /> Dashboard
          </Button>
        </div>
      </div>
    );
  }
}
