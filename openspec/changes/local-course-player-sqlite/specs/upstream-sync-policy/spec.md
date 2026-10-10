# Spec Delta

## Purpose

Define an explicit repository maintenance contract for keeping ProMAIC aligned with upstream OpenMAIC while preserving SQLite storage and local playback. Synchronization must be traceable, reversible, and verified against the local runtime requirements.

## ADDED Requirements

### Requirement: Discoverable upstream maintenance instructions
The repository SHALL contain a root `AGENTS.md` naming `https://github.com/THU-MAIC/OpenMAIC` as upstream and requiring agents to proactively check upstream changes during maintenance. It SHALL describe configuring the upstream remote, discovering its default branch, and preferring rebase for bringing upstream changes into the fork. This policy MUST NOT imply an unattended scheduled synchronization service.

#### Scenario: Agent begins maintenance
- **WHEN** an agent reads repository instructions for maintenance
- **THEN** the instructions identify the upstream source, require an upstream-difference check, and explain the rebase-based workflow

### Requirement: Preserve local compatibility while adopting upstream features
The maintenance policy SHALL require adaptation of upstream features and fixes to SQLite and local resource constraints. It MUST forbid resolving conflicts by silently restoring mandatory PostgreSQL, cloud services, or non-AI public requests. Deferred features SHALL be identified with reasons rather than reported as synchronized.

#### Scenario: Upstream adds a PostgreSQL-backed feature
- **WHEN** synchronization encounters a new feature with persistence changes
- **THEN** maintenance instructions require an equivalent local adaptation or an explicit recorded deferral, while preserving usable local playback

### Requirement: Recoverable synchronization with evidence
The maintenance policy SHALL require a clean working state, a recovery reference, and validation on a temporary synchronization branch before integration. It SHALL prohibit discarding user changes or force-pushing shared branches without separate authorization. Each synchronization SHALL record upstream commit identifiers, adopted or deferred features, conflict decisions, and relevant verification results.

#### Scenario: Rebase with local changes present
- **WHEN** the worktree contains user changes or integration would require rewriting shared history
- **THEN** the documented procedure preserves user work and stops the destructive step until its prerequisite or authorization is resolved

#### Scenario: Completed synchronization
- **WHEN** an upstream synchronization is declared complete
- **THEN** its record includes the upstream revision and results for SQLite migration/persistence, ZIP import/playback, local resources, and optional AI compatibility
