# NCDR Optional Demo Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓內湖 Demo 在 NCDR 帳號尚未驗證時，使用既有可重現的模擬災情 fixture，並保留未來 NCDR live API 接入能力。

**Architecture:** NCDR 維持獨立的 optional live source；沒有授權時不執行 NCDR live collection。Demo 使用既有 `data/fixtures/neihu` replay 流程，並在文件與 provenance 說明這些災情是模擬資料。

**Tech Stack:** JSON／Markdown、Node.js test runner、既有 Neihu replay fixture。

**Spec:** `docs/superpowers/specs/2026-09-05-ncdr-optional-demo-fallback-design.md`

## Global Constraints

- NCDR API key 不得寫入 repo 或任何 fixture。
- 未確認帳號核發的完整 endpoint 前，不得宣稱 NCDR live integration 已完成。
- Local fixture 不得被描述成即時官方災情。
- 不修改 TDX、CWA、Android GPS、Peer Sync 或既有 event contract。
- 依使用者要求，本次不 commit。

### Task 1: Make NCDR runtime configuration explicitly optional

**Files:**
- Modify: `pipeline/.env.example`
- Modify: `pipeline/.env`
- Modify: `pipeline/README.md`

**Interfaces:**
- Consumes: existing `NCDR_API_KEY` and `NCDR_API_ENDPOINT` runtime variables.
- Produces: configuration guidance that leaves NCDR blank until account approval and directs Demo users to replay fixtures.

- [x] **Step 1: Set the example and local NCDR endpoint fields to blank**

Keep the variable names, but use this configuration:

```ini
# Optional. Leave blank until the NCDR account and approved datastore route are available.
NCDR_API_KEY=
NCDR_API_ENDPOINT=
```

- [x] **Step 2: Document the two separate commands**

State that `collect --source ncdr-hazard-events` is only for an approved NCDR account, while the Neihu replay fixture is the deadline-safe Demo path.

- [x] **Step 3: Verify secrets remain unprinted and untracked**

Check only whether `NCDR_API_KEY` is set; never print its value. Confirm `.env` remains ignored by Git.

### Task 2: Mark NCDR access and simulation fallback in project documentation

**Files:**
- Modify: `docs/neihu-online-data-sources.md`
- Modify: `pipeline/sources/catalog.json`
- Modify: `fixtures/README.md`
- Modify: `docs/superpowers/plans/2026-09-04-neihu-data-pipeline.md`

**Interfaces:**
- Consumes: NCDR source metadata and existing replay fixture paths.
- Produces: consistent handoff language for A, B, C and D that distinguishes live API, blocked access and local simulation.

- [x] **Step 1: Label NCDR as optional and access-dependent**

Keep NCDR in the source catalog, but state that the concrete datastore route and permission depend on the approved account.

- [x] **Step 2: Add the deadline-safe Demo fallback**

Point the Demo instructions to `data/fixtures/neihu/scenario.json`, `data/fixtures/neihu/update-sequence.json` and `pipeline/lib/neihu-replay.mjs`, and include the non-live disclaimer.

- [x] **Step 3: Update Task 8 acceptance**

Allow `blocked_by_access` for NCDR while requiring the replay fixture and other available live sources to pass. Do not report an unavailable NCDR source as a successful empty dataset.

### Task 3: Run the existing validation suite

**Files:**
- Test: `pipeline/test/*.test.mjs`
- Test: `simulator/test/*.test.mjs`

**Interfaces:**
- Consumes: updated configuration and documentation only.
- Produces: evidence that existing data contracts, replay and simulator behavior remain green.

- [x] **Step 1: Run the Node test suite**

```bash
npm test
```

Result: all 109 existing Node tests passed.

- [x] **Step 2: Run the replay validation**

```bash
node --test pipeline/test/neihu-replay.test.mjs
```

Result: all 5 deterministic Neihu replay tests passed without NCDR credentials.

- [x] **Step 3: Check the working tree**

```bash
git diff --check
git status --short
```

Result: no whitespace errors; changes remain uncommitted for the user to review.
