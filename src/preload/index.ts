import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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

const api = {
  workspace: {
    dispatch(command: WorkspaceCommand): Promise<WorkspaceCommandResult> {
      return ipcRenderer.invoke('workspace:dispatch', command)
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
