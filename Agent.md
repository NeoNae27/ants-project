# Agent.md

Короткая карта проекта для следующих Codex-заходов. Сначала используй этот файл как навигацию, но перед рискованными изменениями сверяй детали с исходниками.

- Project root: `C:\Users\nikit\Documents\Master Degree Project\ants-app`
- Updated: `2026-06-21`
- App: desktop simulator for ANTS / Device Network Simulator.
- Current state: Electron + React workspace MVP with a TypeScript engine domain, runtime workspace/session layer, deterministic `SimulationEngine`, simulation clock, event queue/task queue UI, event dispatcher, WirelessMedium-based LoRa telemetry delivery, Gateway packet receive flow, device presets/icons/editable roles, module factories, endpoint-based device registry, LoRa possible-link visualization, runtime wireless link overlay, debug views, and expanded workspace validation.

## Stack And Commands

- Runtime/tooling: Node.js, npm, TypeScript, Electron, electron-vite, React 19.
- Package manager: npm (`package-lock.json` exists).
- Tests: Node built-in test runner plus `tsc -p tsconfig.tests.json`.
- Renderer talks to main through preload IPC; main owns the live `WorkspaceSessionManager` and `SimulationRuntimeSessionManager`.

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
- `npm run test:event-dispatcher` - runtime `EventDispatcher`, observers, demo handlers, and dispatch trace tests.
- `npm run test:simulation-engine` - runtime `SimulationEngine` and engine-backed simulation session manager tests.
- `npm run test:simulation-clock` - runtime `SimulationClock` and simulation session manager tests.
- `npm run test:telemetry-runtime-flow` - deterministic telemetry runtime handlers and schedule command tests.
- `npm run test:gateway-packet-receive-flow` - Gateway packet receive handler and end-to-end receive flow tests.
- `npm run test:types` - type-level tests.

## What Is Ready

- Electron shell:
  - `src/main/index.ts` creates a `1280x720` window.
  - `src/main/menu/applicationMenu.ts` defines native menu commands: project/workspace/edit/view/debug actions.
  - Workspace menu supports generic Add Device plus LoRa Sensor Node and LoRa Gateway presets.
  - `src/main/workspace/workspaceIpc.ts` registers `workspace:dispatch`.
  - `src/main/simulation/simulationIpc.ts` registers `simulation:dispatch`.
  - `src/preload/index.ts` exposes `window.api.workspace.dispatch(command)`, `window.api.simulation.dispatch(command)`, plus menu event subscriptions.
  - Simulation menu supports engine-backed start/pause/stop/reset, clock speed x1/x5/x10, advance +1s real time, basic telemetry scheduling, and clock snapshot debug output.

- UI workspace:
  - `src/renderer/src/App.tsx` no longer owns the canonical device list. It holds presentation state plus the latest `WorkspaceSnapshot`.
  - Mutating UI actions dispatch `WorkspaceCommand` through IPC and apply `WorkspaceCommandResult`.
  - Renderer presentation state still includes selected device id, camera/zoom/pan, dialogs, cursor placement, collapsible side panels, and debug toggles.
  - `WorkspaceView.tsx` renders left navigator, central dotted workspace, device drag, zoom/pan, possible links, right inspector, and bottom status bar.
  - Bottom status bar shows workspace size, unit scale, zoom, visible link count, and simulation clock state/time/speed.
  - View menu can toggle a LoRa spatial-grid overlay on the workspace.
  - Sensor and Gateway presets use dedicated SVG icons in the renderer assets.
  - `DeviceInspector.tsx` shows the runtime task queue, can add/remove modules, edit device role, and edit LoRa settings including SF, coding rate, bandwidth, tx power, max range, and `maxConnections`.
  - Renderer polls simulation snapshots for clock/queue/execution-log/radio-link updates and logs new execution batches to DevTools console.
  - The workspace can render runtime wireless links behind devices; possible links and runtime radio links are kept as separate concepts.
  - The links panel has toggles for runtime wireless links and debug labels.

