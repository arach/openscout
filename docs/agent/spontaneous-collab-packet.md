# Spontaneous collab: hand a fresh agent a diff, not a tree

Notes from a day of pulling a fresh Fable into live design work over Scout
(2026-07-29). Two rendezvous, three reviews, one near-miss incident. The reviews
were genuinely good — they caught defects the author missed — but most of what
went wrong went wrong the same way, and it is fixable with a payload shape.

**The thesis:** a fresh reviewer should receive a *frozen, self-contained change
packet*. Today it received a pointer into a moving tree, and every failure below
follows from that.

## What actually went wrong

Five failures, all observed, none hypothetical.

1. **The tree moved under the reviewer.** Two of the four headline findings in
   the manifest review were already fixed before the review arrived — the
   reviewer was reading `searchManifests` while the author was rewriting it.
   Real budget, spent on a version that no longer existed.
2. **No "as of when", so a confident claim went wrong.** In the postmortem
   review the reviewer asserted that some reverted work "sat in commit
   `1cccf9d5`, reflog-recoverable the whole time." It did not — that work was
   written *after* the commit. The reviewer was reasoning about a tree whose
   timeline it had to reconstruct from `git reflog`, and it conflated two
   changes that happened ten minutes apart. A frozen base makes this class of
   error impossible to make.
3. **Full-file reading burned judgment budget on context.** Reviewing a *schema*
   meant reading four whole files to find the twenty lines that mattered.
4. **The review landed somewhere the author could not read.** The reviewer wrote
   its full findings to a path inside *its own* session scratchpad. The author
   only ever saw the summary that fit in an inbox message.
5. **The rendezvous ate the response window.** The first brief told the reviewer
   to loop `scout match` up to 10 × 30s. It did, and timed out before answering.
   Author error, but a shape problem: coordination was put on the critical path
   of the work.

## The packet

One directory, addressable by both sides, named for the topic and the base:

```
/tmp/collab/<topic>-<baseShort>/
  BRIEF.md      the ask: context, the question, the budget, the return address
  BASE.json     what "as of" means — see below
  change.diff   the change under review, and nothing else
  claims.md     numbered assertions, each one attackable
  verified.md   what is already checked, so nobody re-finds it
  REVIEW.md     <- the reviewer writes here
```

### BASE.json is the load-bearing part

```json
{
  "branch": "studio-craft-pass",
  "headSha": "accd1e29...",
  "snapshotSha": "ececa41f...",
  "dirty": true,
  "fileHashes": { "design/studio/components/RuntimePicker.tsx": "068b2ebc766f" },
  "capturedAt": "2026-07-29T12:14:00Z"
}
```

It buys three things:

- The reviewer can write **"as of `068b2ebc`, X was true"** instead of "X is
  true." Failure 2 becomes unavailable.
- Either side can detect that the ground moved, by rehashing. Failure 1 becomes
  visible instead of silent.
- Two agents can prove they are discussing the same artifact.

This is the same mechanism as `port.verifiedAgainst` in the design-system
manifests, which exists because nobody editing the production copy will think to
update a studio sidecar. A review is the identical problem with a shorter
half-life: a claim about files at a moment, made by someone who will not be
told when they change. Content hashes are the answer in both places.

### Capturing it without touching a shared checkout

`git diff` alone will not do, because new files are untracked and in this repo
most new work *is* new files. But the obvious fix — `git add -N .` so untracked
files become visible to `diff` — **writes to the shared index**, which is the
same class of mutation that caused the incident this convention exists to
prevent. `git stash push` is worse still: it modifies the working tree that
other agents and two dev servers are using.

Use a throwaway index instead. Nothing shared is touched:

```bash
BASE=$(git rev-parse HEAD)
TMPIDX=$(mktemp -u /tmp/collab-index.XXXXXX)
GIT_INDEX_FILE="$TMPIDX" git read-tree HEAD
GIT_INDEX_FILE="$TMPIDX" git add -A .
GIT_INDEX_FILE="$TMPIDX" git diff --cached HEAD > change.diff
rm -f "$TMPIDX"
```

Verified 2026-07-29 on the live shared checkout: captured all 393 changed files
including every untracked one, and `git status` was byte-identical before and
after.

`git stash create` is also safe and useful when you want a real snapshot
*object* to name in `BASE.json`. It writes a commit object and prints its SHA
without moving HEAD, modifying the working tree, or pushing onto the stash ref —
measured on the same checkout: stash entries `3 → 3`, dirty files `391 → 391`,
HEAD unchanged. It does **not** include untracked files, which is why the
temp-index recipe above is the one that produces the diff.

### claims.md is where the value is

Every good finding today landed against a specific claim, not against a file:

- "the audit is the graduation bar" → *it only ever checks the manifest against
  itself; a deleted file or renamed export passes clean*
- "search works for an agent's query" → *your own example sentence returns zero
  hits*
- "no destructive recovery was attempted" → *the reflog says otherwise, twelve
  minutes ago*

So number the assertions and ask for a verdict on each. A reviewer given prose
returns prose; a reviewer given claims returns judgments. Adversarial review
needs something to be adversarial *about*.

### verified.md prevents re-litigation

State what has already been checked and how, so the reviewer spends its budget
on what is open. This alone would have recovered half of the manifest review.

## Transport rules

- **Read the inbox, not the flight.** Both `scout ask --profile Fable` flights
  reported `failed to respond — the operation timed out`, and **both replies
  landed in the inbox anyway**. The invocation bookkeeping is less trustworthy
  than the message layer. Poll `scout inbox` for the peer's session id.
- **Keep the rendezvous off the critical path.** Match first, or skip it; never
  make the reviewer spend its answering window coordinating.
- **`scout match --wait` hard-caps at 30 seconds** and registration expires around
  45, so both sides must loop and overlap. It resolved on attempt 1 once and
  attempt 5 another time — a timing game, not a protocol. Widening this cap is
  a real product follow-up.
- **Budget the reviewer out loud.** "Under five minutes, three answers" produced
  the sharpest, fastest review of the day. Unbounded briefs timed out.
- **Name the return address.** The author picks the path; the reviewer writes
  `REVIEW.md` there.

## Identity

Two messages arrived from this agent's own identity that this agent did not
send — another session operating as
`openscout-agent-2.studio-craft-pass.arts-mac-mini-local`. For a protocol whose
whole premise is knowing who said what, identity collision between concurrent
sessions on one project deserves its own fix.

## What we would want from Scout

In rough order of leverage:

1. **`scout review <path>`** — a first-class packet: capture the snapshot, write
   `BASE.json`, ship the packet, return a handle. The packet shape above is a
   convention until something owns it.
2. **Staleness on delivery.** If the base moved between dispatch and reply, say
   so on the reply. The reviewer should not have to notice.
3. **A shared artifact path per collab**, so full reviews are not stranded in a
   session-local scratchpad.
4. **Fix or document the flight/reply divergence.** A flight reporting failure
   for delivered work will train every agent to ignore flight state.
5. **A longer match window**, so rendezvous stops being a timing game.
