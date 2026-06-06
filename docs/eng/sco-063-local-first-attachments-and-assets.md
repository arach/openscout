# SCO-063: Local-First Attachments And Asset Records

## Status

Proposed.

## Proposal ID

`sco-063`

## Intent

Define the first durable attachment model for Scout messages, asks, and local
agent context.

The goal is to let a user paste, drag, capture, dictate, or reference rich
content once, then have Scout preserve a local asset record and attach it to
messages by reference. The broker should not turn message bodies into blob
transport, and UI surfaces should not need to know how each harness wants image,
audio, document, or URL input encoded.

## Summary

Scout should promote attachments into a first-class local asset system:

```text
message or invocation
  -> attachment reference
  -> asset record
  -> local bytes, metadata, derivatives, and projection state
```

This is deliberately different from putting base64 in `MessageRecord.body`.
Base64 and provider file ids are adapter concerns. The Scout-owned record should
be a stable reference to an asset plus enough metadata for rendering, routing,
privacy, retention, and harness projection.

The immediate product slice should focus on local images and screenshots because
Talkie, Scout web, native Comms, and Pi/Grok all already want that path. The
model should still be general enough for audio clips, documents, logs, videos,
and URL captures.

## Current Repo Shape

There are already useful pieces in the codebase:

- `packages/protocol/src/messages.ts` defines `MessageAttachment` with `id`,
  `mediaType`, `fileName`, `blobKey`, `url`, and `metadata`.
- `packages/runtime/src/schema.ts` already has `message_attachments`.
- `packages/runtime/src/sqlite-store.ts` persists and hydrates message
  attachments.
- `packages/web/server/create-openscout-web-server.ts` exposes `/api/blobs`
  for ephemeral image uploads.
- `packages/web/server/image-blob-store.ts` stores image bytes in a TTL cache,
  not the broker database.
- `packages/web/client/components/MessageEmbeds.tsx` renders image, link, and
  file-style embeds from message attachments.
- The Pairing bridge prompt API can already carry `images: { mimeType, data }[]`
  into session adapters.
- The Pi adapter can project prompt images into Pi RPC as base64 image parts.

The missing piece is the durable local asset layer between broker messages and
ephemeral/provider-specific encodings.

## Decision

Scout SHOULD introduce a broker-owned Asset Store and evolve
`MessageAttachment` into a reference to those asset records.

The first implementation SHOULD live in `packages/runtime` because the broker is
the canonical writer for Scout-owned coordination records and already owns the
SQLite store, support paths, and runtime HTTP API.

The web-only ephemeral blob route SHOULD remain useful as an ingestion cache and
compatibility path, but durable message attachments SHOULD point at asset ids.

## Nouns

| Term | Meaning |
| --- | --- |
| Asset | Durable Scout-owned metadata for one local content object. |
| Asset bytes | The local file bytes for an asset, stored outside SQLite. |
| Derivative | Rebuildable output such as thumbnail, OCR text, transcript, waveform, or preview image. |
| Attachment | Message or invocation reference to an asset, plus role and display hints. |
| Projection | Harness-specific representation of an asset, such as path, base64, provider upload id, or extracted text. |
| Source | How the asset entered Scout: paste, screenshot, drag-drop, file, URL capture, dictation, agent output. |

## Ownership Boundary

Assets are Scout-owned when they enter through a Scout surface or broker API:

- pasted screenshots in Comms
- Talkie capture shelf items attached to an ask
- files dragged into Scout web or native app
- audio clips recorded by a Scout/Talkie surface
- generated artifacts an agent intentionally posts through Scout

Assets are not a mandate to import external harness transcripts or copy every
harness file into Scout. If an external harness writes its own transcript,
artifact, or file id, Scout may link to it as observed source material. Scout
only owns the asset when a Scout workflow imports or creates it as a control
plane object.

This preserves the boundary in `docs/data-ownership.md`: Scout owns coordination
records and first-party artifacts; external harness source material remains
harness-owned.

## Asset Shape

The initial protocol shape can be kept conservative:

