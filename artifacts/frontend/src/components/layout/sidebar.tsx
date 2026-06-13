import React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import { useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { topNavItems } from "@/lib/nav-items";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = true, onClose }: SidebarProps = {}) {
  const [location] = useLocation();
  const { user, hasRole } = useAuth();
  const logout = useLogout();
  const queryClient = useQueryClient();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        // Clear all cached query data so the stale "me" response
        // doesn't survive the navigation back to /login.
        queryClient.clear();
        window.location.href = "/login";
      }
    });
  };

  const visibleItems = topNavItems.filter(item => hasRole(item.roles as any));

  return (
    <div
      className={cn(
        "flex flex-col w-64 bg-sidebar border-r border-sidebar-border text-sidebar-foreground h-screen shrink-0 transition-transform duration-200 ease-out",
        // Mobile: off-canvas drawer
        "fixed inset-y-0 left-0 z-40 lg:sticky lg:top-0 lg:z-auto",
        isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        // When closed on desktop, hide via display (we toggle width through parent layout). Here just keep transform.
        !isOpen && "lg:hidden",
      )}
    >
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border shrink-0 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">
            V
          </div>
          <span className="font-bold text-lg tracking-tight">VIPRO ERP</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/80"
            aria-label="Close menu"
          >
            <span className="sr-only">Close</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-3">
          {visibleItems.map((item) => (
            <Link key={item.name} href={item.href} onClick={() => onClose && window.innerWidth < 1024 && onClose()}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium",
                  location === item.href || (location.startsWith(item.href) && item.href !== "/")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </div>
            </Link>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-sidebar-border shrink-0">
        <div className="flex items-center gap-3 mb-4 px-2">
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-medium">
            {user?.name?.charAt(0) || "U"}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-none">{user?.name}</span>
            <span className="text-xs text-sidebar-foreground/50 capitalize">{user?.role}</span>
          </div>
        </div>
        <button 
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </div>
  );
}
