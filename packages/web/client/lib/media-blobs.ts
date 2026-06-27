import { api } from "./api.ts";
import {
  isRoutableCaptureMediaType,
  isMarkdownFileName,
  isCodeFileName,
  isTextCaptureFileName,
  resolvedCaptureUploadMediaType,
} from "./capture-attachments.ts";

export type OutgoingAttachment = {
  mediaType: string;
  fileName?: string;
  url: string;
};

export type UploadedMediaBlob = {
  id: string;
  url: string;
  mediaType: string;
  fileName?: string;
  size: number;
};

export {
  isMarkdownFileName,
  isCodeFileName,
  isTextCaptureFileName,
} from "./capture-attachments.ts";

export function isRoutableMediaType(mediaType: string, fileName?: string): boolean {
  return isRoutableCaptureMediaType(mediaType, fileName);
}

export function isRoutableMediaFile(file: Pick<File, "type" | "name">): boolean {
  return isRoutableCaptureMediaType(file.type, file.name);
}

export function resolvedUploadMediaType(file: Pick<File, "type" | "name">): string {
  return resolvedCaptureUploadMediaType(file);
}

export function readRoutableFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) return [];
  const files = [...dataTransfer.files].filter(isRoutableMediaFile);
  if (files.length > 0) return files;
  const fromItems: File[] = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isRoutableMediaFile(file)) fromItems.push(file);
  }
  return fromItems;
}

export function readClipboardMediaFiles(clipboard: DataTransfer | null | undefined): File[] {
  return readRoutableFiles(clipboard);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export async function uploadMediaFile(file: File): Promise<UploadedMediaBlob> {
  if (!isRoutableMediaFile(file)) {
    throw new Error("Only markdown, code, image, and video files can be routed.");
  }
  const data = await readFileAsBase64(file);
  return api<UploadedMediaBlob>("/api/blobs", {
    method: "POST",
    body: JSON.stringify({
      data,
      mediaType: resolvedUploadMediaType(file),
      fileName: file.name,
    }),
  });
}

export async function uploadMediaFiles(files: File[]): Promise<OutgoingAttachment[]> {
  const routable = files.filter(isRoutableMediaFile);
  if (routable.length === 0) {
    throw new Error("Drop markdown, code, an image, or a video clip to route.");
  }
  const uploaded = await Promise.all(routable.map((file) => uploadMediaFile(file)));
  return uploaded.map((blob, index) => ({
    mediaType: blob.mediaType,
    fileName: blob.fileName ?? routable[index]?.name,
    url: blob.url,
  }));
}

export function attachmentPreviewUrl(attachment: OutgoingAttachment): string {
  return attachment.url;
}