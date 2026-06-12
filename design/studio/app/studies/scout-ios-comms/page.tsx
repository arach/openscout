"use client";

import { SurfaceLab, CommsSurface } from "@/components/scout-ios";

export default function ScoutIOSCommsStudy() {
  return (
    <SurfaceLab
      surface="comms"
      title="Scout iOS · Comms"
      blurb="The operator's window into the mesh — one interleaved list of channels + DMs, each row: type glyph · name · status separator (ask / working spinner / awaiting / idle) · preview · age · unread capsule. The baseline tints unread rows + adds an accent rail; Hairline strips that back to one continuous list."
      source="apps/ios/Scout/CommsSurface.swift"
      treatments={[
        {
          id: "source",
          label: "Source",
          note: "As shipped: unread rows get a faint neutral lift + a 3pt accent rail; inset dividers under the type glyph.",
          body: <CommsSurface />,
        },
        {
          id: "hairline",
          label: "Hairline",
          note: "Continuous hairline list — drop the unread tint + rail, lean on bold name + the unread capsule. Denser, calmer; the comms-mobile direction.",
          body: <CommsSurface />,
          mods: { layout: "hairline" },
        },
        {
          id: "sectioned",
          label: "Sectioned",
          note: "Split the one interleaved list into Channels / Direct groups with section headers — answers the interleaved-vs-grouped question without losing recency inside each group.",
          body: <CommsSurface sectioned />,
        },
        {
          id: "marks",
          label: "Marks",
          note: "Identity-led on a hairline list — each DM gets a geometric tile (mono initial, accent-tinted by name); channels keep their type glyph in the tile. DMs read as people at a glance.",
          body: <CommsSurface marks />,
          mods: { layout: "hairline" },
        },
      ]}
    />
  );
}
