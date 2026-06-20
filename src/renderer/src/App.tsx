import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceSnapshot, WorkspaceSpatialIndexSnapshot } from '../../engine/domain/workspace'
import type {
  SimulationCommand,
  SimulationClockSnapshot,
  SimulationCommandResult
} from '../../shared/simulationRuntime'
import type { WorkspaceCommandResult } from '../../shared/workspaceSession'
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

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [simulationClock, setSimulationClock] = useState<SimulationClockSnapshot | null>(null)
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

        if (simulationResult.clock) {
          setSimulationClock(simulationResult.clock)
        }
      }

      return result
    },
    [applyWorkspaceResult]
  )

  const requestAddDevice = useCallback((placement: AddDevicePlacement) => {
    setAddDeviceRequest((currentRequest) => ({
      id: currentRequest.id + 1,
      placement
    }))
  }, [])

  const requestPasteDevice = useCallback((placement: AddDevicePlacement) => {
    setPasteDeviceRequest((currentRequest) => ({
      id: currentRequest.id + 1,
      placement
    }))
  }, [])

  const addDeviceAt = useCallback(
    (position: WorkspacePoint) => {
      void dispatchWorkspaceCommand(
        {
          type: 'workspace/add-device',
          position
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

  const logSimulationResult = useCallback((label: string, result: SimulationCommandResult) => {
    if (result.clock) {
      setSimulationClock(result.clock)
    }

    if (!result.ok) {
      console.error('[Simulation] Command failed', result.error)

      if (result.clock) {
        console.info('[Simulation] Clock snapshot', result.clock)
      }

      return
    }

    console.info(`[Simulation] ${label}`, result.clock)
  }, [])

  const dispatchSimulationCommand = useCallback(
    async (command: SimulationCommand, label: string) => {
      const result = await window.api.simulation.dispatch(command)
      logSimulationResult(label, result)
      return result
    },
    [logSimulationResult]
  )

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

        console.groupCollapsed('[Debug] Simulation clock')
        console.table(createSimulationClockView(clock))
        console.info('Snapshot:', clock)
        console.groupEnd()
        setSimulationClock(clock)
      })
  }, [])

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
        case 'show-clock-snapshot':
          showSimulationClock()
          return
      }
    },
    [dispatchSimulationCommand, showSimulationClock]
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
              if (isMounted && simulationResult.clock) {
                setSimulationClock(simulationResult.clock)
              }
            })
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const cleanupNewProject = window.api.menu.onNewProject(() => setIsNewProjectDialogOpen(true))
    const cleanupAddDevice = window.api.menu.onAddDevice((command) =>
      requestAddDevice(command.placement)
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
      cleanupSimulationCommand()
    }
  }, [
    copySelectedDevice,
    requestAddDevice,
    requestPasteDevice,
    deleteSelectedDevice,
    showDevicesRegister,
    showSpatialIndex,
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
        spatialGridVisibility={spatialGridVisibility}
        simulationClock={simulationClock}
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
