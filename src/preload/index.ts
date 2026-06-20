import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  SimulationClockSpeed,
  SimulationCommand,
  SimulationCommandResult
} from '../shared/simulationRuntime'
import type { WorkspaceCommand, WorkspaceCommandResult } from '../shared/workspaceSession'

type MenuCommandCallback = () => void
type AddDeviceCommand = {
  placement: 'center' | 'cursor'
}
type AddDeviceCommandCallback = (command: AddDeviceCommand) => void
type PasteDeviceCommand = {
  placement: 'center' | 'cursor'
}
type PasteDeviceCommandCallback = (command: PasteDeviceCommand) => void
type DebuggingCommand = {
  enabled: boolean
}
type DebuggingCommandCallback = (command: DebuggingCommand) => void
type SpatialGridVisibilityCommand = {
  technology: 'lora'
  visible: boolean
}
type SpatialGridVisibilityCommandCallback = (command: SpatialGridVisibilityCommand) => void
type SimulationMenuCommand =
  | { action: 'start' }
  | { action: 'pause' }
  | { action: 'stop' }
  | { action: 'reset' }
  | { action: 'set-speed'; speed: SimulationClockSpeed }
  | { action: 'advance-clock'; deltaRealMs: number }
  | { action: 'show-clock-snapshot' }
type SimulationMenuCommandCallback = (command: SimulationMenuCommand) => void

const api = {
  workspace: {
    dispatch(command: WorkspaceCommand): Promise<WorkspaceCommandResult> {
      return ipcRenderer.invoke('workspace:dispatch', command)
    }
  },
  simulation: {
    dispatch(command: SimulationCommand): Promise<SimulationCommandResult> {
      return ipcRenderer.invoke('simulation:dispatch', command)
    }
  },
  menu: {
    onNewProject(callback: MenuCommandCallback) {
      ipcRenderer.on('menu:new-project', callback)
      return () => ipcRenderer.removeListener('menu:new-project', callback)
    },
    onAddDevice(callback: AddDeviceCommandCallback) {
      const listener = (_event: IpcRendererEvent, command?: AddDeviceCommand) => {
        callback(command ?? { placement: 'center' })
      }

      ipcRenderer.on('menu:add-device', listener)
      return () => ipcRenderer.removeListener('menu:add-device', listener)
    },
    onCopySelectedDevice(callback: MenuCommandCallback) {
      ipcRenderer.on('menu:copy-selected-device', callback)
      return () => ipcRenderer.removeListener('menu:copy-selected-device', callback)
    },
    onPasteDevice(callback: PasteDeviceCommandCallback) {
      const listener = (_event: IpcRendererEvent, command?: PasteDeviceCommand) => {
        callback(command ?? { placement: 'center' })
      }

      ipcRenderer.on('menu:paste-device', listener)
      return () => ipcRenderer.removeListener('menu:paste-device', listener)
    },
    onDeleteSelectedDevice(callback: MenuCommandCallback) {
      ipcRenderer.on('menu:delete-selected-device', callback)
      return () => ipcRenderer.removeListener('menu:delete-selected-device', callback)
    },
    onSetSpatialGridVisibility(callback: SpatialGridVisibilityCommandCallback) {
      const listener = (_event: IpcRendererEvent, command?: SpatialGridVisibilityCommand) => {
        callback(command ?? { technology: 'lora', visible: false })
      }

      ipcRenderer.on('menu:set-spatial-grid-visibility', listener)
      return () => ipcRenderer.removeListener('menu:set-spatial-grid-visibility', listener)
    },
    onSetDebugging(callback: DebuggingCommandCallback) {
      const listener = (_event: IpcRendererEvent, command?: DebuggingCommand) => {
        callback(command ?? { enabled: false })
      }

      ipcRenderer.on('menu:set-debugging', listener)
      return () => ipcRenderer.removeListener('menu:set-debugging', listener)
    },
    onShowDevicesRegister(callback: MenuCommandCallback) {
      ipcRenderer.on('menu:show-devices-register', callback)
      return () => ipcRenderer.removeListener('menu:show-devices-register', callback)
    },
    onShowSpatialIndex(callback: MenuCommandCallback) {
      ipcRenderer.on('menu:show-spatial-index', callback)
      return () => ipcRenderer.removeListener('menu:show-spatial-index', callback)
    },
    onSimulationCommand(callback: SimulationMenuCommandCallback) {
      const listener = (_event: IpcRendererEvent, command?: SimulationMenuCommand) => {
        if (!command) {
          return
        }

        callback(command)
      }

      ipcRenderer.on('menu:simulation-command', listener)
      return () => ipcRenderer.removeListener('menu:simulation-command', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
