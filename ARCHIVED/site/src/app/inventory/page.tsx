import type { Metadata } from "next";
import { PlanInventoryScreen } from "@/components/plan-inventory-screen";
import { loadPlanInventory } from "@/lib/plan-inventory";

export const metadata: Metadata = {
  title: "Plan Inventory — OpenScout",
  description: "Review recent agent plans from markdown files and branch into follow-up work.",
};

export default async function InventoryPage() {
  const plans = await loadPlanInventory();

  return <PlanInventoryScreen plans={plans} />;
}
