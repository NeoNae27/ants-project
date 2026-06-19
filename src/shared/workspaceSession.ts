import type {
  WorkspaceCommunicationConfigDto,
  WorkspaceModuleKind,
  WorkspacePosition,
  WorkspaceSnapshot,
  WorkspaceValidationResult,
} from '../engine/domain/workspace/WorkspaceTypes'

export type WorkspaceModuleTemplateDto = {
  kind: WorkspaceModuleKind
  name: string
  model: string
  communication?: WorkspaceCommunicationConfigDto
  config?: Record<string, unknown>
}

export type WorkspaceModulePatchDto = {
  name?: string
  communication?: Partial<WorkspaceCommunicationConfigDto>
  config?: Record<string, unknown>
}

export type CreateProjectCommand = {
  type: 'workspace/create-project'
  name: string
  width: number
  height: number
  metersPerUnit?: number
}

export type AddDeviceCommand = {
  type: 'workspace/add-device'
  position: WorkspacePosition
  name?: string
  model?: string
  role?: 'node' | 'repeater' | 'gateway'
  modules?: WorkspaceModuleTemplateDto[]
  loraAddress?: string
}

export type MoveDeviceCommand = {
  type: 'workspace/move-device'
  deviceId: string
  position: WorkspacePosition
}

export type DeleteDeviceCommand = {
  type: 'workspace/delete-device'
  deviceId: string
}

export type AddModuleCommand = {
  type: 'workspace/add-module'
  deviceId: string
  template: WorkspaceModuleTemplateDto
}

export type UpdateModuleCommand = {
  type: 'workspace/update-module'
  deviceId: string
  moduleId: string
  patch: WorkspaceModulePatchDto
}

export type AssignDeviceLoRaAddressCommand = {
  type: 'workspace/assign-device-lora-address'
  deviceId: string
  loraAddress: string
}

export type CopyDeviceCommand = {
  type: 'workspace/copy-device'
  deviceId: string
}

export type PasteDeviceCommand = {
  type: 'workspace/paste-device'
  position: WorkspacePosition
}

export type ValidateProjectCommand = {
  type: 'workspace/validate-project'
}

export type GetSnapshotCommand = {
  type: 'workspace/get-snapshot'
}

export type WorkspaceCommand =
  | CreateProjectCommand
  | AddDeviceCommand
  | MoveDeviceCommand
  | DeleteDeviceCommand
  | AddModuleCommand
  | UpdateModuleCommand
  | AssignDeviceLoRaAddressCommand
  | CopyDeviceCommand
  | PasteDeviceCommand
  | ValidateProjectCommand
  | GetSnapshotCommand

export type WorkspaceSessionEvent = {
  id: string
  type: string
  timestamp: number
  payload?: Record<string, unknown>
}

export type WorkspaceCommandResult = {
  ok: boolean
  snapshot?: WorkspaceSnapshot
  validation?: WorkspaceValidationResult
  events: WorkspaceSessionEvent[]
  error?: {
    code: string
    message: string
  }
}
