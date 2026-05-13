import type { Message, MessageAttachment } from "../lib/types.ts";

type LinkPreview = {
  id: string;
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

const IMAGE_EXTENSION_PATTERN = /\.(?:apng|avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/iu;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/giu;

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isImageAttachment(attachment: MessageAttachment): boolean {
  return attachment.mediaType.toLowerCase().startsWith("image/");
}

function isImageUrl(value: string): boolean {
  return IMAGE_EXTENSION_PATTERN.test(value);
}

function urlLabel(value: string): { host: string; detail: string } {
  try {
    const parsed = new URL(value);
    const detail = [parsed.pathname === "/" ? "" : parsed.pathname, parsed.search]
      .join("")
      .trim();
    return {
      host: parsed.hostname.replace(/^www\./iu, ""),
      detail: detail || parsed.hostname,
    };
  } catch {
    return { host: value, detail: value };
  }
}

function bodyUrls(body: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of body.matchAll(URL_PATTERN)) {
    const cleaned = match[0]?.replace(/[.,;:!?]+$/u, "");
    const url = safeHttpUrl(cleaned);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function attachmentUrl(attachment: MessageAttachment): string | null {
  return safeHttpUrl(attachment.url)
    ?? safeHttpUrl(metadataString(attachment.metadata, "url"))
    ?? safeHttpUrl(metadataString(attachment.metadata, "href"));
}

function linkPreviewFromAttachment(attachment: MessageAttachment): LinkPreview | null {
  const metadata = attachment.metadata ?? null;
  const kind = metadataString(metadata, "kind") ?? metadataString(metadata, "type");
  const url = attachmentUrl(attachment);
  if (!url || (kind !== "link_preview" && kind !== "link-preview" && attachment.mediaType !== "text/x-uri")) {
    return null;
  }

  const label = urlLabel(url);
  return {
    id: attachment.id,
    url,
    title: metadataString(metadata, "title") ?? label.host,
    description: metadataString(metadata, "description"),
    imageUrl: safeHttpUrl(metadataString(metadata, "imageUrl") ?? metadataString(metadata, "image")),
    siteName: metadataString(metadata, "siteName") ?? label.host,
  };
}

function bodyLinkPreview(url: string): LinkPreview {
  const label = urlLabel(url);
  return {
    id: url,
    url,
    title: label.host,
    description: label.detail === label.host ? null : label.detail,
    imageUrl: isImageUrl(url) ? url : null,
    siteName: label.host,
  };
}

function ImageEmbed({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  return (
    <a className="s-message-embed s-message-embed--image" href={src} target="_blank" rel="noreferrer">
      <img src={src} alt={alt} loading="lazy" decoding="async" />
    </a>
  );
}

function LinkEmbed({ preview }: { preview: LinkPreview }) {
  return (
    <a className="s-message-embed s-message-embed--link" href={preview.url} target="_blank" rel="noreferrer">
      {preview.imageUrl && (
        <span className="s-message-embed-thumb">
          <img src={preview.imageUrl} alt="" loading="lazy" decoding="async" />
        </span>
      )}
      <span className="s-message-embed-copy">
        {preview.siteName && <span className="s-message-embed-site">{preview.siteName}</span>}
        <span className="s-message-embed-title">{preview.title}</span>
        {preview.description && <span className="s-message-embed-description">{preview.description}</span>}
      </span>
    </a>
  );
}

export function MessageEmbeds({ message }: { message: Message }) {
  const attachments = message.attachments ?? [];
  const renderedAttachmentIds = new Set<string>();
  const imageEmbeds: Array<{ id: string; src: string; alt: string }> = [];
  const linkPreviews: LinkPreview[] = [];

  for (const attachment of attachments) {
    const url = attachmentUrl(attachment);
    if (url && isImageAttachment(attachment)) {
      renderedAttachmentIds.add(attachment.id);
      imageEmbeds.push({
        id: attachment.id,
        src: url,
        alt: attachment.fileName ?? "Image attachment",
      });
      continue;
    }

    const preview = linkPreviewFromAttachment(attachment);
    if (preview) {
      renderedAttachmentIds.add(attachment.id);
      linkPreviews.push(preview);
    }
  }

  const attachmentPreviewUrls = new Set(linkPreviews.map((preview) => preview.url));
  for (const url of bodyUrls(message.body)) {
    if (attachmentPreviewUrls.has(url)) {
      continue;
    }
    if (isImageUrl(url)) {
      imageEmbeds.push({ id: url, src: url, alt: "Embedded image" });
    } else if (linkPreviews.length === 0) {
      linkPreviews.push(bodyLinkPreview(url));
    }
  }

  const fileAttachments = attachments.filter((attachment) => !renderedAttachmentIds.has(attachment.id));
  if (imageEmbeds.length === 0 && linkPreviews.length === 0 && fileAttachments.length === 0) {
    return null;
  }

  return (
    <div className="s-message-embeds">
      {imageEmbeds.map((image) => (
        <ImageEmbed key={image.id} src={image.src} alt={image.alt} />
      ))}
      {linkPreviews.slice(0, 1).map((preview) => (
        <LinkEmbed key={preview.id} preview={preview} />
      ))}
      {fileAttachments.map((attachment) => {
        const url = attachmentUrl(attachment);
        const label = attachment.fileName ?? metadataString(attachment.metadata, "title") ?? attachment.mediaType;
        return url ? (
          <a key={attachment.id} className="s-message-embed s-message-embed--file" href={url} target="_blank" rel="noreferrer">
            <span className="s-message-embed-title">{label}</span>
            <span className="s-message-embed-description">{attachment.mediaType}</span>
          </a>
        ) : (
          <div key={attachment.id} className="s-message-embed s-message-embed--file">
            <span className="s-message-embed-title">{label}</span>
            <span className="s-message-embed-description">{attachment.mediaType}</span>
          </div>
        );
      })}
    </div>
  );
}
