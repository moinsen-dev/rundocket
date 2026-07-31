# RunDocket agent guidance

Read these files before changing product behavior:

1. `.planning/PROJECT.md`
2. `.planning/REQUIREMENTS.md`
3. `.planning/ROADMAP.md`
4. `docs/inspect-contract.md`

Keep the core contract independent of Xcode, Flutter, Expo, Codex, Claude, or
another specific tool. Framework-specific behavior belongs behind adapters.

Detection must be read-only and evidence-backed. Do not silently classify an
ambiguous workspace. Expo and Flutter may own embedded native projects; model
that relationship instead of promoting the generated Xcode project to a primary
app.

Do not claim build, test, launch, signing, upload, or release support until the
corresponding workflow has fresh automated evidence. Destructive and externally
binding operations must remain default-deny.

Use `npm run check` as the bootstrap verification gate.
