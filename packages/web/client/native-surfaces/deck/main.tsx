import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NativeAgentLanes } from "../lanes/NativeAgentLanes.tsx";
import { NativeSurfaceApp } from "../shared/NativeSurfaceApp.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <NativeSurfaceApp
      // Deck uses the Lanes wire contract and canonical renderer; only its
      // native shell and default presentation differ.
      surface="lanes"
      variant="deck"
      title="Deck"
      renderContent={({ bootstrap, client }) => (
        <NativeAgentLanes bootstrap={bootstrap} client={client} defaultLayout="grid" />
      )}
    />
  </StrictMode>,
);
