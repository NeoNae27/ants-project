import { ElectronAPI } from '@electron-toolkit/preload'

export type MenuCommandCleanup = () => void
export type MenuCommandCallback = () => void
export type AddDeviceCommand = {
  placement: 'center' | 'cursor'
}
export type AddDeviceCommandCallback = (command: AddDeviceCommand) => void
export type PasteDeviceCommand = {
  placement: 'center' | 'cursor'
}
export type PasteDeviceCommandCallback = (command: PasteDeviceCommand) => void

export type WorkspaceApi = {
  menu: {
    onNewProject: (callback: MenuCommandCallback) => MenuCommandCleanup
    onAddDevice: (callback: AddDeviceCommandCallback) => MenuCommandCleanup
    onCopySelectedDevice: (callback: MenuCommandCallback) => MenuCommandCleanup
    onPasteDevice: (callback: PasteDeviceCommandCallback) => MenuCommandCleanup
    onDeleteSelectedDevice: (callback: MenuCommandCallback) => MenuCommandCleanup
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: WorkspaceApi
  }
}
