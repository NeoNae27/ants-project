# Agent.md

Короткая карта проекта для следующих Codex-заходов. Сначала используй этот файл как навигацию, но перед рискованными изменениями сверяй детали с исходниками.

- Project root: `C:\Users\nikit\Documents\Master Degree Project\ants-app`
- Updated: `2026-06-20`
- App: desktop simulator for ANTS / Device Network Simulator.
- Current state: Electron + React workspace MVP with a TypeScript engine domain, runtime workspace/session layer, standalone simulation clock/event queue primitives, module factories, endpoint-based device registry, LoRa possible-link visualization, debug views, and expanded workspace validation.

## Stack And Commands

- Runtime/tooling: Node.js, npm, TypeScript, Electron, electron-vite, React 19.
- Package manager: npm (`package-lock.json` exists).
- Tests: Node built-in test runner plus `tsc -p tsconfig.tests.json`.
- Renderer talks to main through preload IPC; main owns the live `WorkspaceSessionManager`.

Common commands from `package.json`:

- `npm run dev` - start electron-vite dev mode.
- `npm run start` - preview built app.
- `npm run typecheck` - run node and web TypeScript checks.
- `npm run build` - typecheck and build Electron main/preload/renderer.
- `npm run test:device-core` - `DeviceCore` tests.
- `npm run test:device-factory` - `DeviceFactory` tests.
- `npm run test:module-factory` - `ModuleFactory` / `StubModule` tests.
- `npm run test:registry` - endpoint-based `DeviceRegistry` tests.
- `npm run test:spatial` - `SpatialGrid` tests.
- `npm run test:workspace` - engine `Workspace` tests.
- `npm run test:workspace-session` - `WorkspaceSession` and `WorkspaceSessionManager` tests.
- `npm run test:workspace-connections` - renderer-level pure connection helpers.
- `npm run test:event-queue` - runtime `EventQueue` tests.
- `npm run test:simulation-clock` - runtime `SimulationClock` and simulation session manager tests.
- `npm run test:types` - type-level tests.

## What Is Ready

- Electron shell:
  - `src/main/index.ts` creates a `1280x720` window.
  - `src/main/menu/applicationMenu.ts` defines native menu commands: project/workspace/edit/view/debug actions.
  - `src/main/workspace/workspaceIpc.ts` registers `workspace:dispatch`.
  - `src/main/simulation/simulationIpc.ts` registers `simulation:dispatch`.
  - `src/preload/index.ts` exposes `window.api.workspace.dispatch(command)`, `window.api.simulation.dispatch(command)`, plus menu event subscriptions.
  - Simulation menu supports start/pause/stop/reset, speed x1/x5/x10, advance +1s, and clock snapshot debug output.

- UI workspace:
  - `src/renderer/src/App.tsx` no longer owns the canonical device list. It holds presentation state plus the latest `WorkspaceSnapshot`.
  - Mutating UI actions dispatch `WorkspaceCommand` through IPC and apply `WorkspaceCommandResult`.
  - Renderer presentation state still includes selected device id, camera/zoom/pan, dialogs, cursor placement, collapsible side panels, and debug toggles.
  - `WorkspaceView.tsx` renders left navigator, central dotted workspace, device drag, zoom/pan, possible links, right inspector, and bottom status bar.
  - Bottom status bar shows workspace size, unit scale, zoom, visible link count, and simulation clock state/time/speed.
  - View menu can toggle a LoRa spatial-grid overlay on the workspace.
  - `DeviceInspector.tsx` can add modules, remove modules, and edit LoRa settings including SF, coding rate, bandwidth, tx power, max range, and `maxConnections`.

- Application/session layer:
  - `src/engine/application/workspace/WorkspaceSessionManager.ts` owns the live `WorkspaceSession | null`.
  - `WorkspaceSessionManager.dispatch(command)` always returns `WorkspaceCommandResult`, not raw snapshots.
  - `src/engine/application/workspace/WorkspaceSession.ts` is the application/controller layer for editing a project.
  - `WorkspaceSession` implements create project, add/move/delete device, add/update/remove module, assign LoRa endpoint address, copy/paste, validate, get snapshot, and get spatial-index debug data.
  - `WorkspacePlacementService` handles UX placement rules: free position near desired point, paste offsets/collision avoidance.
  - `src/engine/application/simulation/SimulationRuntimeSessionManager.ts` owns the main-process `SimulationClock`.
  - Creating a new workspace through `workspace:dispatch` resets simulation clock time and speed to defaults.

