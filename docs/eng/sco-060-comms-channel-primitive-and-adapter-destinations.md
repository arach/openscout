# SCO-060: Comms Channel Primitive and Adapter Destinations

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Comms identity, native Comms shell, adapter-ready routing
- **Intent:** Put DMs and named shared lanes on one durable top-level channel primitive, with `cId` as the stable identifier.

## 2. Summary

The product direction is a standalone native **Comms** surface: close to the HUD in navigational pull, but cleaner and focused on communication. It should not become another HUD slot, a settings home, or a web wrapper.

The model direction is also simple: a DM is a channel with a small member set and private defaults. A named shared lane is a channel with an alias, broader visibility, and different notification policy. Adding members can change the channel's treatment without changing its `cId`.

`cId` means **channel id**. It is intentionally compact enough to stay usable in UI, logs, and API payloads.

## 3. External Shape

| System | Top-Level Unit | DM Model | Nested Discussion | Useful Takeaway |
| --- | --- | --- | --- | --- |
| Slack | Unified messaging container | 1:1 and group DMs use the same top-level API family as shared lanes | Message replies under a parent timestamp | Unified row model is proven. |
| Microsoft Teams | Chat or team channel | Chat covers 1:1 and group DMs | Reply chains inside channel posts | Membership and policy vary more than identity. |
| Matrix | Room | DMs are rooms with direct-chat metadata | Relations and replies | Room/channel identity is stable while semantics shift. |
| Zulip | Stream plus topic | Direct messages are separate | Topic is the main sub-lane | Topics may be useful later, but not as the root unit. |
| Vercel Chat SDK | Channel + thread + adapter | DM open calls return an active unit | Thread is the active bot lane | Adapter thinking is useful; nouns do not need to match. |

## 4. Nouns

| Term | Meaning |
| --- | --- |
| **Comms** | The native communication surface. |
| **Channel** | Durable top-level communication unit. DMs, group DMs, named shared lanes, and system lanes all fit here. |
| **cId** | Stable channel id. Prefer opaque `c.<uuid>` ids for new rows. |
| **Alias** | Optional display handle such as `#talkie-next`. |
| **Member** | Actor allowed to participate or receive events under policy. |
| **Thread** | Nested discussion rooted at a message inside a channel. |
| **Adapter** | Bridge to an external destination such as Slack, Teams, Matrix, email, or a future A2A surface. |
| **Binding** | Mapping between one Scout channel and one adapter destination. |
| **Policy** | Visibility, notification, retention, and member mutation rules. |

## 5. Shape

```ts
type Channel = {
  cId: `c.${string}`;
  kind: "direct" | "group" | "shared" | "system";
  alias?: string;
  title: string;
  memberIds: string[];
  policy: ChannelPolicy;
  metadata?: Record<string, unknown>;
};

type ChannelPolicy = {
  visibility: "private" | "workspace" | "public" | "system";
  shareMode: "local" | "shared";
  discoverability: "hidden" | "listed";
  notifications: "direct" | "mentions" | "all" | "muted";
  memberMutation: "locked" | "owner" | "members";
};

type AdapterBinding = {
  id: string;
  cId: Channel["cId"];
  adapter: "slack" | "teams" | "matrix" | "email" | "a2a";
  destinationId: string;
  policy?: Partial<ChannelPolicy>;
};
```

## 6. Product Rules

1. The native app uses **Comms**, **channel**, and **cId**.
2. `cId` is stable across member, alias, and policy changes.
3. A private 1:1 can become group-like by adding members.
4. A shared lane becomes channel-like by alias and policy, not by a different root type.
5. Threads are nested under messages and do not own the top-level identity.
6. Adapter destination ids live in bindings, never inside `cId`.

## 7. Native First Slice

- Add a standalone native Comms panel, invoked from the menu bar and Hyper+C.
- Use a unified rail for private and shared channels.
- Show `cId` as the identity chip.
- Keep the visual treatment clean, immersive, and communication-centered.
- Avoid add-member controls in this slice; the app shape matters first.

## 8. Compatibility Boundary

Existing runtime and web routes may still expose older field names while the repo moves forward. New Comms-facing surfaces should use `cId`, channel vocabulary, and `/api/comms`-style aliases. Treat older names as compatibility baggage, not product ontology.
