# Agent.md

Короткая карта проекта для следующих Codex-заходов. Сначала используй этот файл как навигацию, но перед рискованными изменениями сверяй детали с исходниками.

- Project root: `C:\Users\nikit\Documents\Master Degree Project\ants-app`
- Updated: `2026-06-19`
- App: desktop simulator for ANTS / Device Network Simulator.
- Current state: early Electron + React shell with a developed TypeScript domain model for devices, modules, and LoRa packets.

## Stack And Commands

- Runtime/tooling: Node.js, npm, TypeScript, Electron, electron-vite, React.
- UI: React 19 renderer under `src/renderer`; currently almost empty.
- Tests: Node built-in test runner plus `tsc` compilation for test builds.
- Package manager: npm (`package-lock.json` exists).

Common commands from `package.json`:

- `npm run dev` - start electron-vite dev mode.
- `npm run start` - preview built app.
- `npm run typecheck` - run node and web TypeScript checks.
- `npm run test:device-core` - compile and run `DeviceCore` tests.
- `npm run test:device-factory` - compile and run `DeviceFactory` tests.
- `npm run test:types` - compile type-level tests.
- `npm run build` - typecheck and build.
- `npm run build:win`, `npm run build:mac`, `npm run build:linux` - package per OS.

## What Is Ready

- Electron application skeleton is present:
  - `src/main/index.ts` creates a `1280x720` `BrowserWindow`, loads Vite dev URL in development and renderer HTML in production, wires basic `ping` IPC log.
  - `src/preload/index.ts` exposes Electron Toolkit API and an empty custom `api` object.
  - `src/renderer/src/App.tsx` currently renders an empty fragment.

- Device domain is the most complete implemented area:
  - `DeviceCore` stores identity, model/version, role, lifecycle state, execution state, config, metadata, attached modules, and a bounded internal message buffer.
  - `DeviceCore` validates required fields and config intervals/retries.
  - Lifecycle transitions are table-driven through `allowedDeviceTransitions`.
  - Successful lifecycle transitions write log messages into the internal device buffer.
  - Decommissioned devices block role changes, config changes, module changes, and execution state changes.
  - Snapshots return copies for config/meta/buffer so simple external mutation does not leak back into the device.

- Factory support exists:
  - `DeviceFactory.createNode()` creates a `DeviceRole.NODE` device with default heartbeat/transmission/retry/power config and x/y location.
  - It can attach `DeviceModule` implementations at creation time.

- Module contracts exist:
  - `DeviceModule` is the minimal interface used by `DeviceCore`.
  - `BaseModule<TConfig, TBufferItem>` extends it with config, buffer, lifecycle, and execution operations.
  - Module categories are represented by `ModuleKind`: `network`, `sensor`, `power`, `compute`, `storage`.
  - Module lifecycle/execution enums and `ModuleDomainError` are defined.

- LoRa network module exists as a first concrete module:
  - `LoRaModule` stores radio/mesh config, lifecycle state, execution state, LoRa runtime state, inbound packet buffer, and outbound message buffer.
  - It creates outbound messages, builds `LoRaPacket` objects, and supports `sendUnconfirmed()`.
  - It can receive packets into its inbound buffer if state allows reception.
  - It deliberately does not deliver packets between devices; delivery is reserved for a future `WirelessMedium`.
  - LoRa types cover profiles, regions, radio config, mesh options, outbound messages, packets, and send results.

- Tests exist for implemented device behavior:
  - `tests/device/DeviceCore.test.ts` covers snapshots, module add/remove errors, lifecycle transitions, buffer capacity/draining, invalid config, and decommission guards.
  - `tests/device/DeviceFactory.test.ts` covers node defaults, unnamed node behavior, lifecycle logging, and module attachment.
  - `tests/types/DeviceSnapshot.test-d.ts` checks the `DeviceInfo` type contract.

## Domain Map

### `src/engine/domain/device`

Core simulated device model.

- `DeviceCore.ts` - aggregate root for a simulated device. Owns generic device state and module collection, but intentionally does not implement radio, sensor, battery, routing, or wireless delivery logic.
- `DeviceConfig.ts` - generic device config: heartbeat interval, transmission interval, max retries, power mode.
- `DeviceRole.ts` - network role: `node`, `repeater`, `gateway`.
- `DeviceLifecycleState.ts` - lifecycle stage: `new`, `commissioning`, `bound`, `provisioned`, `active`, `sleep`, `orphaned`, `fault`, `decommissioned`.
- `DeviceExecutionState.ts` - current execution activity: `idle`, `running`, `sleeping`, `paused`, `stopped`.
- `DeviceTransitions.ts` - allowed lifecycle transition table.
- `DeviceMessage.ts` - generic messages in the device internal buffer: telemetry, log, control, system.
- `DeviceMeta.ts` - timestamps, optional simulator/geographic location, tags, description.
- `DeviceSnapshot.ts` - DTO types for `DeviceInfo` and full snapshots.
- `DeviceFactory.ts` - currently only creates node devices.
- `DeviceErrors.ts` - typed domain error with machine-readable `code`.
- `DeviceBuffer.ts` - generic bounded queue shape, but `DeviceCore` still has an inline buffer implementation.

