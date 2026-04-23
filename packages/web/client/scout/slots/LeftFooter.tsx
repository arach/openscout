import { SettingsLauncher } from "../../screens/SettingsDrawer.tsx";
import { useScout } from "../Provider.tsx";

export function ScoutLeftFooter() {
  const { openSettings } = useScout();

  return (
    <SettingsLauncher onOpen={openSettings} />
  );
}
