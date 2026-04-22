import { useScout } from "../Provider.tsx";
import { SettingsLauncher } from "../../screens/SettingsDrawer.tsx";

export function ScoutLeftFooter() {
  const { openSettings } = useScout();
  return <SettingsLauncher onOpen={openSettings} />;
}
