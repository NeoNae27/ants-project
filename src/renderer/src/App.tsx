import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DeviceRole } from '../../engine/domain/device/DeviceRole'
import type { WorkspaceSnapshot, WorkspaceSpatialIndexSnapshot } from '../../engine/domain/workspace'
import {
  ConsoleDispatchObserver,
  EventDispatcher,
  EventPriority,
  InMemoryEventQueue,
  NoopHandler,
  SimulationLogHandler,
  type EventDispatchBatchResult,
  type EventQueueSnapshot,
  type SimulationEvent
} from '../../engine/runtime/events'
import type {
  SimulationCommand,
  SimulationClockSnapshot,
  SimulationCommandResult,
  RadioLinkSnapshot,
  SimulationRuntimeExecutionLogEntry
} from '../../shared/simulationRuntime'
import type {
  WorkspaceCommandResult,
  WorkspaceDevicePreset
} from '../../shared/workspaceSession'
import { NewProjectDialog } from './workspace/NewProjectDialog'
import { WorkspaceView } from './workspace/WorkspaceView'
import type {
  AddDevicePlacement,
  WorkspaceDevice,
  WorkspaceModule,
  WorkspacePoint,
  WorkspaceProject,
  WorkspaceSpatialGridVisibility
} from './workspace/types'

const DEFAULT_PROJECT: WorkspaceProject = {
  id: 'pending-project',
  name: 'New project',
  width: 1000,
  height: 1000,
  unitScaleMeters: 10
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  )
}

function snapshotToProject(snapshot: WorkspaceSnapshot | null): WorkspaceProject {
  if (!snapshot) {
    return DEFAULT_PROJECT
  }

  return {
    id: snapshot.id,
    name: snapshot.name,
    width: snapshot.width,
    height: snapshot.height,
    unitScaleMeters: snapshot.metersPerUnit
  }
}

function snapshotToDevices(snapshot: WorkspaceSnapshot | null): WorkspaceDevice[] {
  if (!snapshot) {
    return []
  }

  return snapshot.devices.map((device) => ({
    id: device.id,
    name: device.info.name ?? device.id,
    model: device.info.model,
    role: device.info.role,
    status: device.info.lifecycleState,
    executionState: device.info.executionState,
    config: {
      heartbeatIntervalMs: device.config.heartbeatIntervalMs,
      transmissionIntervalMs: device.config.transmissionIntervalMs,
      maxRetries: device.config.maxRetries,
      powerMode: device.config.powerMode
    },
    modules: device.modules.map((module) => ({
      id: module.id,
      kind: module.kind,
      name: module.name,
      model: module.model,
      status: module.lifecycleState,
      communication: module.communication ? { ...module.communication } : undefined
    })),
    bufferSize: device.info.bufferSize,
    receivedPacketCount: device.info.receivedPacketCount,
    x: device.position.x,
    y: device.position.y
  }))
}

function moduleToTemplate(module: WorkspaceModule) {
  return {
    kind: module.kind,
    name: module.name,
    model: module.model,
    communication: module.communication ? { ...module.communication } : undefined
  }
}

type WorkspaceSnapshotDevice = WorkspaceSnapshot['devices'][number]

function getSnapshotLoRaAddress(device: WorkspaceSnapshotDevice): string | undefined {
  return (
    device.address ??
    device.networkEndpoints.find((endpoint) => endpoint.protocol === 'lora')?.address
  )
}

function getSnapshotLoRaModule(device: WorkspaceSnapshotDevice): WorkspaceSnapshotDevice['modules'][number] | undefined {
  return device.modules.find((module) => module.communication?.protocol === 'lora')
}

function hasSnapshotLoRaModule(device: WorkspaceSnapshotDevice): boolean {
  return Boolean(getSnapshotLoRaModule(device))
}

function createDefaultLoRaAddress(device: WorkspaceSnapshotDevice): string {
  return `${device.id}:lora`
}

