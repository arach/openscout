import { type ReactNode } from "react";

export type FilePreviewEntry = {
  name: string;
  path: string;
  realPath: string;
  kind: "file" | "directory";
};

export type DirectoryFilePreviewContent = {
  kind: "directory";
  previewable: false;
  path: string;
  realPath: string;
  rootPath: string;
  title: string;
  mediaType: "inode/directory";
  entries: FilePreviewEntry[];
  generatedAt: number;
};

export type TextFilePreviewRange = {
  start: number;
  end: number;
};

export type TextFilePreviewContent = {
  kind: "file";
  previewable: true;
  path: string;
  realPath: string;
  rootPath: string;
  title: string;
  mediaType: string;
  rawUrl: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  generatedAt: number;
  /** Present when the payload represents a sliced range of the underlying file. */
  range?: TextFilePreviewRange;
  /** Total line count of the source file (only present alongside `range`). */
  totalLines?: number;
};

export type BinaryFilePreviewContent = {
  kind: "file";
  previewable: false;
  path: string;
  realPath: string;
  rootPath: string;
  title: string;
  mediaType: string;
  rawUrl: string;
  sizeBytes: number;
  previewReason: string;
  generatedAt: number;
};

export type FilePreviewContent =
  | DirectoryFilePreviewContent
  | TextFilePreviewContent
  | BinaryFilePreviewContent;

export type FileRendererContext = {
  openFilePreview: (path: string) => void;
  resource: FilePreviewContent;
};

export type FileRenderer = {
  id: string;
  canHandle: (resource: FilePreviewContent) => boolean;
  render: (ctx: FileRendererContext) => ReactNode;
};
