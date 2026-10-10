# Spec Delta

## Purpose

Provide durable local storage for imported courses, learner activity, media, and optional AI settings without requiring a database server or cloud storage. Local data must survive service restarts and remain recoverable from a documented data directory.

## ADDED Requirements

### Requirement: Local startup without external services
The system SHALL default to SQLite local mode when no backend is explicitly selected, and SHALL start without DATABASE_URL, PostgreSQL, S3, cloud authentication, or AI credentials. Explicit PostgreSQL configuration SHALL retain the existing backend path. Conflicting backend configuration MUST fail with an actionable message.

#### Scenario: Fresh local installation
- **WHEN** the user starts the prepared application without external service configuration
- **THEN** the system creates its local data directory and SQLite database and exposes the course library without contacting external services

#### Scenario: Explicit existing backend
- **WHEN** an existing installation explicitly selects a PostgreSQL connection
- **THEN** the system uses that backend without silently switching its data to SQLite

### Requirement: Durable courses and learner state
The system SHALL store imported course documents, folder membership, asset metadata, and learner runtime records locally. Course availability and durable learner records MUST survive service restarts; documented device preferences may remain browser-local. Local mode SHALL use a stable single-user library without cloud sign-in.

#### Scenario: Restart and reopen
- **WHEN** a user imports a course, answers a quiz, and restarts the local service with the same data directory
- **THEN** the course, folder membership, recorded answer, and media remain available

### Requirement: Atomic writes and versioned upgrades
The system SHALL apply versioned SQLite migrations without corrupting existing data and SHALL make aggregate document changes atomic. Competing writes MUST either complete consistently or return a bounded retryable error, without lost records or partial course publication.

#### Scenario: Interrupted document save
- **WHEN** a document write fails before its commit
- **THEN** readers see the previous complete document or no document for a new import, never a partially saved course

#### Scenario: Upgrade an existing local directory
- **WHEN** the application starts against an older supported local schema twice
- **THEN** required migrations apply once and existing courses and runtime records remain readable

#### Scenario: Concurrent learner writes
- **WHEN** two requests append learner records concurrently
- **THEN** accepted records retain distinct identities and ordering, and lock waits terminate within the configured bound

### Requirement: Local media lifecycle
The system SHALL retain media bytes in the local data directory, serve them locally including seekable audio/video, and keep all published asset references resolvable. Deleting one course MUST NOT remove bytes still referenced by another course. Failed imports and interrupted media writes SHALL be reclaimable without removing referenced media.

#### Scenario: Shared media survives course deletion
- **WHEN** two courses reference identical media and one is deleted
- **THEN** the remaining course continues to resolve and play its media

#### Scenario: Interrupted media import
- **WHEN** the process stops between writing media bytes and publishing the course
- **THEN** restart does not expose a course with missing media, and unused files can be reclaimed safely

### Requirement: Local optional AI state and capability isolation
The system SHALL save configured AI settings and enabled classroom conversation history locally. It MUST NOT require PostgreSQL-backed generation or workbench initialization for course playback or supported classroom AI dialogue. Features unavailable in local mode SHALL report that limitation before accessing an external persistence backend.

#### Scenario: Optional AI conversation persists
- **WHEN** a user enables classroom AI, exchanges messages, and restarts the service
- **THEN** saved settings and conversation history are available from local storage

#### Scenario: Unsupported background feature
- **WHEN** a request targets a feature not supported by local mode
- **THEN** it receives an explicit capability-unavailable response without attempting a PostgreSQL connection

### Requirement: Recoverable data directory
The system SHALL document the location of the database and media and provide a consistent stopped-service backup and restore procedure for the complete local data directory.

#### Scenario: Restore local installation
- **WHEN** the user restores a documented complete backup and starts a compatible application version
- **THEN** courses, media, and durable learner records are accessible without reconnecting to external storage