```ts
type AssetRecord = {
  id: `asset-${string}`;
  mediaType: string;
  byteSize: number;
  sha256: string;
  storageKey: string;
  fileName?: string;
  title?: string;
  source: AssetSource;
  createdByActorId: string;
  originNodeId: string;
  createdAt: number;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
  derivatives?: AssetDerivativeRef[];
  retention?: AssetRetentionPolicy;
};

type AssetSource =
  | "paste"
  | "screenshot"
  | "drag_drop"
  | "file"
  | "url_capture"
  | "audio_recording"
  | "agent_output"
  | "import";

type AssetDerivativeRef = {
  kind: "thumbnail" | "ocr_text" | "transcript" | "preview" | "waveform";
  assetId?: string;
  text?: string;
  mediaType?: string;
  metadata?: Record<string, unknown>;
};

type AssetRetentionPolicy = {
  class: "ephemeral" | "conversation" | "pinned" | "external_ref";
  expiresAt?: number;
};
```

The bytes should live under the Scout support directory, not inside SQLite and
not as the canonical message body. A likely layout:

```text
~/Library/Application Support/OpenScout/assets/
  objects/
    ab/
      cd/
        <sha256>
  derivatives/
    <asset-id>/
      thumbnail.webp
      ocr.txt
```

Content-addressed byte storage gives dedupe cheaply. Asset records remain
separate because the same bytes can be attached with different names, sources,
permissions, or display hints.

## Attachment Shape

The message-level attachment should be lightweight:

```ts
type MessageAttachment = {
  id: `att-${string}`;
  assetId: `asset-${string}`;
  role?: AttachmentRole;
  display?: AttachmentDisplay;
  label?: string;
  metadata?: Record<string, unknown>;

  // Compatibility fields during migration.
  mediaType?: string;
  fileName?: string;
  blobKey?: string;
  url?: string;
};

type AttachmentRole =
  | "input_image"
  | "input_audio"
  | "input_file"
  | "screen_capture"
  | "reference"
  | "artifact"
  | "link_preview";

type AttachmentDisplay =
  | "inline"
  | "collapsed"
  | "hidden"
  | "link";
```

`assetId` is the durable reference. `role` describes why the attachment matters.
`display` is a hint, not an absolute command. Surfaces may override it for
layout, file size, safety, or media support.

The existing `mediaType`, `fileName`, `blobKey`, `url`, and `metadata` fields can
remain while clients migrate. New records should prefer `assetId` plus asset
lookup.

## Display Rules

Rendering and agent context are related, but not identical.

Message rendering SHOULD follow these rules:

1. Inline small images and screenshots when `display` is `inline` and the media
   is safe to render.
2. Show a file chip for documents, large images, videos, unknown media, or any
   `display: "collapsed"` attachment.
3. Hide visually noisy helper assets when `display` is `hidden`, while keeping
   them available for harness projection.
4. Render URLs and external references as link cards when the attachment role is
   `link_preview` or the asset source is `url_capture`.
5. Never require the message `body` to contain a URL just so the UI can render an
   attachment.

This keeps the broker record stable while each surface makes local presentation
choices.

## Ingestion Flow

### Paste Or Drag Into A Surface

```text
surface receives bytes
  -> POST /v1/assets
  -> broker writes bytes and AssetRecord
  -> surface sends message with attachments: [{ assetId, role, display }]
```

The surface may optimistically show a local preview before the broker finishes
the write. The broker response becomes the durable id.

### Screenshot Or Talkie Capture

```text
Talkie creates capture file
  -> import file path into Scout asset store
  -> preserve original filename and capture metadata
  -> attach asset to message or ask
```

For local captures, the broker should copy or hard-link bytes into its asset
store rather than keeping only the original capture path. The original path can
stay in metadata as source provenance.

### URL Capture

```text
surface submits URL
  -> broker creates external-ref asset
  -> optional fetcher derives title, thumbnail, and text
  -> message attaches the URL asset
```

