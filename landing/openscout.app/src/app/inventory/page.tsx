import type { Metadata } from "next";
import { PlanInventoryScreen } from "@/components/plan-inventory-screen";
import { loadPlanInventory } from "@/lib/plan-inventory";

export const metadata: Metadata = {
  title: "Plan Inventory — OpenScout",
  description: "Review recent agent plans from markdown files and branch into follow-up work.",
  openGraph: {
    title: "Plan Inventory — OpenScout",
    description: "Review recent agent plans and branch into follow-up work.",
    url: "https://openscout.app/inventory",
    images: [{ url: "/og-inventory.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-inventory.png"],
  },
};

export default async function InventoryPage() {
  const plans = await loadPlanInventory();

  return <PlanInventoryScreen plans={plans} />;
}
