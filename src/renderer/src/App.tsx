import { useCallback, useEffect, useMemo, useState } from 'react'
import { NewProjectDialog } from './workspace/NewProjectDialog'
import { WorkspaceView } from './workspace/WorkspaceView'
import type {
  AddDevicePlacement,
  WorkspaceDevice,
  WorkspaceModule,
  WorkspacePoint,
  WorkspaceProject
} from './workspace/types'
import {
  cloneWorkspaceDevice,
  createDefaultProject,
  createWorkspaceDevice,
  createWorkspaceProject,
  findFreeDevicePosition
} from './workspace/workspaceUtils'

function copyDeviceSnapshot(device: WorkspaceDevice): WorkspaceDevice {
  return {
    ...device,
    config: { ...device.config },
    modules: device.modules.map((module) => ({
      ...module,
      communication: module.communication ? { ...module.communication } : undefined
    }))
  }
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  )
}

function App(): React.JSX.Element {
  const [project, setProject] = useState<WorkspaceProject>(() => createDefaultProject())
  const [devices, setDevices] = useState<WorkspaceDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [copiedDevice, setCopiedDevice] = useState<WorkspaceDevice | null>(null)
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

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId]
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
      setDevices((currentDevices) => {
        const device = createWorkspaceDevice(project, currentDevices.length, currentDevices, position)
        console.info('[Workspace] Device created:', device)
        return [...currentDevices, device]
      })
    },
    [project]
  )

  const moveDevice = useCallback(
    (deviceId: string, position: WorkspacePoint) => {
      setDevices((currentDevices) => {
        const nextPosition = findFreeDevicePosition({
          project,
          devices: currentDevices,
          desiredPosition: position,
          excludedDeviceId: deviceId
        })

        return currentDevices.map((device) =>
          device.id === deviceId
            ? {
                ...device,
                x: nextPosition.x,
                y: nextPosition.y
              }
            : device
        )
      })
    },
    [project]
  )

  const addModuleToDevice = useCallback((deviceId: string, module: WorkspaceModule) => {
    setDevices((currentDevices) =>
      currentDevices.map((device) =>
        device.id === deviceId
          ? {
              ...device,
              modules: [...device.modules, module]
            }
          : device
      )
    )
  }, [])

  const updateDeviceModule = useCallback(
    (deviceId: string, moduleId: string, nextModule: WorkspaceModule) => {
      setDevices((currentDevices) =>
        currentDevices.map((device) =>
          device.id === deviceId
            ? {
                ...device,
                modules: device.modules.map((module) =>
                  module.id === moduleId ? nextModule : module
                )
              }
            : device
        )
      )
    },
    []
  )

  const copySelectedDevice = useCallback(() => {
    if (!selectedDevice) {
      console.info('[Workspace] No selected device to copy')
      return
    }

    setCopiedDevice(copyDeviceSnapshot(selectedDevice))
    console.info('[Workspace] Device copied:', selectedDevice)
  }, [selectedDevice])

  const pasteCopiedDeviceAt = useCallback(
    (position: WorkspacePoint) => {
      if (!copiedDevice) {
        console.info('[Workspace] No copied device to paste')
        return
      }

      setDevices((currentDevices) => {
        const device = cloneWorkspaceDevice({
          project,
          sourceDevice: copiedDevice,
          deviceIndex: currentDevices.length,
          devices: currentDevices,
          desiredPosition: position
        })

        setSelectedDeviceId(device.id)
        console.info('[Workspace] Device pasted:', device)

        return [...currentDevices, device]
      })
    },
    [copiedDevice, project]
  )

  const deleteSelectedDevice = useCallback(() => {
    setDevices((currentDevices) => {
      if (!selectedDeviceId) {
        console.info('[Workspace] No selected device to delete')
        return currentDevices
      }

      return currentDevices.filter((device) => device.id !== selectedDeviceId)
    })
    setSelectedDeviceId(null)
  }, [selectedDeviceId])

  const createProject = useCallback((nextProject: WorkspaceProject) => {
    setProject(nextProject)
    setDevices([])
    setSelectedDeviceId(null)
    setCopiedDevice(null)
    setIsNewProjectDialogOpen(false)
    console.info('[Workspace] Project created:', nextProject)
  }, [])

  const selectDevice = useCallback((device: WorkspaceDevice) => {
    setSelectedDeviceId(device.id)
    console.info('[Workspace] Device selected:', device)
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

    return () => {
      cleanupNewProject()
      cleanupAddDevice()
      cleanupCopySelectedDevice()
      cleanupPasteDevice()
      cleanupDeleteSelectedDevice()
    }
  }, [copySelectedDevice, requestAddDevice, requestPasteDevice, deleteSelectedDevice])

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
        addDeviceRequest={addDeviceRequest}
        pasteDeviceRequest={pasteDeviceRequest}
        onAddDeviceAt={addDeviceAt}
        onPasteDeviceAt={pasteCopiedDeviceAt}
        onMoveDevice={moveDevice}
        onAddModule={addModuleToDevice}
        onUpdateModule={updateDeviceModule}
        onSelectDevice={selectDevice}
        onClearSelection={() => setSelectedDeviceId(null)}
      />

      {isNewProjectDialogOpen ? (
        <NewProjectDialog
          initialProject={project}
          onCancel={() => setIsNewProjectDialogOpen(false)}
          onCreate={(values) =>
            createProject(createWorkspaceProject(values.name, values.width, values.height))
          }
        />
      ) : null}
    </main>
  )
}

export default App