- Runtime simulation primitives:
  - `src/engine/runtime/events` contains standalone `EventQueue`, `InMemoryEventQueue`, event types, event priorities, snapshot DTOs, and typed errors.
  - `EventQueue` stores scheduled events only, orders by `scheduledAt`, `priority`, then stable `sequence`, and returns processed copies from `popDueEvents`.
  - `src/engine/runtime/clock` contains standalone `SimulationClock`, speed constants, snapshots, and typed errors.
  - `SimulationClock` stores virtual time in milliseconds, supports start/pause/stop/reset, speed x1/x5/x10, and advances only through explicit `advance(deltaRealMs)` calls. It does not use timers and does not know about `EventQueue`.

- Shared command contracts:
  - `src/shared/workspaceSession.ts` defines `WorkspaceCommand`, command variants, `WorkspaceCommandResult`, events, module templates, module patches, validation mode, and debug result DTO hooks.
  - `src/shared/simulationRuntime.ts` defines simulation commands/results and clock snapshot/speed DTO exports.
  - Renderer/main/preload share these DTO types.

- Engine workspace:
  - `src/engine/domain/workspace/Workspace.ts` owns low-level domain invariants and atomically coordinates placement, registry, and spatial index.
  - `Workspace` owns device positions. `DeviceRegistry` does not own coordinates.
  - `Workspace.addDevice`, `moveDevice`, `removeDevice`, `addModule`, `removeModule`, `updateLoRaModuleConfig`, `updateStubModuleConfig`, `assignModuleEndpoint`, `findNearbyDevices`, `assignDeviceLoRaAddress`, `getSnapshot`, `getSpatialIndexSnapshot`, and `validate` are implemented.
  - `Workspace.getRegistryQueries()` returns a read-only query port, not a mutable registry.
  - `WorkspaceSnapshot` is serializable DTO data, not `DeviceCore`, `Map`, `Set`, or spatial internals.
  - `Workspace.validate()` checks registry/placement/spatial consistency, endpoint/module consistency, position bounds, duplicate endpoint addresses, possible connection sanity, and optional network-level gateway reachability.

- Device registry:
  - `DeviceRegistry` is now endpoint-based, not "one address per device".
  - Main indexes: `devicesById`, `devicesByRole`, `modulesById`, `modulesByDeviceId`, `endpointsByAddress`, `endpointsByModuleId`, `endpointsByDeviceId`.
  - `NetworkEndpoint = { deviceId, moduleId, protocol, address }`.
  - Protocols currently include `lora | wifi | ble | custom`.
  - LoRa address is attached to a module endpoint, not directly to a device.
  - Compatibility/query helpers still exist for LoRa-oriented lookups such as `getByLoRaAddress` and `getLoRaAddress`.

- Spatial domain:
  - `SpatialGrid` supports insert/update/remove, position lookup, circular nearby search, distance in units/meters, stats, bounds validation, and typed errors.
  - `Workspace.findNearbyDevices(deviceId, rangeMeters)` explicitly converts meters to workspace units and excludes the source device.
  - `WorkspaceSpatialIndexSnapshot` exposes serializable debug data: workspace config, spatial stats, device entries, cell keys, placement/spatial positions, and consistency flag.

- Device/module domain:
  - `DeviceCore` stores identity, model/version, role, lifecycle/execution state, config, metadata, modules, and a bounded message buffer.
  - `DeviceFactory.createDevice()` creates generic devices; `createNode()` remains for node defaults/back-compat.
  - `ModuleFactory` creates real `LoRaModule` for LoRa templates and `StubModule` for sensor/power/compute/storage/non-LoRa placeholders.
  - `LoRaModule` stores LoRa radio/mesh config, runtime state, inbound/outbound buffers, builds packets, and does not deliver packets.
  - LoRa config includes `maxRangeMeters` and `maxConnections` (default `8`) for limiting possible outgoing link candidates.

## Domain Map

### `src/engine/application/workspace`

Application/controller layer for workspace editing.

- `WorkspaceSessionManager.ts` - main-process live session owner and command forwarder.
- `WorkspaceSession.ts` - command dispatcher and editing controller over `Workspace`, `DeviceFactory`, `ModuleFactory`, placement service, and clipboard DTO.
- `WorkspacePlacementService.ts` - UX placement helper; domain bounds remain in `Workspace`.
- `WorkspaceSessionErrors.ts` - typed application/session errors.
- `index.ts` - barrel export.

### `src/engine/application/simulation`

Application/controller layer for simulation runtime controls.

- `SimulationRuntimeSessionManager.ts` - main-process owner of `SimulationClock`; dispatches simulation commands and exposes reset for new workspace.
- `index.ts` - barrel export.

### `src/engine/runtime`

Standalone simulation runtime primitives.

- `clock/*` - `SimulationClock`, speed constants, snapshots, and typed errors.
- `events/*` - `EventQueue` contract, `InMemoryEventQueue`, event DTOs/priorities/snapshots, and typed errors.
- `index.ts` - exports both `clock` and `events`.