URLs are assets too, but their bytes may be external or derivative-only. The
asset record should make that explicit with `retention.class: "external_ref"`.

## Harness Projection

Adapters SHOULD project asset references at the boundary. The broker should not
know or care which provider wants which encoding.

| Harness/API shape | Projection |
| --- | --- |
| Local file-aware harness | absolute local path plus media type |
| Pairing prompt bridge | `{ mimeType, data }` image list when image-capable |
| Pi RPC | base64 image payloads, matching current `Prompt.images` support |
| OpenAI/Anthropic/xAI-style APIs | upload, file id, base64, or URL according to adapter capability |
| Text-only harness | extracted text, OCR, transcript, filename, and a clear limitation note |
| Remote mesh peer | authorized asset fetch URL or replicated asset envelope |

Projection state can be cached:

```ts
type AssetProjection = {
  id: string;
  assetId: string;
  target: "pi" | "codex" | "claude" | "openai" | "xai" | "mesh";
  representation: "path" | "base64" | "url" | "provider_file_id" | "text";
  valueRef: string;
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
};
```

Provider upload ids and signed fetch URLs should be treated as projections, not
as canonical asset identity.

## API Direction

Add broker APIs rather than stretching `/api/blobs` into a durable contract:

```text
POST /v1/assets
GET  /v1/assets/:assetId
GET  /v1/assets/:assetId/content
GET  /v1/assets/:assetId/derivatives
POST /v1/assets/:assetId/derivatives
```

Initial `POST /v1/assets` input:

```ts
type CreateAssetRequest = {
  mediaType: string;
  fileName?: string;
  source: AssetSource;
  dataBase64?: string;
  localPath?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  retention?: AssetRetentionPolicy;
};
```

The request allows base64 at the HTTP edge because that may be the simplest path
for browsers and native clients. The broker stores bytes and returns an asset
record. It does not place base64 into messages.

`send`, `ask`, and reply APIs should accept:

```ts
type OutgoingAttachmentInput = {
  assetId?: string;
  role?: AttachmentRole;
  display?: AttachmentDisplay;

  // Compatibility during migration.
  id?: string;
  mediaType?: string;
  fileName?: string;
  blobKey?: string;
  url?: string;
};
```

If callers still provide `mediaType + url/blobKey`, the broker can normalize that
into the current `MessageAttachment` form. New callers should upload/create an
asset first and attach by `assetId`.

## Storage Direction

SQLite tables can evolve from the existing `message_attachments` table:

```sql
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  media_type TEXT NOT NULL,
  byte_size INTEGER,
  sha256 TEXT,
  storage_key TEXT,
  file_name TEXT,
  title TEXT,
  source TEXT NOT NULL,
  created_by_actor_id TEXT,
  origin_node_id TEXT,
  retention_json TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS asset_derivatives (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  derivative_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  text TEXT,
  media_type TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

ALTER TABLE message_attachments ADD COLUMN asset_id TEXT REFERENCES assets(id);
ALTER TABLE message_attachments ADD COLUMN role TEXT;
ALTER TABLE message_attachments ADD COLUMN display TEXT;
```

Exact migrations should follow the repo's SQLite migration posture. The key
direction is that attachment rows become joins between messages and assets, not
the only place asset metadata lives.

## Security And Trust

This is local-first but still needs boundaries:

- Store bytes in a Scout-owned support path with predictable retention.
- Do not serve arbitrary local paths directly as durable attachments.
- When importing a path, copy or link into the asset store and record provenance
  separately.
- Enforce byte-size limits by media class.
- Sniff basic media type when possible instead of trusting only caller input.
- Keep asset fetch URLs local and private by default.
- Require explicit mesh authorization before exposing assets to another node.
- Treat OCR, transcript, and summaries as derivatives that may contain sensitive
  content.

The first slice is still a high-trust local pilot, matching Scout's current
posture. It should not claim enterprise DLP, compliance retention, or
multi-tenant isolation.

## Mesh Direction

Do not make mesh block the local slice.

