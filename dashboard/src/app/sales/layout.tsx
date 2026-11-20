import type { Metadata, Viewport } from "next";

// Its own name, icon and manifest, so "Add to Home Screen" gives reps a "Diag Sales"
// app that opens straight on /sales instead of a "Fleet Auto-Assign Dashboard" link.
export const metadata: Metadata = {
  title: "Diag Sales",
  manifest: "/sales.webmanifest",
  appleWebApp: { capable: true, title: "Diag Sales", statusBarStyle: "default" },
  icons: { apple: "/sales-icon-180.png", icon: "/sales-icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#2563eb" };

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