### `src/engine/domain/module`

Generic module model for device capabilities.

- `DeviceModule.ts` - minimal contract every module must satisfy for attachment to `DeviceCore`.
- `BaseModule.ts` - richer interface for modules with config and buffers.
- `ModuleKind.ts` - capability category enum.
- `ModuleLifecycleState.ts` - lifecycle for modules: `new`, `initialized`, `active`, `suspended`, `failed`, `decommissioned`.
- `ModuleExecutionState.ts` - current module activity: `idle`, `running`, `paused`, `stopped`.
- `ModuleErrors.ts` - typed module domain error.
- `index.ts` - barrel export for the module domain.

### `src/engine/domain/modules/network/lora`

Concrete LoRa / LoRa Mesh-oriented network module.

- `LoRaModule.ts` - creates messages and packets, tracks buffers and radio runtime state, and exposes a send/receive stub.
- `LoRaTypes.ts` - radio config, mesh config, outbound message, packet, and send result types.
- `LoRaProfile.ts` - `raw_lora`, `lorawan`, `lora_mesh`.
- `LoRaRegion.ts` - common regional profiles such as `eu868`, `eu433`, `us915`, `custom`.
- `LoRaRuntimeState.ts` - radio runtime states such as `sleep`, `standby`, `rx`, `tx`, `connected`, `degraded`, `error`.
- `index.ts` - barrel export for LoRa.

### Electron And UI Domains

- `src/main` - Electron main process only; no simulator services, persistence, project management, or backend integration yet.
- `src/preload` - bridge layer only; custom API is empty.
- `src/renderer` - React app shell only; no screens, topology canvas, controls, logs, metrics, or forms yet.

## Planned But Not Implemented Yet

The root project docs describe the intended Device Network Simulator / ANTS scope. Treat these as target architecture, not current code.

- Simulation core: `SimulationEngine`, `EventQueue`, virtual simulation time, `Workspace`, `SpatialGrid`, `DeviceRegistry`.
- Radio environment: `WirelessMedium`, channel model, range checks, latency, packet loss, ACK delivery, collisions/interference later.
- More modules: sensor, power, compute, storage implementations.
- Telemetry generation: periodic sensor payloads, noise, deterministic seed, backend-compatible schema.
- Persistence: SQLite project storage, repositories, import/export JSON.
- Backend integration: REST client for telemetry ingest, API key/token settings, dry-run mode, retries, integration logs.
- UI: project screen, workspace/topology view, device palette, inspector, simulation controls, event log, metrics, backend settings, scenario settings.
- Scenario system: failures, recovery, packet loss spikes, route recalculation, battery degradation, replay/snapshots.

## Design Rules From Docs

- Simulation time should be virtual and event-driven, not based on real timers for simulation logic.
- `DeviceCore` must remain transport-agnostic and should not contain LoRa, sensor, power, routing, or channel behavior.
- `LoRaModule` should only build/hold packets; packet delivery belongs to `WirelessMedium`.
- Telemetry should keep one logical payload contract for real and simulated devices.
- Device-network flow in the thesis notes: Sensor Node creates JSON telemetry, transport may serialize compactly for network delivery, mesh relays should not alter payload, Gateway deserializes/validates and sends to backend.
- Project data should eventually support JSON import/export; secrets should not be exported by default.

## Gaps And Cautions

- `DeviceCore.getSnapshot()` currently returns `modules: Array.from(this.modules.values())`; despite comments, it does not call `module.getSnapshot()`. Tests currently expect module objects in factory snapshots.
- `DeviceSnapshot.modules` type is `DeviceModuleSnapshot`, but tests and implementation treat it like an array; this type may need tightening before broader use.
- `DeviceValidation.ts` defines reusable validation result types, but `DeviceCore.validate()` currently uses an inline compatible shape.
- `DeviceBuffer.ts` exists but `DeviceCore` still keeps its buffer type inline.
- `LoRaModule` validation is boolean-only and lifecycle transitions are not restricted by a transition table yet.
- No LoRa tests are present yet.
- No SQLite dependency or persistence layer is present in `package.json`.
- UI is not functional yet; do not infer simulator behavior from renderer code.

## Useful Docs Outside `ants-app`

Relevant notes in the parent workspace:

- `device-network-simulator-tech-stack-for-codex.md` - target architecture, tech stack, MVP scope, module boundaries, simulation rules.
- `2.4.4 Поток данных в сети устройств.md` - thesis text for device telemetry flow between Sensor Node, mesh network, Gateway, and backend.

