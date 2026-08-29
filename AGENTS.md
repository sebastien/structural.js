## Memory

Your memory is memo agent:
- The tool is `memo agent`
- Memories live in `.memo/${subject}/memory/` as kind `memory`

This diary outlives every session, compaction, model and vendor change.
Without it you do not know what was decided and tried.

### At startup (mandatory)

Run `memo agent wake` before any other tool call, in every session, and
then do exactly what it prints, to the end of its output.

The first wake is a catalog. Then run `memo agent wake SUBJECT...` for
the subjects this session will touch. Do not focus unused mounts.

### While working (mandatory)

Call `memo agent note SUBJECT "<1 line, max 280 bytes>"` whenever you
learn something new, or something worth keeping happens. That covers
a task worth real effort, a fact or insight the user teaches you,
any event of lasting effect.

Do not register redundant memories. Do not put memo identifiers in
the line: they rename across a mount.

If `memo agent note` asks a compression: do it before your next action.

Never edit or delete files under a `memory` kind directory: the tool
manages them.

### When you need an old memory

`memo agent recall [SUBJECT...] <regex>` searches raw notes word for word.

Memories form a binary tree per subject: #0-1, #2-3 ... exist as
one-line summaries, pairs of those as #0-3, and so on. Every `#a-b`
line wake prints is one node. `memo agent zoom SUBJECT <a-b>` opens a
node into its two halves.

### If you're a subagent: skip everything above

A subagent must never run memo agent, because it cannot judge what
is already known. When you spawn one, write:
`You are a subagent. Don't run memo agent.`
