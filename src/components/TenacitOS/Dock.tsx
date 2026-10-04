"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  Home,
  FolderOpen,
  Brain,
  Building2,
  Clock,
  Puzzle,
  DollarSign,
  Settings,
  Calendar,
  Share2,
  Network,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";

const dockItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/social", label: "Social Media", icon: Share2 },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/memory", label: "Reports", icon: Brain },
  { href: "/memory-graph", label: "Memory Map", icon: Network },
  { href: "/office", label: "3D Office", icon: Building2 },
  { href: "/cron", label: "Cron Jobs", icon: Clock },
  { href: "/skills", label: "Skills", icon: Puzzle },
  { href: "/costs", label: "Cost Analysis", icon: DollarSign },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Mobile: show top 5 in tab bar, rest in "more" drawer
const mobileTabItems = dockItems.slice(0, 4);
const mobileMoreItems = dockItems.slice(4);

export function Dock() {
  const pathname = usePathname();
  const isOffice = pathname === "/office";
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Check if current path is in "more" items
  const isMoreActive = mobileMoreItems.some(
    (item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
  );

  if (isMobile) {
    return (
      <>
        {/* Bottom Tab Bar */}
        <nav
          className="dock-mobile"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            height: "64px",
            backgroundColor: isOffice ? "rgba(0, 0, 0, 0.85)" : "var(--surface)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderTop: isOffice
              ? "1px solid rgba(255, 255, 255, 0.08)"
              : "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-around",
            padding: "0 4px",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            zIndex: 50,
          }}
        >
          {mobileTabItems.map((item) => {
            const isActive =
              pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;
            const iconColor = isOffice
              ? isActive ? "#FFFFFF" : "rgba(255,255,255,0.5)"
              : isActive ? "var(--accent)" : "var(--text-secondary)";
            const labelColor = isOffice
              ? isActive ? "#FFFFFF" : "rgba(255,255,255,0.4)"
              : isActive ? "var(--accent)" : "var(--text-muted)";

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "2px",
                  minWidth: "56px",
                  minHeight: "44px",
                  padding: "4px 8px",
                  textDecoration: "none",
                  borderRadius: "8px",
                }}
              >
                <Icon style={{ width: "22px", height: "22px", color: iconColor, strokeWidth: isActive ? 2.5 : 2 }} />
                <span style={{ fontSize: "10px", fontWeight: isActive ? 600 : 500, color: labelColor }}>{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "2px",
              minWidth: "56px",
              minHeight: "44px",
              padding: "4px 8px",
              background: "none",
              border: "none",
              cursor: "pointer",
              borderRadius: "8px",
            }}
          >
            <Menu
              style={{
                width: "22px",
                height: "22px",
                color: isMoreActive
                  ? (isOffice ? "#FFFFFF" : "var(--accent)")
                  : (isOffice ? "rgba(255,255,255,0.5)" : "var(--text-secondary)"),
                strokeWidth: isMoreActive ? 2.5 : 2,
              }}
            />
            <span
              style={{
                fontSize: "10px",
                fontWeight: isMoreActive ? 600 : 500,
                color: isMoreActive
                  ? (isOffice ? "#FFFFFF" : "var(--accent)")
                  : (isOffice ? "rgba(255,255,255,0.4)" : "var(--text-muted)"),
              }}
            >
              More
            </span>
          </button>
        </nav>

        {/* Drawer overlay */}
        {drawerOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.6)",
              zIndex: 55,
            }}
            onClick={() => setDrawerOpen(false)}
          />
        )}

        {/* Drawer */}
        <div
          style={{
            position: "fixed",
            bottom: drawerOpen ? "64px" : "-100%",
            left: 0,
            right: 0,
            backgroundColor: "var(--surface)",
            borderTop: "1px solid var(--border)",
            borderRadius: "16px 16px 0 0",
            padding: "16px",
            paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
            zIndex: 56,
            transition: "bottom 0.3s ease",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>More</span>
            <button onClick={() => setDrawerOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: "8px" }}>
              <X style={{ width: "20px", height: "20px", color: "var(--text-secondary)" }} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            {mobileMoreItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "16px 8px",
                    borderRadius: "12px",
                    backgroundColor: isActive ? "var(--accent-soft)" : "var(--surface-elevated)",
                    textDecoration: "none",
                    minHeight: "44px",
                  }}
                >
                  <Icon style={{ width: "24px", height: "24px", color: isActive ? "var(--accent)" : "var(--text-secondary)" }} />
                  <span style={{ fontSize: "11px", fontWeight: isActive ? 600 : 500, color: isActive ? "var(--accent)" : "var(--text-secondary)" }}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  // Desktop: original sidebar dock
  return (
    <aside
      className="dock"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: "68px",
        backgroundColor: isOffice ? "rgba(0, 0, 0, 0.5)" : "var(--surface)",
        backdropFilter: isOffice ? "blur(20px)" : undefined,
        WebkitBackdropFilter: isOffice ? "blur(20px)" : undefined,
        borderRight: isOffice
          ? "1px solid rgba(255, 255, 255, 0.08)"
          : "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 6px",
        gap: "4px",
        zIndex: 50,
      }}
    >
      {dockItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        const Icon = item.icon;

        const iconColor = isOffice
          ? isActive ? "#FFFFFF" : "rgba(255,255,255,0.5)"
          : isActive ? "var(--accent)" : "var(--text-secondary)";

        const labelColor = isOffice
          ? isActive ? "#FFFFFF" : "rgba(255,255,255,0.4)"
          : isActive ? "var(--accent)" : "var(--text-muted)";

        const activeBg = isOffice
          ? "rgba(255, 255, 255, 0.1)"
          : "var(--accent-soft)";

        const hoverBg = isOffice
          ? "rgba(255, 255, 255, 0.1)"
          : "var(--surface-hover)";

        return (
          <Link
            key={item.href}
            href={item.href}
            className="dock-item group relative"
            style={{
              width: "56px",
              height: "56px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              borderRadius: "8px",
              backgroundColor: isActive ? activeBg : "transparent",
              transition: "all 150ms ease",
              position: "relative",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = hoverBg;
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
          >
            <Icon
              style={{
                width: "22px",
                height: "22px",
                color: iconColor,
                strokeWidth: isActive ? 2.5 : 2,
              }}
            />

            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "9px",
                fontWeight: isActive ? 600 : 500,
                color: labelColor,
                textAlign: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "52px",
              }}
            >
              {item.label.split(" ")[0]}
            </span>

            <span
              className="absolute left-[72px] top-1/2 -translate-y-1/2 px-3 py-2 rounded-lg text-sm whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
              style={{
                backgroundColor: "var(--surface-elevated)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 500,
              }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </aside>
  );
}