- Application/session layer:
  - `src/engine/application/workspace/WorkspaceSessionManager.ts` owns the live `WorkspaceSession | null`.
  - `WorkspaceSessionManager.dispatch(command)` always returns `WorkspaceCommandResult`, not raw snapshots.
  - `src/engine/application/workspace/WorkspaceSession.ts` is the application/controller layer for editing a project.
  - `WorkspaceSession` implements create project, add/move/delete device, update device role, device presets, add/update/remove module, assign LoRa endpoint address, copy/paste, validate, get snapshot, runtime context export, and get spatial-index debug data.
  - `workspace/add-device` supports `WorkspaceDevicePreset = 'generic-node' | 'lora-sensor-node' | 'lora-gateway'`; explicit command fields override preset defaults.
  - `WorkspaceSession` validates LoRa address uniqueness for generated/provided addresses before adding preset/endpoints; duplicate preset addresses return `LORA_ADDRESS_ALREADY_EXISTS`.
  - `WorkspacePlacementService` handles UX placement rules: free position near desired point, paste offsets/collision avoidance.
  - `src/engine/application/simulation/SimulationRuntimeSessionManager.ts` owns the main-process `SimulationEngine`, `SimulationClock`, `InMemoryEventQueue`, `EventDispatcher`, and `WirelessMedium`.
  - `SimulationRuntimeSessionManager` composes default runtime handlers, receives runtime context from `WorkspaceSessionManager`, validates `simulation/schedule-basic-telemetry`, exposes queue snapshots/execution logs/runtime radio links, and can auto-step while simulation is running.
  - Auto-run is enabled in Electron main composition; tests/default construction keep it off unless explicitly requested.
  - Creating a new workspace through `workspace:dispatch` resets simulation engine state, queue, clock time, speed, and stored radio links to defaults.

- Runtime simulation primitives:
  - `src/engine/runtime/SimulationEngine.ts` coordinates deterministic runtime steps by advancing `SimulationClock`, popping due events from `EventQueue`, dispatching them through `EventDispatcher`, and returning structured step/run results.
  - `src/engine/runtime/events` contains standalone `EventQueue`, `InMemoryEventQueue`, `EventDispatcher`, dispatch traces/results, observers, event types, event priorities, snapshot DTOs, and typed errors.
  - `EventQueue` stores scheduled events only, orders by `scheduledAt`, `priority`, then stable `sequence`, and returns processed copies from `popDueEvents`.
  - `EventDispatcher` receives already-due events, resolves handlers by `event.type`, passes `DispatchContext`, records wall-clock handler execution metadata separately from simulation time, and returns per-event/batch dispatch results.
  - Dispatch errors use `EventDispatchError` with `severity: recoverable | fatal`; batch dispatch continues after recoverable failures and stops after fatal failures.
  - Dispatch observers include `ConsoleDispatchObserver` for CLI/debug visibility.
  - Simple runtime handlers exist for `simulation.noop` and `simulation.log`.
  - Default domain runtime handlers support `device.telemetry_sample`, `device.telemetry_send`, `wireless.packet_delivery`, `wireless.packet_lost`, `gateway.packet_received`, and `device.state_change`.
  - Telemetry flow is deterministic: sample generates telemetry from simulation time, send creates deterministic LoRa packets, `WirelessMedium` evaluates radio candidates, schedules existing `wireless.packet_delivery` for deliverable links, and schedules `wireless.packet_lost` for rejected evaluated links.
  - `wireless.packet_delivery` pushes the original LoRa packet into the target LoRa inbound buffer; Gateway targets then schedule `gateway.packet_received`.
  - `src/engine/runtime/radio/*` contains radio packet normalization, link snapshots, channel model contracts, path loss, link budget, `WirelessMedium`, `SimpleChannelModel`, and `LinkBudgetChannelModel`.
  - `toRadioPacketFromLoRaPacket(...)` maps `packetId -> id`, `radio.powerDbm -> radio.txPowerDbm`, and `radio.rangeMeters -> radio.candidateSearchRadiusMeters`, while preserving the original `LoRaPacket` in `meta.originalPacket`.
  - `LinkBudgetChannelModel` treats `candidateSearchRadiusMeters` as a hard simulation/passport range cap before compatibility and link-budget checks. Distances `<=` the cap continue to link-budget evaluation; distances `>` the cap return `lost / OUT_OF_RANGE`.
  - `SimulationEngine` accepts an optional `RuntimeContextProvider`; app/session composition passes workspace context without making the engine depend on `WorkspaceSessionManager`.
  - `src/engine/runtime/clock` contains standalone `SimulationClock`, speed constants, snapshots, and typed errors.
  - `SimulationClock` stores virtual time in milliseconds and is the source of simulation time. It exposes `getNowMs()`, `advanceBy(deltaMs)`, `setSpeed()`, `pause()`, `resume()`, `isPaused()`, and `reset()`. Legacy `start()` and `advance(deltaRealMs)` remain as compatibility aliases.
  - `SimulationClock` advances only through explicit calls, never timers, and does not know about `EventQueue` or `EventDispatcher`.

