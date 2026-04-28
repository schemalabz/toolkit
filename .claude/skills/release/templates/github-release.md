# GitHub Release Notes Template

Write for someone deciding whether to install this update — lead with impact, not implementation.

## Structure

```markdown
## Highlights

<!-- 1-3 sentences: what this release brings, in plain language. -->

## Breaking Changes

<!-- Only if there are breaking changes. What broke, what to do about it. -->
<!-- Omit this section if there are none. -->

## What's New

<!-- New capabilities. Each bullet: what users can now do. -->
<!-- Omit if none. -->

## Improvements

<!-- Enhancements to existing behavior: reliability, performance, UX, compatibility. -->
<!-- Omit if none. -->

## Fixes

<!-- What was broken and how it's fixed. -->
<!-- Omit if none. -->

## Internal

<!-- Refactors, CI, dependencies — one line each, keep brief. -->
<!-- Omit if nothing notable. -->
```

## Rules

- **Group related commits into single bullets** — don't list every commit
- **Lead with user impact**: "Downloads now work on macOS Sequoia (M4 Macs)" not "Strip com.apple.provenance xattr from binaries"
- **Reference PRs/issues** where relevant: `(#123)`
- **Skip trivial changes** (typos, formatting) unless they're the only changes
- **Omit empty sections entirely**
