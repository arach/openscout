import {
  Activity,
  Crosshair,
  Home,
  Layers,
  MessagesSquare,
  Network,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useScout } from "../Provider.tsx";
import type { Route } from "../../lib/types.ts";

interface NavItem {
  view: Route["view"];
  label: string;
  icon: LucideIcon;
  target: Route;
}

const ITEMS: NavItem[] = [
  { view: "inbox", label: "Home", icon: Home, target: { view: "inbox" } },
  { view: "agents", label: "Agents", icon: Users, target: { view: "agents" } },
  { view: "fleet", label: "Fleet", icon: Layers, target: { view: "fleet" } },
  { view: "sessions", label: "Sessions", icon: MessagesSquare, target: { view: "sessions" } },
  { view: "activity", label: "Activity", icon: Activity, target: { view: "activity" } },
  { view: "mesh", label: "Mesh", icon: Network, target: { view: "mesh" } },
  { view: "ops", label: "Ops", icon: Crosshair, target: { view: "ops" } },
];

const FOOTER_ITEMS: NavItem[] = [
  { view: "settings", label: "Settings", icon: Settings, target: { view: "settings" } },
];

export function ScoutLeftPanel() {
  const { route, navigate } = useScout();

  return (
    <div className="flex flex-col h-full py-2">
      <nav className="flex flex-col">
        {ITEMS.map((item) => (
          <NavButton key={item.view} item={item} activeView={route.view} navigate={navigate} />
        ))}
      </nav>

      <div className="flex-1" />

      <nav className="flex flex-col">
        {FOOTER_ITEMS.map((item) => (
          <NavButton key={item.view} item={item} activeView={route.view} navigate={navigate} />
        ))}
      </nav>
    </div>
  );
}

function NavButton({
  item,
  activeView,
  navigate,
}: {
  item: NavItem;
  activeView: Route["view"];
  navigate: (r: Route) => void;
}) {
  const active = activeView === item.view;
  const Icon = item.icon;
  return (
    <button
      onClick={() => navigate(item.target)}
      className={`group w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors border-l-2 ${
        active
          ? "bg-cyan-500/5 border-l-cyan-400/40 text-white/80"
          : "border-l-transparent text-white/40 hover:bg-white/[0.02] hover:text-white/60"
      }`}
    >
      <Icon
        size={13}
        strokeWidth={1.5}
        className={active ? "text-cyan-400/70" : "text-white/30 group-hover:text-white/50"}
      />
      <span className="text-[12px]">{item.label}</span>
    </button>
  );
}
