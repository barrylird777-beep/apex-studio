# Apex Studio — Human Life & Creation Foundation

## Purpose

Apex is organized around the whole human life cycle and the whole creative life of a story.

Its biblical north star is **THE BIBLICALLY SEEN**: human beings are treated as embodied creatures, persons, families, communities, cultures, and moral agents. The project's theological framing is that humanity is created by God; the software does not treat that theological claim as a scientific measurement.

## Human-life domains

1. **Embodiment** — body, movement, appearance, age, health state, senses, environment, clothing, food, rest, work, and physical limitation.
2. **Mind** — attention, memory, imagination, learning, reasoning, uncertainty, beliefs, habits, and perception.
3. **Emotion** — joy, grief, fear, anger, affection, wonder, loneliness, hope, shame, courage, and peace.
4. **Relationships** — family, friendship, marriage, courtship, community, mentorship, conflict, reconciliation, care, and belonging.
5. **Agency** — choices, intentions, boundaries, consent, responsibility, consequences, and change.
6. **Social life** — language, customs, law, economics, occupation, education, status, institutions, and community structures.
7. **Culture** — music, art, food, architecture, clothing, ritual, storytelling, technology, and inherited traditions.
8. **Meaning** — purpose, identity, vocation, mortality, suffering, hope, worship, doubt, and transcendence.
9. **Moral life** — virtue, failure, temptation, repentance, forgiveness, justice, mercy, and restoration.
10. **Spiritual life** — Scripture, prayer, worship, religious tradition, theological interpretation, and explicitly labeled fictional or speculative material.

## Creative treatment rules

- Preserve personhood and continuity instead of treating characters as interchangeable assets.
- Keep biological realism separate from invented lore.
- Keep historical claims separate from dramatization.
- Keep canonical Scripture separate from later traditions and original fiction.
- Record provenance for factual, theological, historical, and generated material.
- Represent uncertainty instead of inventing confidence.
- Allow beauty, humor, grief, ordinary life, conflict, work, family, worship, rest, and wonder to coexist in the same world.
- Treat adult romance and intimacy as parts of human relationships rather than the definition of a person.
- Never use realism to imply that synthetic media is documentary evidence.
- Preserve synthetic-content disclosure metadata when applicable.

## Visual realism

The realism layer exists to make generated scenes visually convincing through identity consistency, believable anatomy and movement, natural skin/hair/fabric/material detail, physically plausible light and environments, realistic camera/lens behavior, continuity across shots, and explicit visual anchors and negative constraints.

Realism is a production property, not a claim that generated media depicts a real event or real person.

## Source hierarchy

Each item should carry a provenance class: **scripture**, **tradition**, **historical**, **scholarly**, **interpretation**, **dramatization**, or **original-fiction**.

This ordering is a workflow taxonomy, not a universal ranking of truth claims. Conflicts should remain visible and attributed.

## Architecture principle

Organize new systems by capability rather than temporary feature name:

- `src/biblical/` — Scripture, traditions, provenance, biblical story systems
- `src/characters/` — identity, continuity, relationships
- `src/world/` — geography, environments, cultures, timelines
- `src/core/` — shared engines and policies
- `src/agents/` — agents, orchestration, tools
- `src/assets/` — asset lineage and production artifacts
- `src/api/` — transport/API contracts
- `src/runtime/` — studio lifecycle and command routing
- `test/` — behavior and regression coverage
- `docs/` — human-readable architecture and operational guides

Feature names such as LAYERS, Forge, Oracle, and Bard remain product/workspace labels; reusable capabilities belong in shared architecture.

## Quality bar

Every substantial subsystem should have: **model → validation → lifecycle → persistence → provenance/audit → API/command surface → tests → documentation → recovery behavior**.