For same-machine local work, an `assetId` can resolve to local bytes. For a
remote peer, a message with attachments needs one of these policies:

1. **Metadata only:** remote peer sees filename, media type, size, and a note
   that bytes are local-only.
2. **On-demand fetch:** authority node serves a signed local-network URL for
   authorized peers.
3. **Replicated envelope:** broker forwards the bytes or an encrypted bundle to
   the authority peer.

Phase 1 can choose metadata-only for mesh. Phase 2 can add on-demand fetch.
Replication is a later explicit design because it touches trust, retention, and
storage budgets.

## Implementation Plan

### Phase 0: Document And Align

- Land this proposal.
- Confirm that `asset`, `attachment`, `derivative`, and `projection` are the
  right nouns.
- Keep current ephemeral `/api/blobs` path working.

### Phase 1: Durable Local Image Assets

- Add `AssetRecord` protocol/runtime types.
- Add runtime SQLite asset tables and store methods.
- Add a broker asset service under `packages/runtime`.
- Add `POST /v1/assets` and `GET /v1/assets/:id/content`.
- Extend `MessageAttachment` with optional `assetId`, `role`, and `display`.
- Let web and native send messages with `assetId` attachments.
- Render existing and new attachments in the web message embed component.

Done when a pasted screenshot can be stored as an asset, attached to a message,
rendered inline, and reopened after broker restart.

### Phase 2: Ask/Invocation Attachment Context

- Extend ask/invocation inputs to accept asset refs.
- Include attachment refs in the invocation prompt context.
- Project image assets into Pairing/Pi `Prompt.images` for image-capable
  adapters.
- Add text-only fallback from filename, media type, OCR, and a clear limitation
  note.

Done when `scout ask --to grok` can carry a screenshot as actual image context
through the Pi harness rather than just a local path in text.

### Phase 3: Derivatives And Search

- Generate thumbnails for image assets.
- Add optional OCR for screenshots and PDFs.
- Store transcripts for audio clips.
- Index text derivatives in the knowledge/QMD pipeline from `sco-062`.

Done when image and audio attachments can be found later by their extracted
content without making the original bytes the search index.

### Phase 4: Mesh And Provider Projection Cache

- Add authorized remote asset fetch.
- Cache provider upload/file ids per asset and provider.
- Add retention cleanup for expired projections and ephemeral assets.

Done when a remote agent can safely fetch an authorized attachment and repeated
provider calls do not re-upload the same asset unnecessarily.

## CLI Direction

The CLI should grow explicit attachment flags after the asset store exists:

```bash
scout send --to hudson --attach ./screenshot.png "What do you see?"
scout ask --to grok --attach ./screen.png "Describe this page."
scout ask --to talkie --attach-url https://example.com "Summarize this."
```

The CLI should upload/create assets first, then send by `assetId`.

Do not overload message text with pseudo-URLs such as `file:///...` as the
canonical attachment path. The body may still mention a file for human clarity,
but the structured attachment is the source of truth.

## Open Questions

- Should `assetId` be globally unique across mesh nodes, or scoped by authority
  node with a composite identity?
- Should `MessageAttachment.display` live on the join row only, or can an asset
  have a default display preference?
- Which media classes need hard byte limits in phase 1?
- How should local path imports handle very large files: copy, hard link,
  symlink rejection, or external reference?
- Should OCR be automatic for screenshots, opt-in, or lazy on first search?
- How much metadata should be visible to agents by default when bytes cannot be
  projected?

## Non-Goals

- Do not replace the broker message body with multipart blobs.
- Do not persist base64 as canonical message content.
- Do not build cloud storage or public sharing in the first slice.
- Do not replicate all external harness artifacts into Scout.
- Do not make mesh asset replication a prerequisite for local attachments.
- Do not require every surface to render attachments the same way.

## Recommendation

Proceed with Phase 1 as a narrow local image asset slice, then immediately wire
Phase 2 for ask/invocation projection. That gets the Talkie and Grok use case
working end to end while keeping the architecture general enough for audio,
documents, search, and mesh.
