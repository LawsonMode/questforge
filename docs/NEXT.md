# Questforge: next steps and known issues

Status at **1.2.0** (2026-10-05): committed, pushed and live on GitHub Pages. Before you start, read
[../CLAUDE.md](../CLAUDE.md), [../ARCHITECTURE.md](../ARCHITECTURE.md) (the build contract) and
[LEARNING.md](LEARNING.md) (the learning layer).

## Direction

Questforge teaches the computer-science and digital-literacy skills in Idaho's standards.
- **Evidence is the student's own work** (their code, the bugs they fix, their art), not a game score.
- **The app proposes** a mastery level from 1 to 4 for each skill, and links each level to its proof.
- **The teacher confirms** it.
- **Quark**, the separate local home-base app (planned, not built), will collect the evidence later.

## Next features (in order)

1. **CS puzzle pieces.** These are new entities that reuse the trigger system:
   - **Binary door:** 8 floor switches act as the bits of one number, and the door opens at a target value such as 42.
   - **Logic-gate rooms:** AND, OR, NOT and XOR built from switches, pegs and torches.

   Add the new entity types to `src/core/catalog.ts`, and any new condition kinds to `types.ts`. Both files are frozen contract files: changes must be additive and logged in ARCHITECTURE.md. Then add learning activities and skills for both pieces, including a number-systems skill.
2. **Recording during play.** `#/play` and `#/playtest` record no evidence yet. Puzzles solved in play (binary values, gates) are the first good evidence from play. Recording happens only through the editor observer today; play needs its own observer, with mode `play` or `playtest` (`src/learning/log.ts`).
3. **Cipher stones.** Caesar or substitution ciphers on signs, solved to get a password for an NPC. Encryption standards: CSTA 3A-NI-06 and 3A-NI-07.
4. **A digital-literacy quest module.** This is mostly content (dialogue choices, flags and triggers): a phishing village, a password vault, a rumor mill, a digital-footprint quest and an upstander quest.
5. **Playtest analytics.** A heatmap of deaths and time spent per room, used to redesign a level from the evidence. Standards: 3A-DA-11/12 and 3A-AP-19.
6. **Classroom layer.**
   - Lesson cards: step-by-step challenges in the editor, checked automatically by the validator.
   - Standards tags on templates.
   - A design-notes and reflection panel.
   - A peer-review checklist when a project is imported.
7. **Predict and trace.** A prediction task would lift the "Reading code" skill (`prog.trace`) past its in-app cap of level 2.

Later: **code as magic** ("The Runesmith"). It uses a shared Python-subset language with Programmon, following the
Shared Learning Layer design (`A:\Code\Digital Literacy Games\Proposals\Shared Learning Layer.md`).

## Quark integration (when Quark's SDK exists)

Follow the steps in [LEARNING.md → Quark integration](LEARNING.md#quark-integration-later):
- set `actor`
- add a sink with `addLearningSink`
- have Quark import the activity manifest and the skill catalog

**Open point:** Quark's plan (v0.1, §7) says "game results are never mastery". It must treat work samples
(student code) differently from game scores. Raise this with the owner when Quark is built.

## Known issues

- **Flaky e2e scenarios.** `final-game-fixes` (melee walkers vs the wall) and `wave-b-builder` (headless browser
  "Target crashed") sometimes fail during `node scripts/e2e.mjs --all`, then pass when rerun on their own.
- **Standards codes need checking.** CSTA 2017 and ISTE 2016 codes in `src/learning/standards.ts` are proposed
  alignments marked `verify`. Check them against the official text before anyone reports on them. The Idaho DL
  codes come from a June 2026 draft and may change.
- **Not hand-checked.** No person has listened to the music, and the boss balance has never been play-tested by a person.
- **Shared computers.** The learning log belongs to one browser profile until Quark sign-in exists. Students on a
  shared profile would mix their evidence.
- **Small-screen layout.** On short windows, an open "Under the hood" panel squeezes the pixel canvas (the panel is
  capped at 260 px tall).

## Rules to keep

- **Never copy Nintendo assets, names or melodies.** Item display names are Questforge's own (see CLAUDE.md).
- **Never renumber ids.** That covers default tile ids, learning activity ids and skill ids; add new ones instead.
- **Keep the learning-layer rules.** Levels are derived and never stored. Copied or sample work is never credited,
  and borrowed work counts at most for level 2.
- **Source files use CRLF line endings.**
- **Version:** `package.json` → `version` is the only place to bump it. Push only when the owner asks; every push
  to `main` redeploys the public site.