- Shared command contracts:
  - `src/shared/workspaceSession.ts` defines `WorkspaceCommand`, `WorkspaceDevicePreset`, command variants, `WorkspaceCommandResult`, events, module templates, module patches, validation mode, and debug result DTO hooks.
  - `src/shared/simulationRuntime.ts` defines simulation commands/results plus clock, engine, event queue, step result, telemetry scheduling, scheduled event ids, radio link snapshots, and execution log DTO exports.
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
  - `DeviceCore` and `DeviceFactory` use explicit simulation timestamps (`nowMs`) for metadata and lifecycle log messages; avoid wall-clock time inside simulation/domain state.
  - `DeviceFactory.createDevice()` creates generic devices; `createNode()` remains for node defaults/back-compat; `createGateway()` creates a `DeviceCore(role: GATEWAY)` without a Gateway subclass.
  - `ModuleFactory` creates real `LoRaModule` for LoRa templates and `StubModule` for sensor/power/compute/storage/non-LoRa placeholders.
  - `LoRaModule` stores LoRa radio/mesh config, runtime state, inbound/outbound buffers, builds packets, and does not deliver packets.
  - `LoRaModule.createMessage()` and `sendUnconfirmed()` accept explicit simulation timestamps for deterministic packet metadata.
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

- `SimulationRuntimeSessionManager.ts` - main-process owner of `SimulationEngine`, `SimulationClock`, `InMemoryEventQueue`, `EventDispatcher`, and `WirelessMedium`; dispatches simulation commands, schedules basic telemetry, tracks execution logs and radio links, optionally auto-steps when running, and exposes reset for new workspace.
- `index.ts` - barrel export.

### `src/engine/runtime`

Standalone simulation runtime primitives.

