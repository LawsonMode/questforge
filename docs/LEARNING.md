# Questforge learning layer (1.2.0)

Questforge records what a student builds as **evidence**, and proposes a **mastery level from 1 to 4**
for each skill it teaches. The evidence includes the code of the triggers they write, the bugs they fix,
their playtests and their pixel art. The teacher confirms or adjusts each level. Later this happens in
**Quark**, the local home base, once its SDK exists.

Everything lives in `src/learning/`. Nothing leaves the browser: the log stays in IndexedDB until the
student exports it.

## The pieces

| File | What it is |
|---|---|
| `standards.ts` | **Skill catalog** (`STANDARDS_VERSION`). Skill ids follow the Shared Learning Layer "Skill Atlas" draft (`prog.io`, `prog.selection`, ...). Each skill has an "I can ..." line, standards codes (Idaho course guidance, Idaho DL draft, CSTA 2017, ISTE 2016) and a descriptor for each of levels 1-4. CSTA and ISTE codes are proposed alignments marked `verify`. |
| `activities.ts` | **Activity manifest**: every learning moment Questforge records (`qf.trigger.built`, ...), with its verb and the skills it is evidence for. Standards are mapped here, never inside an event. |
| `log.ts` | **Event log** in Quark's draft event format (xAPI-lite), stored in its own IndexedDB database `questforge-learning` with a memory fallback. Also provides `LearningSink`, the seam where Quark plugs in. |
| `levels.ts` | `proposeLevels(events)`: pure rules that turn events into a proposed level per skill, with reasons and the event ids that prove each level. Levels are never stored. |
| `editorObserver.ts` | Watches the editor bus and records evidence. It also exports the `note*` helpers that the views and the shell call. |
| `pixelBits.ts` | Pure helpers for the art tab's "Under the hood" panel: images as bits. |
| `export.ts` | The `questforge.learning/1` export file. |
| `page.ts` | The **My Learning** page (`#/learning`). |

The UI lives with the editors:
- `editor/entities/triggerCode.ts` and `codeView.ts`: **Show as code** under the trigger form.
- `editor/art/underTheHood.ts`: **Under the hood** under the pixel canvas.

## What gets recorded

| Activity | Verb | When | Work sample |
|---|---|---|---|
| `qf.trigger.built` | created | A trigger starts working, or changes while working. Working means no editor warnings and at least one action. Rename-only edits don't count. | The trigger's code |
| `qf.trigger.fixed` | completed | A trigger that was working broke, or one that came broken with the project now works. | The fixed code |
| `qf.code.viewed` | completed | Show as code opened for a trigger (once per trigger per page load) | — |
| `qf.playtest.run` | attempted | A playtest starts. Pending trigger edits are recorded first. | — |
| `qf.pixels.inspected` | completed | Under the hood opened on a tile or sprite (once per asset per page load) | — |
| `qf.pixels.drawn` | created | The pixels of a tile or sprite changed, recorded after 2.5 s of quiet | First frame as hex |
| `qf.palette.edited` | created | The colours of a palette changed | The 16 colours |
| `qf.project.exported` | submitted | Export from the editor | — |

Trigger events carry facts that the level rules read:
- `on`
- `conditions` and `conditionKinds`
- `actions` and `actionKinds`
- `negated`
- `blockingThenMore`, which means a wait or dialogue step is followed by more actions
- `setsFlags` and `readsFlags`
- `authored`

**Authorship (integrity).** The editor treats what a project holds when it opens as the baseline.
- `authored: 'self'` marks a trigger the student made, or one the log already credits to them.
- `authored: 'modified'` marks baseline work from the sample, an import or a copy that the student then changed.
- Unchanged baseline work, and unchanged copies of it, are never recorded.
- **Levels 3-4 only count `self` work.** Modified work counts at most as level 2. This follows the Atlas rule that code from someone else counts at most as Practised.

## Event format (Quark draft, §7)

```json
{
  "id": "ev_…", "time": "2026-10-05T10:42:07.000Z", "actor": null, "verb": "created",
  "object": { "app": "questforge", "activity": "qf.trigger.built", "ref": "ow_village/t_e2e", "name": "Reward" },
  "result": {
    "response": "# Reward (runs once per save file)\nwhen room.enter:\n    if flag(\"gotSword\") and count(\"Gems\") >= 5:\n        say(\"…\")\n        give(\"Gems\", 20)\n        set_flag(\"rewarded\", True)",
    "facts": { "on": "enter", "conditions": 2, "conditionKinds": ["flag", "hasItem"], "actions": 3,
               "actionKinds": ["dialogue", "giveItem", "setFlag"], "negated": false, "blockingThenMore": true,
               "setsFlags": ["rewarded"], "readsFlags": ["gotSword"], "once": true, "authored": "self" }
  },
  "context": { "appVersion": "1.2.0", "standardsVersion": "1.0.0", "projectId": "p_…", "projectName": "My Quest",
               "roomId": "ow_village", "mode": "editor", "session": "s_…" }
}
```

`actor` stays `null` until Quark sign-in exists. On a shared computer, each browser profile keeps its own log.

## Levels

`proposeLevels` gives each skill a level from 0 to 4. The level names are Not yet, Beginning, Developing,
Proficient and Advanced. The descriptors in `standards.ts` say what each level means for each skill.

General rules:
- **"Playtested"** means a playtest ran after the work it vouches for.
- **Level 4 means "again in a different context":** two or more rooms, or chained triggers.
- **Levels never go down** as new events arrive.

`prog.trace` (reading code) is capped at level 2 in the app (`maxLevel`). Levels 3-4 need a prediction
task or an explanation the teacher scores.

## Quark integration (later)

1. **Identity:** set `actor` to the Quark student id, through the recorder context in `log.ts`.
2. **Delivery:** add a Quark sink with `addLearningSink({ record: (e) => quark.send(e) })`. The local
   store stays the first sink, so nothing is lost offline.
3. **Mapping:** Quark imports the manifest (`ACTIVITIES`) and the skill catalog (`SKILLS`) once, and the
   teacher approves the mapping. The export file already carries both, plus `proposed` levels.
4. **Teacher decision:** Quark shows the proposed level with its evidence, and the teacher confirms or
   adjusts it.

**Open point for Quark's plan:** Quark v0.1 (§7) says "game results are never mastery". Questforge's
evidence is the student's own work (their code), not a game score. Quark's rule should distinguish
*work samples* (eligible for a proposed level) from *game results* (activity only).
