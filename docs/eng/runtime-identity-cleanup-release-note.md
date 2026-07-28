# Runtime identity cleanup: migration note

Status: implementation release note · 2026-07-28

Scout now treats exact runtime selection and agent identity as separate
grammars. Exact asks accept `--harness`, `--model`, and `--effort`, or the
shell-safe RuntimeSpec `<harness>[/<model>[/<effort>]]`. Use
`scout runtimes --json` to discover legal tuples.

This is a breaking routing cleanup: bare runtime grammar words no longer resolve
as agent names. Launchable harness ids, runtime profile ids, effort values,
route words, dimension keys, product identities, and built-in definition ids
are reserved for new agent names and aliases. Exact model ids are not globally
reserved.

The development control plane received a one-time reference-preserving rename.
There is no general automatic rename path: another installation containing a
stored reserved identity fails startup with `reserved_name_existing`. Rename
that project or registry identity explicitly and restart. Newly inferred names
whose project basename is reserved receive a non-reserved `-agent` suffix.

Exact runtime requests now create isolated sessions so a per-ask model or effort
cannot mutate a durable agent endpoint or accidentally reuse incompatible live
context. Exact `session:<id>` continuation fails closed unless observed harness,
model, and effort match. Invocation execution-resolution records distinguish
requested, resolved, and observed values so callers can verify what actually
ran rather than treating launch configuration as observation.