- `SimulationEngine.ts`, `SimulationEngineTypes.ts`, `SimulationEngineErrors.ts` - deterministic runtime coordinator, state/result DTOs, and engine-level errors.
- `clock/*` - `SimulationClock`, speed constants, snapshots, and typed errors.
- `events/*` - `EventQueue` contract, `InMemoryEventQueue`, `EventDispatcher`, dispatch result/trace/observer contracts, simple simulation handlers, event DTOs/priorities/snapshots, and typed errors.
- `events/handlers/*` - simple built-in handlers plus runtime telemetry, packet delivery, Gateway receive, and device state-change handlers.
- `events/RuntimeEventContext.ts` - runtime workspace/registry lookup helpers used by handlers; keep these generic ports, not session-manager imports.
- `events/RuntimeEventHandlerRegistry.ts` - default runtime handler map for telemetry/send/delivery/Gateway/state events.
- `radio/*` - `WirelessMedium`, `RadioPacket` normalization, `RadioLinkSnapshot`, channel model contracts, path loss, link budget, and LoRa channel model implementations.
- `index.ts` - exports runtime engine, clock, and events APIs.

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
- `simulationRuntime.ts` - `SimulationCommand`, `SimulationCommandResult`, clock speed/snapshot DTOs, engine/event queue/step DTOs, telemetry scheduling command, optional `radioLinks`, and execution log DTOs.
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
- Creating a new project resets simulation engine status to `idle`, clock time to `0`, clock state to `stopped`, queue to empty, and speed to `x1`.
- New Project opens a dialog and dispatches create-project.
- Add Device dispatches add-device with desired position. Add Sensor Node and Add Gateway dispatch the same command with presets. Session chooses final free placement.
- Ctrl+D adds at cursor; menu add uses camera center.
- Devices can be selected, dragged, copied/pasted, and deleted through session commands.
- Device role can be edited from the inspector through session commands.
- Modules can be added, edited, and removed through session commands from the right inspector.
- Side panels show devices, possible LoRa links, queued simulation tasks, device details, modules, config, and stats.
- Possible LoRa links are derived from snapshot/device/module/position data; runtime wireless links come from simulation command results as `radioLinks` and are not stored in `SimulationEngineSnapshot`.
- Runtime wireless links render behind devices with distinct reachable/weak/lost/invalid visual styles; debug labels are optional.
- View menu can toggle visual LoRa spatial-grid overlay.
- Debug menu can enable logs, show a devices register view in console, show a spatial index debug view in console, and show an event queue + event dispatch demo in console.
- The event dispatch debug demo schedules `simulation.noop` and `simulation.log`, pops due events, dispatches them, and prints queue snapshots, dispatch batch results, and dispatch traces.
- Simulation menu can start/pause/stop/reset the engine-backed runtime, set clock speed, advance by one real second through `SimulationEngine.step(deltaRealMs)`, schedule basic telemetry from the selected LoRa source to the first other Gateway LoRa target, and show a clock snapshot in console.
- When the simulation is running in the app, `SimulationRuntimeSessionManager` auto-steps the engine and processes queued tasks. Execution batches are logged through the runtime logger and surfaced to renderer console via polled `executions`.
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
- `LoRaModule` only creates/holds packets and buffers. Delivery belongs to `WirelessMedium`.
- Keep using the existing `wireless.packet_delivery` runtime event for successful wireless delivery; do not introduce a replacement event name for delivery.
- Failed evaluated wireless transmissions may schedule `wireless.packet_lost` with reason and link snapshot.
- Do not put runtime `radioLinks` into `SimulationEngineSnapshot`; expose them through `SimulationCommandResult.radioLinks`.
- On `simulation/reset` and `resetForNewWorkspace`, clear `WirelessMedium` links.
- Preserve the LoRa range chain: `LoRaModule.config.radio.maxRangeMeters -> LoRaPacket.radio.rangeMeters -> RadioPacket.radio.candidateSearchRadiusMeters -> ChannelModel.evaluate(...)`.
- Treat `maxRangeMeters` as a project/module-level simulation cap, not as the physical link budget itself. `LinkBudgetChannelModel` must reject `distanceMeters > candidateSearchRadiusMeters` as `OUT_OF_RANGE`; the link budget only decides reachability inside that cap.
- `WorkspaceSnapshot` must stay serializable and independent from internal maps/classes.
- `SimulationEngine` is a coordinator only: it must not branch on event types or implement LoRa/routing/wireless/backend logic.
- `SimulationEngine.step(deltaRealMs)` accepts real elapsed milliseconds; clock speed determines the resulting simulation-time delta.
- `SimulationRuntimeSessionManager` preserves old command names (`simulation/start`, `simulation/advance-clock`, etc.) but returns clock plus optional engine/step DTOs.
- `SimulationRuntimeSessionManager` is allowed to auto-step the engine in the app when running; keep auto-run out of `SimulationEngine` itself.
- Simulation time must come from `SimulationClock.getNowMs()` / explicit `nowMs` values passed by runtime code. Do not use `Date.now()` for simulation/domain timestamps.
- Wall-clock time is allowed only for runtime execution metadata such as `EventDispatcher` handler duration, and it must stay separate from simulation time fields.
- Runtime handlers should depend on `DispatchContext`/runtime lookup ports, not on app/session managers.
- Gateway remains `DeviceCore(role: GATEWAY)` plus modules/handlers; do not add a `GatewayDevice` subclass.

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
- `tests/runtime/EventDispatcher.test.ts` - handler lookup, context passing, traces, observers, recoverable/fatal errors, built-in simulation handlers, and demo dispatch scenario.
- `tests/runtime/SimulationEngine.test.ts` - engine start/pause/resume/stop/reset/step/runUntil behavior and engine-backed simulation session manager dispatch.
- `tests/runtime/SimulationClock.test.ts` - simulation clock behavior, deterministic time contract, speed/pause/resume semantics, and `SimulationRuntimeSessionManager` dispatch.
- `tests/runtime/RuntimeEventHandlers.test.ts` - deterministic telemetry, packet delivery, wireless fallback, and device state-change handlers.
- `tests/runtime/TelemetryRuntimeFlow.test.ts` - end-to-end telemetry queue/send/delivery flow, schedule-basic-telemetry command validation, and auto-run execution logging.
- `tests/runtime/GatewayPacketReceiveFlow.test.ts` - Gateway packet received handler, Gateway-only receive scheduling, and inbound/logging flow.
- `tests/runtime/RadioRuntime.test.ts` - radio packet normalization, path loss, link budget/channel compatibility, `WirelessMedium`, radio link snapshots, reset behavior, hard range cap, and out-of-range delivery regressions.
- `tests/types/DeviceSnapshot.test-d.ts` - type-level device snapshot checks.

