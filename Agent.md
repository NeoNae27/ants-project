# Agent.md

Короткая карта проекта для следующих Codex-заходов. Сначала используй этот файл как навигацию, но перед рискованными изменениями сверяй детали с исходниками.

- Project root: `C:\Users\nikit\Documents\Master Degree Project\ants-app`
- Updated: `2026-06-20`
- App: desktop simulator for ANTS / Device Network Simulator.
- Current state: Electron + React workspace MVP with a TypeScript engine domain, runtime workspace session layer, module factories, endpoint-based device registry, and LoRa possible-link visualization.

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
- `npm run test:types` - type-level tests.

## What Is Ready

- Electron shell:
  - `src/main/index.ts` creates a `1280x720` window.
  - `src/main/menu/applicationMenu.ts` defines native menu commands: project/workspace/edit/debug actions.
  - `src/main/workspace/workspaceIpc.ts` registers `workspace:dispatch`.
  - `src/preload/index.ts` exposes `window.api.workspace.dispatch(command)` plus menu event subscriptions.

- UI workspace:
  - `src/renderer/src/App.tsx` no longer owns the canonical device list. It holds presentation state plus the latest `WorkspaceSnapshot`.
  - Mutating UI actions dispatch `WorkspaceCommand` through IPC and apply `WorkspaceCommandResult`.
  - Renderer presentation state still includes selected device id, camera/zoom/pan, dialogs, cursor placement, collapsible side panels, and debug toggles.
  - `WorkspaceView.tsx` renders left navigator, central dotted workspace, device drag, zoom/pan, possible links, right inspector, and bottom status bar.
  - `DeviceInspector.tsx` can add modules and edit LoRa settings including SF, coding rate, bandwidth, tx power, max range, and `maxConnections`.

- Application/session layer:
  - `src/engine/application/workspace/WorkspaceSessionManager.ts` owns the live `WorkspaceSession | null`.
  - `WorkspaceSessionManager.dispatch(command)` always returns `WorkspaceCommandResult`, not raw snapshots.
  - `src/engine/application/workspace/WorkspaceSession.ts` is the application/controller layer for editing a project.
  - `WorkspaceSession` implements create project, add/move/delete device, add/update module, assign LoRa endpoint address, copy/paste, validate, and get snapshot.
  - `WorkspacePlacementService` handles UX placement rules: free position near desired point, paste offsets/collision avoidance.

- Shared command contracts:
  - `src/shared/workspaceSession.ts` defines `WorkspaceCommand`, command variants, `WorkspaceCommandResult`, events, module templates, and patches.
  - Renderer/main/preload share these DTO types.

- Engine workspace:
  - `src/engine/domain/workspace/Workspace.ts` owns low-level domain invariants and atomically coordinates placement, registry, and spatial index.
  - `Workspace` owns device positions. `DeviceRegistry` does not own coordinates.
  - `Workspace.addDevice`, `moveDevice`, `removeDevice`, `findNearbyDevices`, `assignDeviceLoRaAddress`, `getSnapshot`, `validate` are implemented.
  - `Workspace.getRegistryQueries()` returns a read-only query port, not a mutable registry.
  - `WorkspaceSnapshot` is serializable DTO data, not `DeviceCore`, `Map`, `Set`, or spatial internals.

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

### `src/engine/domain/workspace`

Domain workspace and serializable snapshots.

- `Workspace.ts` - owner of placement and atomic coordination between `DeviceRegistry`, `SpatialGrid`, and `placementIndex`.
- `WorkspaceTypes.ts` - config, positions, snapshots, module DTOs, possible connections, registry query port.
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

- `workspaceSession.ts` - `WorkspaceCommand`, `WorkspaceCommandResult`, command payloads, session events, module template/patch DTOs.

### `src/main`, `src/preload`, `src/renderer`

Electron and UI.

- `src/main/index.ts` - app/window setup, creates `WorkspaceSessionManager`, registers IPC, installs menu.
- `src/main/menu/applicationMenu.ts` - native menu triggers.
- `src/main/workspace/workspaceIpc.ts` - `workspace:dispatch` handler.
- `src/preload/index.ts` and `index.d.ts` - safe bridge for workspace dispatch and menu subscriptions.
- `src/renderer/src/App.tsx` - snapshot-driven composition and menu/shortcut handling.
- `src/renderer/src/workspace/*` - UI components, dialogs, view types, and legacy pure connection helpers/tests.

## Current UI Behavior

- On startup, renderer dispatches `workspace/create-project` for a default `1000 x 1000` workspace with `10 m/unit`.
- New Project opens a dialog and dispatches create-project.
- Add Device dispatches add-device with desired position. Session chooses final free placement.
- Ctrl+D adds at cursor; menu add uses camera center.
- Devices can be selected, dragged, copied/pasted, and deleted through session commands.
- Side panels show devices, possible LoRa links, device details, modules, config, and stats.
- Possible LoRa links are runtime-derived from snapshot/device/module/position data; no real connection state is persisted.
- Debug menu can enable logs and show a devices register view in console.

## Important Architecture Rules

- UI should display state and send commands; it should not be the source of simulation/domain truth.
- Canonical workspace/device/module/endpoint state lives behind `WorkspaceSessionManager` in Electron main.
- `WorkspaceSession` handles application-level editing commands and returns `WorkspaceCommandResult`.
- `Workspace` owns low-level placement/domain invariants and atomic updates.
- `DeviceRegistry` is runtime-only and endpoint-based. Do not reintroduce a single `device -> address` model.
- Device position is owned by `Workspace`, not `DeviceRegistry` or `DeviceCore`.
- `DeviceCore` remains transport-agnostic.
- `LoRaModule` only creates/holds packets and buffers. Delivery belongs to future `WirelessMedium`.
- `WorkspaceSnapshot` must stay serializable and independent from internal maps/classes.

## Tests

- `tests/device/DeviceCore.test.ts` - device behavior and guards.
- `tests/device/DeviceFactory.test.ts` - factory defaults and module attachment.
- `tests/modules/ModuleFactory.test.ts` - LoRa module and stub module creation.
- `tests/registry/DeviceRegistry.test.ts` - device/module/network endpoint indexes.
- `tests/spatial/SpatialGrid.test.ts` - spatial index behavior.
- `tests/workspace/Workspace.test.ts` - atomic workspace + registry/spatial/placement behavior.
- `tests/workspace/WorkspaceSession.test.ts` - command result envelope, session manager, add/move/delete/module/address/copy/paste/link behavior.
- `tests/workspace/WorkspaceConnections.test.ts` - renderer pure helper behavior.
- `tests/types/DeviceSnapshot.test-d.ts` - type-level device snapshot checks.

## Planned But Not Implemented Yet

- `SimulationSession`, `EventQueue`, `SimulationClock`, virtual time, `WirelessMedium`, `ChannelModel`, and `MetricsCollector`.
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
- No database or JSON persistence layer exists yet.

## Useful Docs Outside `ants-app`

Relevant notes in the parent workspace:

- `device-network-simulator-tech-stack-for-codex.md` - target architecture, tech stack, MVP scope, module boundaries, simulation rules.
- `2.4.4 Поток данных в сети устройств.md` - thesis text for device telemetry flow between Sensor Node, mesh network, Gateway, and backend.
