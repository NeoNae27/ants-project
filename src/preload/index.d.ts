import { ElectronAPI } from '@electron-toolkit/preload'
import type { WorkspaceCommand, WorkspaceCommandResult } from '../shared/workspaceSession'

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
export type DebuggingCommand = {
  enabled: boolean
}
export type DebuggingCommandCallback = (command: DebuggingCommand) => void
export type SpatialGridVisibilityCommand = {
  technology: 'lora'
  visible: boolean
}
export type SpatialGridVisibilityCommandCallback = (command: SpatialGridVisibilityCommand) => void

export type WorkspaceApi = {
  workspace: {
    dispatch: (command: WorkspaceCommand) => Promise<WorkspaceCommandResult>
  }
  menu: {
    onNewProject: (callback: MenuCommandCallback) => MenuCommandCleanup
    onAddDevice: (callback: AddDeviceCommandCallback) => MenuCommandCleanup
    onCopySelectedDevice: (callback: MenuCommandCallback) => MenuCommandCleanup
    onPasteDevice: (callback: PasteDeviceCommandCallback) => MenuCommandCleanup
    onDeleteSelectedDevice: (callback: MenuCommandCallback) => MenuCommandCleanup
    onSetSpatialGridVisibility: (callback: SpatialGridVisibilityCommandCallback) => MenuCommandCleanup
    onSetDebugging: (callback: DebuggingCommandCallback) => MenuCommandCleanup
    onShowDevicesRegister: (callback: MenuCommandCallback) => MenuCommandCleanup
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: WorkspaceApi
  }
}
