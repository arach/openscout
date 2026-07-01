import { useCallback, useEffect, useRef, useState } from "react";
import { filterAgentsByMachineScope } from "../lib/machine-scope.ts";
import { isEditableTarget } from "../lib/keyboard-nav-core.ts";
import { readClipboardMediaFiles, readRoutableFiles } from "../lib/media-blobs.ts";
import { resolveCaptureRouteContext } from "../lib/media-route.ts";
import { routeMachineId } from "../lib/router.ts";
import { NewChatComposer } from "../screens/agents/NewChatComposer.tsx";
import type { ContextCaptureRequest } from "./Provider.tsx";
import { useScout } from "./Provider.tsx";
import "./context-capture.css";

export function ContextCaptureHost({
  request,
  onClose,
  onOpenCapture,
}: {
  request: ContextCaptureRequest | null;
  onClose: () => void;
  onOpenCapture: (request: ContextCaptureRequest) => void;
}) {
  const { agents, route, navigate } = useScout();
  const machineId = routeMachineId(route);
  const scopedAgents = filterAgentsByMachineScope(agents, machineId);
  const routeContext = resolveCaptureRouteContext(route, scopedAgents);
  const [dragDepth, setDragDepth] = useState(0);
  const dragDepthRef = useRef(0);

  const openCapture = useCallback((files: File[]) => {
    if (files.length === 0) return;
    onOpenCapture({
      files,
      agentId: routeContext.agentId ?? undefined,
      conversationId: routeContext.conversationId ?? undefined,
      preferExistingChat: routeContext.canUseExistingChat,
    });
  }, [onOpenCapture, routeContext]);

  const openQuickCapture = useCallback(() => {
    onOpenCapture({
      agentId: routeContext.agentId ?? undefined,
      conversationId: routeContext.conversationId ?? undefined,
      preferExistingChat: routeContext.canUseExistingChat,
    });
  }, [onOpenCapture, routeContext]);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!readRoutableFiles(event.dataTransfer).length) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragDepth(dragDepthRef.current);
    };
    const onDragOver = (event: DragEvent) => {
      if (!readRoutableFiles(event.dataTransfer).length) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = () => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      setDragDepth(dragDepthRef.current);
    };
    const onDrop = (event: DragEvent) => {
      const files = readRoutableFiles(event.dataTransfer);
      dragDepthRef.current = 0;
      setDragDepth(0);
      if (files.length === 0) return;
      event.preventDefault();
      openCapture(files);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const files = readClipboardMediaFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      openCapture(files);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (request || isEditableTarget(event.target)) return;
      const isCaptureShortcut =
        (event.metaKey || event.ctrlKey)
        && event.shiftKey
        && !event.altKey
        && event.key.toLowerCase() === "n";
      if (!isCaptureShortcut) return;
      event.preventDefault();
      openQuickCapture();
    };
    const onQuickCapture = () => {
      if (!request) openQuickCapture();
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scout:quick-capture", onQuickCapture);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scout:quick-capture", onQuickCapture);
    };
  }, [openCapture, openQuickCapture, request]);

  const dropActive = dragDepth > 0 && !request;

  return (
    <>
      {dropActive ? (
        <div className="s-capture-drop" role="presentation">
          <div className="s-capture-drop-card">
            <div className="s-capture-drop-title">Route capture</div>
            <div className="s-capture-drop-copy">
              Drop markdown, code, an image, or a video clip to send it to the right agent or chat.
            </div>
          </div>
        </div>
      ) : null}
      {request ? (
        <NewChatComposer
          agents={scopedAgents}
          route={route}
          navigate={navigate}
          onClose={onClose}
          initialAgentId={request.agentId}
          initialConversationId={request.conversationId}
          initialMessage={request.message}
          initialFiles={request.files}
          defaultMode={request.preferExistingChat ? "existing-chat" : undefined}
        />
      ) : null}
    </>
  );
}
