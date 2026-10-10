# Spec Delta

## Purpose

Let users import and play existing OpenMAIC course ZIP packages entirely on their own machine, with clear handling of incomplete legacy packages. Internet access is optional and limited to explicitly enabled AI API operations rather than basic course viewing.

## ADDED Requirements

### Requirement: Compatible local ZIP import
The system SHALL import supported OpenMAIC `.maic.zip` packages using their existing manifest and media conventions, remap identities without breaking references, and publish successful imports in the local course library. Invalid manifests, unsupported versions, missing required indexed media, and unsafe archive paths MUST produce actionable errors without publishing a partial course or writing outside the data directory.

#### Scenario: Supported course package
- **WHEN** the user imports a valid formatVersion 1 package containing slides, actions, roster, and indexed media
- **THEN** the course appears in the local library with ordering and all corresponding media references preserved

#### Scenario: Broken or unsafe package
- **WHEN** a package contains missing required media, an unsupported format, or an unsafe path
- **THEN** import reports the problem and no partially playable course is published

### Requirement: Playback without AI configuration or internet
The system SHALL support local library browsing, opening courses, scene navigation, packaged narration/media playback, supported packaged interactive content, and local quiz interaction without AI credentials or public network access. Missing narration SHALL fall back to visible content without automatically invoking an online speech service.

#### Scenario: Complete package on a disconnected machine
- **WHEN** the prepared application runs with public network access blocked and no AI key, and the user imports and plays a self-contained package
- **THEN** all supported scenes and packaged media remain usable and no public network requests are attempted

#### Scenario: Course without narration
- **WHEN** a scene lacks packaged narration
- **THEN** its visual content and navigation remain usable without a speech-generation request

### Requirement: Local runtime resources
The installed application SHALL contain the scripts, styles, fonts, icons, and supported interactive dependency resources needed for basic playback. Import and playback MUST NOT download runtime resources from CDNs or fetch arbitrary external URLs. Course frames and backend resource handling SHALL enforce this boundary, including dynamic requests from embedded scripts.

#### Scenario: Known interactive dependency
- **WHEN** a supported interactive scene references a dependency supplied by the installation
- **THEN** that dependency resolves locally, including its supported nested imports, without contacting its former CDN

#### Scenario: Embedded script attempts remote request
- **WHEN** embedded course content attempts to load a remote image, script, font, or issue a remote connection
- **THEN** the public request is blocked rather than proxied or fetched automatically

### Requirement: Incomplete package diagnostics
The system SHALL identify unresolved external dependencies and show their affected scenes, resource types, and references. Such resources MUST remain blocked; the user SHALL be able to play unaffected content with a visible limitation instead of being told the entire package is fully offline-ready.

#### Scenario: Legacy course with remote-only resource
- **WHEN** a package references an image or interactive resource that is neither bundled nor available locally
- **THEN** the system reports the affected scene and resource, provides a visible fallback, and allows unaffected scenes to play without fetching the resource

### Requirement: Explicit optional AI network boundary
Only an explicit user AI operation SHALL initiate calls to configured AI API endpoints through the local backend. Course import, opening, playback, and navigation MUST NOT trigger AI calls, web search, cloud document parsing, online media generation, or telemetry. Course scripts MUST NOT gain an unrestricted public network proxy through AI endpoints.

#### Scenario: User asks classroom AI a question
- **WHEN** the user has configured an AI API and explicitly submits a question
- **THEN** the local backend calls the configured AI endpoint and stores supported conversation state locally

#### Scenario: AI endpoint unavailable
- **WHEN** an explicitly requested AI operation fails or lacks configuration
- **THEN** the system reports the AI failure while basic playback and local course data remain available

### Requirement: Player-focused local entry
The local default interface SHALL expose course import and the local library without requiring a generation workflow, account setup, or model setup. Unavailable generation/workbench features SHALL not appear as usable actions.

#### Scenario: First launch
- **WHEN** the user opens a fresh local installation
- **THEN** the user can directly import a course ZIP and enter playback without configuring AI or completing a generation flow

### Requirement: Standalone Windows desktop distribution
The system SHALL provide a Windows x64 desktop installer with an independent application window and bundled runtime. Users MUST NOT need Node.js, Docker, PostgreSQL, or a separately installed browser to launch the player. User data SHALL live outside the installation directory and survive upgrades. Closing the application SHALL stop its local service.

#### Scenario: Launch on a clean Windows machine
- **WHEN** a user installs and launches the desktop application on supported Windows without development runtimes
- **THEN** the course library opens in its own window and supports local ZIP import

#### Scenario: Upgrade preserves imported courses
- **WHEN** the application is upgraded with an existing user data directory
- **THEN** imported courses, local media, and learner records remain available

#### Scenario: Exit releases local service
- **WHEN** the user closes the application
- **THEN** the bundled backend stops and no orphaned listener remains
