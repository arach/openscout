import { AudioRenderer } from "./AudioRenderer.tsx";
import { BinaryFallbackRenderer } from "./BinaryFallbackRenderer.tsx";
import { CodeRenderer } from "./CodeRenderer.tsx";
import { DirectoryRenderer } from "./DirectoryRenderer.tsx";
import { ImageRenderer } from "./ImageRenderer.tsx";
import { MarkdownRenderer } from "./MarkdownRenderer.tsx";
import { VideoRenderer } from "./VideoRenderer.tsx";

export {
  type FilePreviewContent,
  type FilePreviewEntry,
  type FileRenderer,
  type FileRendererContext,
} from "./types.ts";

export const fileRenderers = [
  DirectoryRenderer,
  MarkdownRenderer,
  CodeRenderer,
  ImageRenderer,
  VideoRenderer,
  AudioRenderer,
  BinaryFallbackRenderer,
];
