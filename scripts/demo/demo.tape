# scripts/demo/demo.tape
# Renders docs/demo.gif — the README hero asset. Run with:
#   npm run demo
# which in turn runs:
#   bash scripts/demo/fixture.sh && vhs scripts/demo/demo.tape
#
# Beat structure (~27s, 4 hero detectors):
#   0–3s    type `claude-slim`, output streams in
#   3–8s    ESTIMATED OVERHEAD ~11,442 reveals — Holy Shit moment
#   8–16s   issues list visible (broken/duplicate/oversized/unused) — viewer reads
#   16–21s  type `all`, cleanup runs
#   21–27s  report box — Before/After/Saved/monthly $ — final reveal sits

Output docs/demo.gif

Set Shell bash
Set FontSize 14
Set Width 1200
Set Height 720
Set Padding 24
Set TypingSpeed 70ms

# --- Setup (hidden) -------------------------------------------------------
# Point the demo at the synthetic fixture and shadow the binary with the
# local dist/ build so the demo shows real output from the current source.
Env HOME "/tmp/claude-slim-demo"

Hide
Type 'export PATH="$(pwd)/scripts/demo/bin:$PATH"'
Enter
Type "clear"
Enter
Sleep 200ms
Show
Sleep 800ms

# --- Beat 1: Holy Shit reveal --------------------------------------------
Type "claude-slim"
Sleep 400ms
Enter

# Scan output streams (skills table, CLAUDE.md, memory, MCP, then OVERHEAD).
# Sleep long enough for OVERHEAD ~11,442 to land and viewer to register.
Sleep 5s

# --- Beat 2: Detector reveal ---------------------------------------------
# Issues list now on screen — broken_symlink kakao-internal,
# duplicate brainstorming, oversized figma-use, unused ralph + 14 more.
# Tight read window: top 4–5 issue lines + Your choice prompt.
Sleep 8s

# --- Beat 3: Cleanup decision --------------------------------------------
Type "all"
Sleep 500ms
Enter

# cleanIssues moves files, then re-scan + report box prints. ~1s of output.
Sleep 5s

# --- Beat 4: Result reveal -----------------------------------------------
# Report box shows Before / After / Saved / Top offenders / monthly $.
# The "Saved: ~5,616 tokens (49%)" line is the closing image — sit on it.
Sleep 6s