function findBasicTelemetryGatewayTarget(
  snapshot: WorkspaceSnapshot,
  sourceDeviceId: string
): WorkspaceSnapshotDevice | undefined {
  for (const device of snapshot.devices) {
    if (device.id === sourceDeviceId || device.info.role !== DeviceRole.GATEWAY) {
      continue
    }

    if (hasSnapshotLoRaModule(device)) {
      return device
    }
  }

  return undefined
}

function createDevicesRegisterView(devices: WorkspaceDevice[]): Array<Record<string, string | number>> {
  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    model: device.model,
    role: device.role,
    status: device.status,
    state: device.executionState,
    x: device.x,
    y: device.y,
    modules: device.modules.length,
    lora:
      device.modules.find((module) => module.communication?.protocol === 'lora')?.communication
        ?.sourceLabel ?? 'none'
  }))
}

function createSpatialIndexEntriesView(
  spatialIndex: WorkspaceSpatialIndexSnapshot
): Array<Record<string, string | number | boolean>> {
  return spatialIndex.entries.map((entry) => ({
    deviceId: entry.deviceId,
    name: entry.name ?? '',
    role: entry.role,
    placementX: entry.placementPosition?.x ?? '',
    placementY: entry.placementPosition?.y ?? '',
    spatialX: entry.spatialPosition?.x ?? '',
    spatialY: entry.spatialPosition?.y ?? '',
    cell: entry.cell?.key ?? 'missing',
    consistent: entry.consistent
  }))
}

function createSpatialIndexCellsView(
  spatialIndex: WorkspaceSpatialIndexSnapshot
): Array<Record<string, string | number>> {
  const cells = spatialIndex.entries.reduce<Record<string, string[]>>((index, entry) => {
    const key = entry.cell?.key ?? 'missing'
    index[key] = [...(index[key] ?? []), entry.deviceId]
    return index
  }, {})

  return Object.entries(cells)
    .map(([cell, deviceIds]) => ({
      cell,
      count: deviceIds.length,
      devices: deviceIds.join(', ')
    }))
    .sort((left, right) => left.cell.localeCompare(right.cell))
}

function createSimulationClockView(
  clock: NonNullable<SimulationCommandResult['clock']>
): Array<Record<string, string | number | boolean>> {
  return [
    {
      state: clock.state,
      virtualTimeMs: clock.virtualTimeMs,
      realElapsedMs: clock.realElapsedMs,
      speed: `x${clock.speed}`,
      isRunning: clock.isRunning
    }
  ]
}

function createEventQueueView(
  snapshot: EventQueueSnapshot
): Array<Record<string, string | number>> {
  return snapshot.events.map((event) => ({
    id: event.id,
    type: event.type,
    scheduledAt: event.scheduledAt,
    createdAt: event.createdAt,
    priority: event.priority,
    sequence: event.sequence,
    status: event.status,
    source: event.sourceLabel ?? '',
    target: event.targetLabel ?? ''
  }))
}

function createDueEventView(events: SimulationEvent[]): Array<Record<string, string | number>> {
  return events.map((event) => ({
    id: event.id,
    type: event.type,
    scheduledAt: event.scheduledAt,
    createdAt: event.createdAt,
    priority: event.priority,
    sequence: event.sequence,
    status: event.status
  }))
}

function createEventDispatchResultView(
  batch: EventDispatchBatchResult
): Array<Record<string, string | number | boolean>> {
  return batch.results.map((result) => ({
    eventId: result.eventId,
    eventType: result.eventType,
    ok: result.ok,
    simulationTimeMs: result.simulationTimeMs,
    durationWallMs: result.durationWallMs,
    handler: result.handlerName ?? 'missing',
    error: result.error?.code ?? '',
    severity: result.error?.severity ?? '',
    notes: result.notes?.join('; ') ?? '',
    scheduled: result.scheduledEventIds.join(', ')
  }))
}

