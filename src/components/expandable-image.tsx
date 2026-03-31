"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Expand, X } from "lucide-react";

type ExpandableImageProps = {
  alt: string;
  className?: string;
  containerClassName?: string;
  priority?: boolean;
  src: string;
  width: number;
  height: number;
};

export function ExpandableImage({
  alt,
  className,
  containerClassName,
  priority = false,
  src,
  width,
  height,
}: ExpandableImageProps) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <div className={containerClassName}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group relative block w-full text-left"
          aria-label={`Expand image: ${alt}`}
        >
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            priority={priority}
            className={className}
          />
          <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-2 rounded-full border border-white/70 bg-black/55 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Expand className="h-3.5 w-3.5" />
            Expand
          </span>
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-[min(96vw,120rem)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white transition-colors hover:bg-black/70"
              aria-label="Close expanded image"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="overflow-hidden rounded-[28px] border border-white/12 bg-[#0f1012] shadow-[0_32px_100px_rgba(0,0,0,0.45)]">
              <Image
                src={src}
                alt={alt}
                width={width}
                height={height}
                priority={priority}
                className="max-h-[88vh] w-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
