import React, { useState, useEffect } from "react";
import { Sidebar } from "./sidebar";
import { CompanySwitcher } from "./company-switcher";
import { useAuth } from "@/contexts/use-auth";
import { Redirect, useLocation } from "wouter";
import { Menu, X } from "lucide-react";

interface AppLayoutProps {
  children: React.ReactNode;
}

function getInitialOpen() {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= 1024;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(getInitialOpen);
  const [location] = useLocation();

  // Close drawer on route change (mobile UX)
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [location]);

  if (isLoading) {
    return <div className="h-screen w-full flex items-center justify-center bg-background">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-primary/30 relative">
      {/* Sidebar: drawer on mobile, static on desktop when open */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar with sidebar toggle */}
        <header className="sticky top-0 z-20 h-12 flex items-center gap-2 px-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Hide menu" : "Show menu"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted transition-colors"
            data-testid="button-toggle-sidebar"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="font-semibold tracking-tight text-sm sm:text-base">VIPRO ERP</div>
          <div className="ml-auto flex items-center gap-3">
            <CompanySwitcher />
            <div className="text-xs text-muted-foreground hidden sm:block">
              {user?.name} · <span className="capitalize">{user?.role}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