function createEventDispatchTraceView(
  batch: EventDispatchBatchResult
): Array<Record<string, string | number | boolean>> {
  return batch.traces.map((trace) => ({
    dispatchId: trace.dispatchId,
    eventId: trace.eventId,
    eventType: trace.eventType,
    status: trace.status,
    scheduledAt: trace.scheduledAt,
    simulationTimeMs: trace.simulationTimeMs,
    durationWallMs: trace.durationWallMs ?? 0,
    handlerFound: trace.handlerFound,
    handler: trace.handlerName ?? 'missing',
    scheduled: trace.scheduledEventIds.join(', '),
    error: trace.error?.code ?? ''
  }))
}

function createSimulationExecutionView(
  executions: readonly SimulationRuntimeExecutionLogEntry[]
): Array<Record<string, string | number | boolean>> {
  return executions.map((execution) => ({
    sequence: execution.sequence,
    mode: execution.mode,
    ok: execution.ok,
    timeMs: execution.endedAtMs,
    deltaSimulationMs: execution.deltaSimulationMs,
    processed: execution.processedEventCount,
    failed: execution.failedEventCount,
    pending: execution.pendingEventCount,
    events: execution.processedEvents.map((event) => event.type).join(', '),
    errors: execution.errors.map((error) => error.code).join(', ')
  }))
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [simulationClock, setSimulationClock] = useState<SimulationClockSnapshot | null>(null)
  const [simulationQueue, setSimulationQueue] = useState<EventQueueSnapshot | null>(null)
  const [radioLinks, setRadioLinks] = useState<RadioLinkSnapshot[]>([])
  const lastSimulationExecutionSequenceRef = useRef(0)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [spatialGridVisibility, setSpatialGridVisibility] =
    useState<WorkspaceSpatialGridVisibility>({
      lora: false
    })
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [addDeviceRequest, setAddDeviceRequest] = useState<{
    id: number
    placement: AddDevicePlacement
    preset?: WorkspaceDevicePreset
  }>({
    id: 0,
    placement: 'center'
  })
  const [pasteDeviceRequest, setPasteDeviceRequest] = useState<{
    id: number
    placement: AddDevicePlacement
  }>({
    id: 0,
    placement: 'center'
  })

  const project = useMemo(() => snapshotToProject(snapshot), [snapshot])
  const devices = useMemo(() => snapshotToDevices(snapshot), [snapshot])
  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId]
  )

  const debugLog = useCallback(
    (message: string, payload?: unknown) => {
      if (!debugEnabled) {
        return
      }

      if (payload === undefined) {
        console.info(`[Debug] ${message}`)
        return
      }

      console.info(`[Debug] ${message}`, payload)
    },
    [debugEnabled]
  )

  const applyWorkspaceResult = useCallback(
    (result: WorkspaceCommandResult, options?: { selectNewDevice?: boolean }) => {
      if (!result.ok) {
        console.error('[Workspace] Command failed', result.error)
        return
      }

      if (result.events.length > 0) {
        debugLog('Workspace events', result.events)
      }

      if (!result.snapshot) {
        return
      }

      setSnapshot((currentSnapshot) => {
        if (options?.selectNewDevice) {
          const previousIds = new Set(currentSnapshot?.devices.map((device) => device.id) ?? [])
          const createdDevice = result.snapshot?.devices.find((device) => !previousIds.has(device.id))

          if (createdDevice) {
            setSelectedDeviceId(createdDevice.id)
          }
        }

        return result.snapshot ?? currentSnapshot
      })
    },
    [debugLog]
  )

  const dispatchWorkspaceCommand = useCallback(
    async (
      command: Parameters<typeof window.api.workspace.dispatch>[0],
      options?: { selectNewDevice?: boolean }
    ) => {
      const result = await window.api.workspace.dispatch(command)
      applyWorkspaceResult(result, options)

      if (command.type === 'workspace/create-project') {
        const simulationResult = await window.api.simulation.dispatch({
          type: 'simulation/get-clock-snapshot'
        })

        applySimulationResult(simulationResult)
      }

      return result
    },
    [applyWorkspaceResult]
  )

  const requestAddDevice = useCallback((placement: AddDevicePlacement, preset?: WorkspaceDevicePreset) => {
    setAddDeviceRequest((currentRequest) => ({
      id: currentRequest.id + 1,
      placement,
      ...(preset ? { preset } : {})
    }))
  }, [])

  const requestPasteDevice = useCallback((placement: AddDevicePlacement) => {
    setPasteDeviceRequest((currentRequest) => ({
      id: currentRequest.id + 1,
      placement
    }))
  }, [])

  const addDeviceAt = useCallback(
    (position: WorkspacePoint, preset?: WorkspaceDevicePreset) => {
      void dispatchWorkspaceCommand(
        {
          type: 'workspace/add-device',
          position,
          ...(preset ? { preset } : {})
        },
        { selectNewDevice: true }
      )
    },
    [dispatchWorkspaceCommand]
  )

  const moveDevice = useCallback(
    (deviceId: string, position: WorkspacePoint) => {
      void dispatchWorkspaceCommand({
        type: 'workspace/move-device',
        deviceId,
        position
      })
    },
    [dispatchWorkspaceCommand]
  )

  const addModuleToDevice = useCallback(
    (deviceId: string, module: WorkspaceModule) => {
      debugLog('Module add requested', { deviceId, module })
      void dispatchWorkspaceCommand({
        type: 'workspace/add-module',
        deviceId,
        template: moduleToTemplate(module)
      })
    },
    [debugLog, dispatchWorkspaceCommand]
  )

  const updateDeviceModule = useCallback(
    (deviceId: string, moduleId: string, nextModule: WorkspaceModule) => {
      debugLog('Module update requested', { deviceId, moduleId, module: nextModule })
      void dispatchWorkspaceCommand({
        type: 'workspace/update-module',
        deviceId,
        moduleId,
        patch: {
          communication: nextModule.communication ? { ...nextModule.communication } : undefined
        }
      })
    },
    [debugLog, dispatchWorkspaceCommand]
  )

  const removeDeviceModule = useCallback(
    (deviceId: string, moduleId: string) => {
      debugLog('Module remove requested', { deviceId, moduleId })
      void dispatchWorkspaceCommand({
        type: 'workspace/remove-module',
        deviceId,
        moduleId
      })
    },
    [debugLog, dispatchWorkspaceCommand]
  )

  const copySelectedDevice = useCallback(() => {
    if (!selectedDeviceId) {
      debugLog('No selected device to copy')
      return
    }

    void dispatchWorkspaceCommand({
      type: 'workspace/copy-device',
      deviceId: selectedDeviceId
    })
  }, [debugLog, dispatchWorkspaceCommand, selectedDeviceId])

  const pasteCopiedDeviceAt = useCallback(
    (position: WorkspacePoint) => {
      void dispatchWorkspaceCommand(
        {
          type: 'workspace/paste-device',
          position
        },
        { selectNewDevice: true }
      )
    },
    [dispatchWorkspaceCommand]
  )

  const deleteSelectedDevice = useCallback(() => {
    if (!selectedDeviceId) {
      debugLog('No selected device to delete')
      return
    }

    void dispatchWorkspaceCommand({
      type: 'workspace/delete-device',
      deviceId: selectedDeviceId
    })
    setSelectedDeviceId(null)
  }, [debugLog, dispatchWorkspaceCommand, selectedDeviceId])

  const createProject = useCallback(
    (values: { name: string; width: number; height: number }) => {
      setSelectedDeviceId(null)
      setIsNewProjectDialogOpen(false)
      void dispatchWorkspaceCommand({
        type: 'workspace/create-project',
        name: values.name,
        width: values.width,
        height: values.height
      })
    },
    [dispatchWorkspaceCommand]
  )

  const selectDevice = useCallback(
    (device: WorkspaceDevice) => {
      setSelectedDeviceId(device.id)
      debugLog('Device selected', device)
    },
    [debugLog]
  )

  const showDevicesRegister = useCallback(() => {
    const registerView = createDevicesRegisterView(devices)
    const roleIndex = devices.reduce<Record<string, string[]>>((index, device) => {
      index[device.role] = [...(index[device.role] ?? []), device.id]
      return index
    }, {})

    console.groupCollapsed('[Debug] Devices register')
    console.info('Project:', project)
    console.info('Device count:', devices.length)
    console.info('Role index:', roleIndex)
    console.table(registerView)
    console.info('Snapshot:', snapshot)
    console.groupEnd()
  }, [devices, project, snapshot])

  const showSpatialIndex = useCallback(() => {
    void dispatchWorkspaceCommand({
      type: 'workspace/get-spatial-index-debug'
    }).then((result) => {
      const spatialIndex = result.debug?.spatialIndex

      if (!result.ok || !spatialIndex) {
        console.error('[Debug] Spatial index unavailable', result.error)
        return
      }

      console.groupCollapsed('[Debug] Spatial index')
      console.info('Workspace:', spatialIndex.workspace)
      console.info('Stats:', spatialIndex.stats)
      console.table(createSpatialIndexEntriesView(spatialIndex))
      console.table(createSpatialIndexCellsView(spatialIndex))
      console.groupEnd()
    })
  }, [dispatchWorkspaceCommand])

  const logSimulationExecutions = useCallback((executions?: SimulationRuntimeExecutionLogEntry[]) => {
    const newExecutions = (executions ?? []).filter(
      (execution) => execution.sequence > lastSimulationExecutionSequenceRef.current
    )

    if (newExecutions.length === 0) {
      return
    }

    lastSimulationExecutionSequenceRef.current = Math.max(
      ...newExecutions.map((execution) => execution.sequence)
    )

    console.groupCollapsed(`[Simulation] Executed ${newExecutions.length} queued task batch`)
    console.table(createSimulationExecutionView(newExecutions))

    for (const execution of newExecutions) {
      console.info('[Simulation] Execution result', execution)
    }

    console.groupEnd()
  }, [])

  const applySimulationResult = useCallback(
    (result: SimulationCommandResult) => {
      if (result.clock) {
        setSimulationClock(result.clock)
      }

      if (result.queue) {
        setSimulationQueue(result.queue)
      }

      if (result.radioLinks) {
        setRadioLinks(result.radioLinks)
      }

      logSimulationExecutions(result.executions)
    },
    [logSimulationExecutions]
  )

  const logSimulationResult = useCallback((label: string, result: SimulationCommandResult) => {
    applySimulationResult(result)

    if (!result.ok) {
      console.error('[Simulation] Command failed', result.error)

      if (result.clock) {
        console.info('[Simulation] Clock snapshot', result.clock)
      }

      return
    }

    console.info(`[Simulation] ${label}`, result.clock)
  }, [applySimulationResult])

  const dispatchSimulationCommand = useCallback(
    async (command: SimulationCommand, label: string) => {
      const result = await window.api.simulation.dispatch(command)
      logSimulationResult(label, result)
      return result
    },
    [logSimulationResult]
  )

  const ensureDeviceLoRaAddress = useCallback(
    async (
      currentSnapshot: WorkspaceSnapshot,
      device: WorkspaceSnapshotDevice,
      label: string
    ): Promise<{ snapshot: WorkspaceSnapshot; address: string } | null> => {
      const existingAddress = getSnapshotLoRaAddress(device)

      if (existingAddress) {
        return { snapshot: currentSnapshot, address: existingAddress }
      }

      const module = getSnapshotLoRaModule(device)

      if (!module) {
        console.error(`[Simulation] ${label} must have a LoRa module`, {
          deviceId: device.id
        })
        return null
      }

      const loraAddress = createDefaultLoRaAddress(device)
      const result = await dispatchWorkspaceCommand({
        type: 'workspace/assign-device-lora-address',
        deviceId: device.id,
        moduleId: module.id,
        loraAddress
      })

      if (!result.ok || !result.snapshot) {
        console.error(`[Simulation] Failed to assign LoRa address for ${label}`, {
          deviceId: device.id,
          loraAddress,
          error: result.error
        })
        return null
      }

      const updatedDevice = result.snapshot.devices.find((nextDevice) => nextDevice.id === device.id)
      const assignedAddress = updatedDevice ? getSnapshotLoRaAddress(updatedDevice) : undefined

      if (!assignedAddress) {
        console.error(`[Simulation] LoRa address was not available after assignment for ${label}`, {
          deviceId: device.id,
          loraAddress
        })
        return null
      }

      console.info(`[Simulation] Assigned LoRa address for ${label}`, {
        deviceId: device.id,
        loraAddress: assignedAddress
      })

      return {
        snapshot: result.snapshot,
        address: assignedAddress
      }
    },
    [dispatchWorkspaceCommand]
  )

  const scheduleBasicTelemetry = useCallback(async () => {
    if (!snapshot) {
      console.error('[Simulation] Cannot schedule telemetry before a workspace exists')
      return
    }

    if (!selectedDeviceId) {
      console.error('[Simulation] Select a LoRa device before scheduling basic telemetry')
      return
    }

    const sourceDevice = snapshot.devices.find((device) => device.id === selectedDeviceId)

    if (!sourceDevice) {
      console.error('[Simulation] Selected device is not in the current workspace', {
        selectedDeviceId
      })
      return
    }

    if (!hasSnapshotLoRaModule(sourceDevice)) {
      console.error('[Simulation] Selected device must have a LoRa module', {
        deviceId: sourceDevice.id
      })
      return
    }

    const sourceAddress = await ensureDeviceLoRaAddress(snapshot, sourceDevice, 'selected device')

    if (!sourceAddress) {
      return
    }

    const targetDevice = findBasicTelemetryGatewayTarget(sourceAddress.snapshot, sourceDevice.id)

    if (!targetDevice) {
      console.error('[Simulation] No Gateway device with LoRa module is available')
      return
    }

    const targetAddress = await ensureDeviceLoRaAddress(
      sourceAddress.snapshot,
      targetDevice,
      'Gateway device'
    )

    if (!targetAddress) {
      return
    }

    const result = await dispatchSimulationCommand(
      {
        type: 'simulation/schedule-basic-telemetry',
        deviceId: sourceDevice.id,
        targetAddress: targetAddress.address
      },
      `scheduled basic telemetry ${sourceDevice.id} -> ${targetAddress.address}`
    )

    if (!result.ok) {
      return
    }

    console.info('[Simulation] Scheduled telemetry events', result.scheduledEventIds ?? [])

    if (result.queue) {
      console.table(createEventQueueView(result.queue))
    }
  }, [dispatchSimulationCommand, ensureDeviceLoRaAddress, selectedDeviceId, snapshot])

  const showSimulationClock = useCallback(() => {
    void window.api.simulation
      .dispatch({
        type: 'simulation/get-clock-snapshot'
      })
      .then((result) => {
        const clock = result.clock

        if (!result.ok || !clock) {
          console.error('[Debug] Simulation clock unavailable', result.error)
          return
        }

        applySimulationResult(result)
        console.groupCollapsed('[Debug] Simulation clock')
        console.table(createSimulationClockView(clock))
        console.info('Snapshot:', clock)
        console.groupEnd()
      })
  }, [applySimulationResult])

  const showEventDispatchDebug = useCallback(() => {
    const simulationTimeMs = simulationClock?.virtualTimeMs ?? 0
    const eventQueue = new InMemoryEventQueue()

    eventQueue.schedule({
      id: 'debug-noop',
      type: 'simulation.noop',
      scheduledAt: simulationTimeMs,
      createdAt: simulationTimeMs,
      priority: EventPriority.SYSTEM,
      source: { type: 'engine', id: 'debug-menu' },
      payload: {}
    })
    eventQueue.schedule({
      id: 'debug-log',
      type: 'simulation.log',
      scheduledAt: simulationTimeMs,
      createdAt: simulationTimeMs,
      priority: EventPriority.LOG,
      source: { type: 'engine', id: 'debug-menu' },
      payload: {
        level: 'info',
        message: 'simulation.log handler executed',
        details: {
          source: 'Debug menu',
          simulationTimeMs
        }
      }
    })

    const queuedSnapshot = eventQueue.getSnapshot()
    const dueEvents = eventQueue.popDueEvents(simulationTimeMs)
    const afterPopSnapshot = eventQueue.getSnapshot()
    const dispatcher = new EventDispatcher({
      handlers: {
        'simulation.noop': NoopHandler,
        'simulation.log': SimulationLogHandler
      },
      observers: [new ConsoleDispatchObserver()]
    })
    const batch = dispatcher.dispatchMany(dueEvents, {
      simulationTimeMs,
      eventQueue,
      logger: {
        info(message, details) {
          console.info(`[SimulationLog] ${message}`, details)
        },
        warn(message, details) {
          console.warn(`[SimulationLog] ${message}`, details)
        },
        error(message, details) {
          console.error(`[SimulationLog] ${message}`, details)
        }
      }
    })
    const afterDispatchSnapshot = eventQueue.getSnapshot()

    console.groupCollapsed('[Debug] Event queue and dispatch')
    console.info('Simulation time:', simulationTimeMs)
    console.info('EventQueue before pop:', queuedSnapshot)
    console.table(createEventQueueView(queuedSnapshot))
    console.info('Due events:', dueEvents)
    console.table(createDueEventView(dueEvents))
    console.info('EventQueue after pop:', afterPopSnapshot)
    console.info('EventDispatch batch:', batch)
    console.table(createEventDispatchResultView(batch))
    console.table(createEventDispatchTraceView(batch))
    console.info('EventQueue after dispatch:', afterDispatchSnapshot)
    console.groupEnd()
  }, [simulationClock])

  const handleSimulationMenuCommand = useCallback(
    (command: Parameters<typeof window.api.menu.onSimulationCommand>[0] extends (
      command: infer T
    ) => void
      ? T
      : never) => {
      switch (command.action) {
        case 'start':
          void dispatchSimulationCommand({ type: 'simulation/start' }, 'started')
          return
        case 'pause':
          void dispatchSimulationCommand({ type: 'simulation/pause' }, 'paused')
          return
        case 'stop':
          void dispatchSimulationCommand({ type: 'simulation/stop' }, 'stopped')
          return
        case 'reset':
          void dispatchSimulationCommand({ type: 'simulation/reset' }, 'reset')
          return
        case 'set-speed':
          void dispatchSimulationCommand(
            {
              type: 'simulation/set-speed',
              speed: command.speed
            },
            `speed set to x${command.speed}`
          )
          return
        case 'advance-clock':
          void dispatchSimulationCommand(
            {
              type: 'simulation/advance-clock',
              deltaRealMs: command.deltaRealMs
            },
            `advanced by ${command.deltaRealMs}ms real time`
          )
          return
        case 'schedule-basic-telemetry':
          void scheduleBasicTelemetry()
          return
        case 'show-clock-snapshot':
          showSimulationClock()
          return
      }
    },
    [dispatchSimulationCommand, scheduleBasicTelemetry, showSimulationClock]
  )

  useEffect(() => {
    let isMounted = true

    void window.api.workspace
      .dispatch({
        type: 'workspace/create-project',
        name: DEFAULT_PROJECT.name,
        width: DEFAULT_PROJECT.width,
        height: DEFAULT_PROJECT.height,
        metersPerUnit: DEFAULT_PROJECT.unitScaleMeters
      })
      .then((result) => {
        if (isMounted) {
          applyWorkspaceResult(result)
          void window.api.simulation
            .dispatch({
              type: 'simulation/get-clock-snapshot'
            })
            .then((simulationResult) => {
              if (isMounted) {
                applySimulationResult(simulationResult)
              }
            })
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const refreshSimulationSnapshot = (): void => {
      void window.api.simulation
        .dispatch({
          type: 'simulation/get-clock-snapshot'
        })
        .then((result) => {
          if (!isMounted) {
            return
          }

          applySimulationResult(result)
        })
    }

    const intervalId = window.setInterval(refreshSimulationSnapshot, 500)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [applySimulationResult])

  useEffect(() => {
    const cleanupNewProject = window.api.menu.onNewProject(() => setIsNewProjectDialogOpen(true))
    const cleanupAddDevice = window.api.menu.onAddDevice((command) =>
      requestAddDevice(command.placement, command.preset)
    )
    const cleanupCopySelectedDevice = window.api.menu.onCopySelectedDevice(copySelectedDevice)
    const cleanupPasteDevice = window.api.menu.onPasteDevice((command) =>
      requestPasteDevice(command.placement)
    )
    const cleanupDeleteSelectedDevice = window.api.menu.onDeleteSelectedDevice(deleteSelectedDevice)
    const cleanupSetSpatialGridVisibility = window.api.menu.onSetSpatialGridVisibility((command) => {
      setSpatialGridVisibility((current) => ({
        ...current,
        [command.technology]: command.visible
      }))
    })
    const cleanupSetDebugging = window.api.menu.onSetDebugging((command) => {
      setDebugEnabled(command.enabled)
      console.info(`[Debug] Debugging ${command.enabled ? 'enabled' : 'disabled'}`)
    })
    const cleanupShowDevicesRegister = window.api.menu.onShowDevicesRegister(showDevicesRegister)
    const cleanupShowSpatialIndex = window.api.menu.onShowSpatialIndex(showSpatialIndex)
    const cleanupShowEventDispatchDebug =
      window.api.menu.onShowEventDispatchDebug(showEventDispatchDebug)
    const cleanupSimulationCommand = window.api.menu.onSimulationCommand(handleSimulationMenuCommand)

    return () => {
      cleanupNewProject()
      cleanupAddDevice()
      cleanupCopySelectedDevice()
      cleanupPasteDevice()
      cleanupDeleteSelectedDevice()
      cleanupSetSpatialGridVisibility()
      cleanupSetDebugging()
      cleanupShowDevicesRegister()
      cleanupShowSpatialIndex()
      cleanupShowEventDispatchDebug()
      cleanupSimulationCommand()
    }
  }, [
    copySelectedDevice,
    requestAddDevice,
    requestPasteDevice,
    deleteSelectedDevice,
    showDevicesRegister,
    showSpatialIndex,
    showEventDispatchDebug,
    handleSimulationMenuCommand
  ])

  useEffect(() => {
    function handleWorkspaceShortcuts(event: KeyboardEvent): void {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      if (event.altKey || event.shiftKey || isEditableShortcutTarget(event.target)) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === 'c') {
        event.preventDefault()
        copySelectedDevice()
        return
      }

      if (key === 'v') {
        event.preventDefault()
        requestPasteDevice('cursor')
      }
    }

    window.addEventListener('keydown', handleWorkspaceShortcuts)

    return () => window.removeEventListener('keydown', handleWorkspaceShortcuts)
  }, [copySelectedDevice, requestPasteDevice])

  return (
    <main className="app-shell">
      <WorkspaceView
        project={project}
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        selectedDevice={selectedDevice}
        possibleConnections={snapshot?.possibleConnections ?? []}
        radioLinks={radioLinks}
        spatialGridVisibility={spatialGridVisibility}
        simulationClock={simulationClock}
        simulationQueue={simulationQueue}
        addDeviceRequest={addDeviceRequest}
        pasteDeviceRequest={pasteDeviceRequest}
        onAddDeviceAt={addDeviceAt}
        onPasteDeviceAt={pasteCopiedDeviceAt}
        onMoveDevice={moveDevice}
        onAddModule={addModuleToDevice}
        onUpdateModule={updateDeviceModule}
        onRemoveModule={removeDeviceModule}
        onSelectDevice={selectDevice}
        onClearSelection={() => setSelectedDeviceId(null)}
      />

      {isNewProjectDialogOpen ? (
        <NewProjectDialog
          initialProject={project}
          onCancel={() => setIsNewProjectDialogOpen(false)}
          onCreate={createProject}
        />
      ) : null}
    </main>
  )
}

export default App
