import type {
  WorkspaceCommunicationConfigDto,
  WorkspaceModuleKind,
  WorkspacePosition,
  WorkspaceSnapshot,
  WorkspaceSpatialIndexSnapshot,
  WorkspaceValidationOptions,
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

export type WorkspaceDevicePreset =
  | 'generic-node'
  | 'lora-sensor-node'
  | 'lora-gateway'

export type WorkspaceDeviceRole = 'node' | 'repeater' | 'gateway'

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
  preset?: WorkspaceDevicePreset
  name?: string
  model?: string
  role?: WorkspaceDeviceRole
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

export type UpdateDeviceRoleCommand = {
  type: 'workspace/update-device-role'
  deviceId: string
  role: WorkspaceDeviceRole
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

export type RemoveModuleCommand = {
  type: 'workspace/remove-module'
  deviceId: string
  moduleId: string
}

export type AssignDeviceLoRaAddressCommand = {
  type: 'workspace/assign-device-lora-address'
  deviceId: string
  moduleId?: string
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
  mode?: WorkspaceValidationOptions['mode']
}

export type GetSnapshotCommand = {
  type: 'workspace/get-snapshot'
}

export type GetSpatialIndexDebugCommand = {
  type: 'workspace/get-spatial-index-debug'
}

export type WorkspaceCommand =
  | CreateProjectCommand
  | AddDeviceCommand
  | MoveDeviceCommand
  | DeleteDeviceCommand
  | UpdateDeviceRoleCommand
  | AddModuleCommand
  | UpdateModuleCommand
  | RemoveModuleCommand
  | AssignDeviceLoRaAddressCommand
  | CopyDeviceCommand
  | PasteDeviceCommand
  | ValidateProjectCommand
  | GetSnapshotCommand
  | GetSpatialIndexDebugCommand

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
  debug?: {
    spatialIndex?: WorkspaceSpatialIndexSnapshot
  }
  events: WorkspaceSessionEvent[]
  error?: {
    code: string
    message: string
  }
}