### `src/engine/domain/workspace`

Domain workspace and serializable snapshots.

- `Workspace.ts` - owner of placement and atomic coordination between `DeviceRegistry`, `SpatialGrid`, and `placementIndex`.
- `WorkspaceTypes.ts` - config, positions, snapshots, module DTOs, possible connections, spatial debug DTOs, validation options/issues, registry query port.
- `WorkspaceMappers.ts` - copies `DeviceCore`/module public data into serializable workspace DTOs.
- `WorkspaceErrors.ts` - typed workspace errors.
- `index.ts` - barrel export.

### `src/engine/domain/registry`

Runtime in-memory indexes over `DeviceCore`, modules, and network endpoints.

- `DeviceRegistry.ts` - device/module/endpoint indexes and query methods.
- `DeviceRegistryTypes.ts` - `NetworkEndpoint`, protocol/address/module/device types.
- `DeviceRegistryErrors.ts` - typed registry errors.
- `index.ts` - barrel export.

### `src/engine/domain/spatial`

Spatial index for workspace units.

- `spatial-grid.ts` - grid-backed spatial index implementation.
- `spatial-index.ts` - interface.
- `spatial.types.ts` - position/search/stat types.
- `spatial-errors.ts` - typed spatial errors.

### `src/engine/domain/device`

Core simulated device model.

- `DeviceCore.ts` - aggregate root for simulated device identity/state/modules/buffer.
- `DeviceFactory.ts` - creates generic devices and default nodes.
- `DeviceConfig.ts`, `DeviceMeta.ts`, `DeviceMessage.ts`, `DeviceSnapshot.ts` - DTO/config/message types.
- `DeviceRole.ts`, `DeviceLifecycleState.ts`, `DeviceExecutionState.ts`, `DeviceTransitions.ts` - state/role model.
- `DeviceErrors.ts`, `DeviceValidation.ts`, `DeviceBuffer.ts` - errors and supporting contracts.

### `src/engine/domain/module` and `src/engine/domain/modules`

Generic module contracts and concrete/current module implementations.

- `module/DeviceModule.ts` - minimal module interface used by `DeviceCore`.
- `module/BaseModule.ts` - richer config/buffer module shape.
- `module/ModuleKind.ts`, lifecycle/execution enums, errors.
- `modules/ModuleFactory.ts` - creates real LoRa or stub modules from UI/session templates.
- `modules/StubModule.ts` - serializable placeholder module for non-real implementations.
- `modules/network/lora/*` - concrete LoRa module, profiles, regions, runtime state, packet/config types.

### `src/shared`

Cross-process DTO types.

- `workspaceSession.ts` - `WorkspaceCommand`, `WorkspaceCommandResult`, command payloads, session events, module template/patch DTOs, validation mode, and debug DTO envelope.
- `simulationRuntime.ts` - `SimulationCommand`, `SimulationCommandResult`, clock speed/snapshot DTOs.
- Debug-capable command/result flow includes `workspace/get-spatial-index-debug` and `WorkspaceCommandResult.debug.spatialIndex`.

### `src/main`, `src/preload`, `src/renderer`

Electron and UI.

- `src/main/index.ts` - app/window setup, creates workspace and simulation managers, registers IPC, installs menu.
- `src/main/menu/applicationMenu.ts` - native menu triggers.
- `src/main/workspace/workspaceIpc.ts` - `workspace:dispatch` handler.
- `src/main/simulation/simulationIpc.ts` - `simulation:dispatch` handler.
- `src/preload/index.ts` and `index.d.ts` - safe bridge for workspace/simulation dispatch and menu subscriptions.
- `src/renderer/src/App.tsx` - snapshot-driven composition and menu/shortcut handling.
- `src/renderer/src/workspace/*` - UI components, dialogs, view types, and legacy pure connection helpers/tests.

## Current UI Behavior

- On startup, renderer dispatches `workspace/create-project` for a default `1000 x 1000` workspace with `10 m/unit`.
- Creating a new project resets simulation time to `0`, state to `stopped`, and speed to `x1`.
- New Project opens a dialog and dispatches create-project.
- Add Device dispatches add-device with desired position. Session chooses final free placement.
- Ctrl+D adds at cursor; menu add uses camera center.
- Devices can be selected, dragged, copied/pasted, and deleted through session commands.
- Modules can be added, edited, and removed through session commands from the right inspector.
- Side panels show devices, possible LoRa links, device details, modules, config, and stats.
- Possible LoRa links are runtime-derived from snapshot/device/module/position data; no real connection state is persisted.
- View menu can toggle visual LoRa spatial-grid overlay.
- Debug menu can enable logs, show a devices register view in console, and show a spatial index debug view in console.
- Simulation menu can start/pause/stop/reset the clock, set speed, advance by one second, and show a clock snapshot in console.
- Simulation shortcuts: `F5` start, `F6` pause, `Shift+F5` stop, `CmdOrCtrl+Shift+F5` reset, `CmdOrCtrl+Alt+1/5/0` speed x1/x5/x10, `F10` advance +1s, `CmdOrCtrl+Alt+T` show clock snapshot.