## Planned But Not Implemented Yet

- Full `SimulationSession` and `MetricsCollector`.
- Real runtime scenarios beyond the current deterministic telemetry demo flow.
- Interference, collisions, terrain, routing, ADR, ACK/retry, packet deduplication, and richer LoRa physics beyond the current range cap plus link-budget model.
- Persistence/save/load/import/export.
- Real sensor/power/compute/storage modules beyond `StubModule`.
- Backend integration for telemetry ingest.

## Gaps And Cautions

- Several files are in active development and may be untracked/dirty in git; do not revert unrelated user changes.
- `DeviceCore.getSnapshot()` still returns module objects directly; workspace snapshots use `WorkspaceMappers` instead.
- `WorkspaceConnections.test.ts` covers legacy renderer helpers; canonical possible links now come from `WorkspaceSession.getSnapshot()`.
- `assignDeviceLoRaAddress` needs a LoRa-capable module; without a module endpoint target it should fail rather than creating a device-level address.
- `maxConnections` limits displayed/derived outgoing LoRa candidates, not real network capacity or packet routing.
- `maxRangeMeters` is a hard simulation/passport cap for delivery. Even if the link-budget math would theoretically pass beyond that distance, `LinkBudgetChannelModel` returns `OUT_OF_RANGE`.
- `SimulationClock` is deterministic/manual: it advances only via explicit commands, not by wall-clock timers. It is the source of simulation time for future runtime logic.
- `SimulationEngine` owns runtime state (`idle | running | paused | stopped | error`) separately from clock state and requires `reset()` before stepping again after engine-level errors.
- App-level auto-run is a `SimulationRuntimeSessionManager` concern enabled in Electron main; default tests can construct the manager with auto-run disabled.
- `EventQueue` only stores scheduled future events; cancelled events are removed, and processed status is returned on popped copies.
- `EventDispatcher` does not pop from `EventQueue` and does not advance time. It dispatches events that the caller already popped as due.
- `simulation.noop` and `simulation.log` are simple runtime/debug handlers. Domain demo handlers now live under namespaced runtime events such as `device.telemetry_sample`, `wireless.packet_delivery`, and `gateway.packet_received`.
- `schedule-basic-telemetry` is debug/demo behavior. Delivery still goes through `WirelessMedium`; direct target lookup is intentionally kept so explicit out-of-range Gateways can produce lost-link snapshots.
- `Workspace.validate()` defaults to project mode. Use `workspace.validate({ mode: 'network' })` or `workspace/validate-project` with `mode: 'network'` when gateway/path checks should apply.
- Spatial index console output is debug DTO data from engine/session, not a renderer-owned source of truth.
- No database or JSON persistence layer exists yet.

## Useful Docs Outside `ants-app`

Relevant notes in the parent workspace:

- `device-network-simulator-tech-stack-for-codex.md` - target architecture, tech stack, MVP scope, module boundaries, simulation rules.
- `2.4.4 Поток данных в сети устройств.md` - thesis text for device telemetry flow between Sensor Node, mesh network, Gateway, and backend.