## Important Architecture Rules

- UI should display state and send commands; it should not be the source of simulation/domain truth.
- Canonical workspace/device/module/endpoint state lives behind `WorkspaceSessionManager` in Electron main.
- `WorkspaceSession` handles application-level editing commands and returns `WorkspaceCommandResult`.
- `Workspace` owns low-level placement/module/endpoint/domain invariants and atomic updates.
- `DeviceRegistry` is runtime-only and endpoint-based. Do not reintroduce a single `device -> address` model.
- Device position is owned by `Workspace`, not `DeviceRegistry` or `DeviceCore`.
- Module mutation should go through `Workspace.addModule/removeModule/updateLoRaModuleConfig/updateStubModuleConfig`; avoid mutating `DeviceCore` modules from `WorkspaceSession` or UI.
- `DeviceCore` remains transport-agnostic.
- `LoRaModule` only creates/holds packets and buffers. Delivery belongs to future `WirelessMedium`.
- `WorkspaceSnapshot` must stay serializable and independent from internal maps/classes.

## Tests

- `tests/device/DeviceCore.test.ts` - device behavior and guards.
- `tests/device/DeviceFactory.test.ts` - factory defaults and module attachment.
- `tests/modules/ModuleFactory.test.ts` - LoRa module and stub module creation.
- `tests/registry/DeviceRegistry.test.ts` - device/module/network endpoint indexes.
- `tests/spatial/SpatialGrid.test.ts` - spatial index behavior.
- `tests/workspace/Workspace.test.ts` - atomic workspace + registry/spatial/placement/module/endpoint/debug/validation behavior.
- `tests/workspace/WorkspaceSession.test.ts` - command result envelope, session manager, add/move/delete/module/address/copy/paste/link/debug behavior.
- `tests/workspace/WorkspaceConnections.test.ts` - renderer pure helper behavior.
- `tests/runtime/EventQueue.test.ts` - event queue scheduling, ordering, cancellation, snapshots, validation, and event priorities.
- `tests/runtime/SimulationClock.test.ts` - simulation clock behavior and `SimulationRuntimeSessionManager` dispatch.
- `tests/types/DeviceSnapshot.test-d.ts` - type-level device snapshot checks.

## Planned But Not Implemented Yet

- Full `SimulationEngine`, `SimulationSession`, `WirelessMedium`, `ChannelModel`, and `MetricsCollector`.
- Integration between `SimulationClock`, `EventQueue`, and future event dispatch loop.
- Actual packet delivery, RSSI/SNR/path loss, interference, collisions, routing, telemetry generation.
- Persistence/save/load/import/export.
- Real sensor/power/compute/storage modules beyond `StubModule`.
- Backend integration for telemetry ingest.

## Gaps And Cautions

- Several files are in active development and may be untracked/dirty in git; do not revert unrelated user changes.
- `DeviceCore.getSnapshot()` still returns module objects directly; workspace snapshots use `WorkspaceMappers` instead.
- `WorkspaceConnections.test.ts` covers legacy renderer helpers; canonical possible links now come from `WorkspaceSession.getSnapshot()`.
- `assignDeviceLoRaAddress` needs a LoRa-capable module; without a module endpoint target it should fail rather than creating a device-level address.
- `maxConnections` limits displayed/derived outgoing LoRa candidates, not real network capacity or packet routing.
- `SimulationClock` is deterministic/manual: it advances only via explicit commands, not by wall-clock timers.
- `EventQueue` only stores scheduled future events; cancelled events are removed, and processed status is returned on popped copies.
- `Workspace.validate()` defaults to project mode. Use `workspace.validate({ mode: 'network' })` or `workspace/validate-project` with `mode: 'network'` when gateway/path checks should apply.
- Spatial index console output is debug DTO data from engine/session, not a renderer-owned source of truth.
- No database or JSON persistence layer exists yet.

## Useful Docs Outside `ants-app`

Relevant notes in the parent workspace:

- `device-network-simulator-tech-stack-for-codex.md` - target architecture, tech stack, MVP scope, module boundaries, simulation rules.
- `2.4.4 Поток данных в сети устройств.md` - thesis text for device telemetry flow between Sensor Node, mesh network, Gateway, and backend.
