import { DeviceFactory } from '../../domain/device/DeviceFactory'
import { DeviceRole } from '../../domain/device/DeviceRole'
import type { DeviceModule } from '../../domain/module'
import { LoRaModule, type LoRaModuleConfigPatch } from '../../domain/modules/network/lora'
import { ModuleFactory } from '../../domain/modules'
import { Workspace } from '../../domain/workspace'
import type {
  WorkspaceConfig,
  WorkspaceDeviceSnapshot,
  WorkspaceModuleSnapshot,
  WorkspacePossibleConnection,
  WorkspaceSnapshot,
  WorkspaceSpatialIndexSnapshot,
  WorkspaceValidationResult,
} from '../../domain/workspace'
import type {
  AddDeviceCommand,
  AddModuleCommand,
  AssignDeviceLoRaAddressCommand,
  CopyDeviceCommand,
  CreateProjectCommand,
  DeleteDeviceCommand,
  MoveDeviceCommand,
  PasteDeviceCommand,
  RemoveModuleCommand,
  UpdateDeviceRoleCommand,
  UpdateModuleCommand,
  WorkspaceCommand,
  WorkspaceCommandResult,
  WorkspaceDevicePreset,
  WorkspaceModulePatchDto,
  WorkspaceModuleTemplateDto,
  WorkspaceSessionEvent,
} from '../../../shared/workspaceSession'
import type { NetworkEndpoint } from '../../domain/registry'
import { WorkspacePlacementService } from './WorkspacePlacementService'
import { WorkspaceSessionError } from './WorkspaceSessionErrors'

const DEFAULT_DEVICE_MODEL = 'ANT-UI-100'
const DEFAULT_DEVICE_VERSION = '1.0.0'
const DEFAULT_METERS_PER_UNIT = 10
const LORA_SENSOR_DEVICE_MODEL = 'ANT-S'
const LORA_GATEWAY_DEVICE_MODEL = 'ANT-G'

type WorkspaceSessionDependencies = {
  moduleFactory?: ModuleFactory
  placementService?: WorkspacePlacementService
}

type DevicePresetDefaults = {
  model?: string
  role?: AddDeviceCommand['role']
  modules?: WorkspaceModuleTemplateDto[]
}

type ClipboardDeviceDto = {
  info: WorkspaceDeviceSnapshot['info']
  modules: WorkspaceModuleTemplateDto[]
  loraAddress?: string
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function createDefaultLoRaAddress(deviceId: string): string {
  return `${deviceId}:lora`
}

function createLoRaNetworkTemplate(): WorkspaceModuleTemplateDto {
  return {
    kind: 'network',
    name: 'LoRa network',
    model: 'SX1276 Stub',
    communication: {
      protocol: 'lora',
      maxRangeMeters: 10_000,
      maxConnections: 8,
      spreadingFactor: 12,
      bandwidthHz: 125_000,
      txPowerDbm: 14,
      codingRate: '4/5',
      sourceLabel: 'SX1276 simulation preset (datasheet-derived placeholder)',
    },
  }
}

function getDevicePresetDefaults(preset?: WorkspaceDevicePreset): DevicePresetDefaults {
  switch (preset) {
    case 'lora-sensor-node':
      return {
        model: LORA_SENSOR_DEVICE_MODEL,
        role: 'node',
        modules: [createLoRaNetworkTemplate()],
      }
    case 'lora-gateway':
      return {
        model: LORA_GATEWAY_DEVICE_MODEL,
        role: 'gateway',
        modules: [createLoRaNetworkTemplate()],
      }
    case 'generic-node':
    case undefined:
      return {
        model: DEFAULT_DEVICE_MODEL,
        role: 'node',
      }
    default:
      throw new WorkspaceSessionError(
        'WORKSPACE_SESSION_DEVICE_PRESET_UNKNOWN',
        `Unknown device preset: ${String(preset)}`,
      )
  }
}

function toDeviceRole(role?: AddDeviceCommand['role']): DeviceRole {
  switch (role) {
    case 'gateway':
      return DeviceRole.GATEWAY
    case 'repeater':
      return DeviceRole.REPEATER
    case 'node':
    case undefined:
      return DeviceRole.NODE
    default:
      throw new WorkspaceSessionError('WORKSPACE_SESSION_ROLE_UNKNOWN', `Unknown device role: ${String(role)}`)
  }
}

function toErrorResult(error: unknown, events: WorkspaceSessionEvent[] = []): WorkspaceCommandResult {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : error.name

    return {
      ok: false,
      events,
      error: {
        code,
        message: error.message,
      },
    }
  }

  return {
    ok: false,
    events,
    error: {
      code: 'WORKSPACE_SESSION_UNKNOWN_ERROR',
      message: 'Unknown workspace session error',
    },
  }
}

function moduleSnapshotToTemplate(module: WorkspaceModuleSnapshot): WorkspaceModuleTemplateDto {
  return {
    kind: module.kind,
    name: module.name,
    model: module.model,
    communication: module.communication ? { ...module.communication } : undefined,
    config: module.config ? { ...module.config } : undefined,
  }
}

function getLoRaModule(device: WorkspaceDeviceSnapshot): WorkspaceModuleSnapshot | undefined {
  return device.modules.find((module) => module.communication?.protocol === 'lora')
}

function getFirstLoRaModuleIdFromModules(modules: readonly DeviceModule[]): string | undefined {
  return modules.find((module) => module instanceof LoRaModule)?.id
}

function hasLoRaModuleTemplate(templates: readonly WorkspaceModuleTemplateDto[]): boolean {
  return templates.some((template) => template.communication?.protocol === 'lora')
}

function createConnectionId(sourceDeviceId: string, targetDeviceId: string, sourceModuleId: string): string {
  return `${sourceDeviceId}->${targetDeviceId}:${sourceModuleId}`
}

export class WorkspaceSession {
  private workspace: Workspace | null = null
  private clipboardDevice: ClipboardDeviceDto | null = null
  private readonly moduleFactory: ModuleFactory
  private readonly placementService: WorkspacePlacementService

  constructor(dependencies?: WorkspaceSessionDependencies) {
    this.moduleFactory = dependencies?.moduleFactory ?? new ModuleFactory()
    this.placementService = dependencies?.placementService ?? new WorkspacePlacementService()
  }

  dispatch(command: WorkspaceCommand): WorkspaceCommandResult {
    const events: WorkspaceSessionEvent[] = []

    try {
      switch (command.type) {
        case 'workspace/create-project':
          return this.withSnapshot(this.createProject(command), [
            this.createEvent('workspace.project.created', { name: command.name }),
          ])
        case 'workspace/add-device':
          return this.withSnapshot(this.addDevice(command), [
            this.createEvent('workspace.device.added'),
          ])
        case 'workspace/move-device':
          return this.withSnapshot(this.moveDevice(command), [
            this.createEvent('workspace.device.moved', { deviceId: command.deviceId }),
          ])
        case 'workspace/delete-device':
          return this.withSnapshot(this.deleteDevice(command), [
            this.createEvent('workspace.device.deleted', { deviceId: command.deviceId }),
          ])
        case 'workspace/update-device-role':
          return this.withSnapshot(this.updateDeviceRole(command), [
            this.createEvent('workspace.device.role_updated', {
              deviceId: command.deviceId,
              role: command.role,
            }),
          ])
        case 'workspace/add-module':
          return this.withSnapshot(this.addModule(command), [
            this.createEvent('workspace.module.added', { deviceId: command.deviceId }),
          ])
        case 'workspace/update-module':
          return this.withSnapshot(this.updateModule(command), [
            this.createEvent('workspace.module.updated', {
              deviceId: command.deviceId,
              moduleId: command.moduleId,
            }),
          ])
        case 'workspace/remove-module':
          return this.withSnapshot(this.removeModule(command), [
            this.createEvent('workspace.module.removed', {
              deviceId: command.deviceId,
              moduleId: command.moduleId,
            }),
          ])
        case 'workspace/assign-device-lora-address':
          return this.withSnapshot(this.assignDeviceLoRaAddress(command), [
            this.createEvent('workspace.device.lora_address_assigned', {
              deviceId: command.deviceId,
              loraAddress: command.loraAddress,
            }),
          ])
        case 'workspace/copy-device':
          return this.withSnapshot(this.copyDevice(command), [
            this.createEvent('workspace.device.copied', { deviceId: command.deviceId }),
          ])
        case 'workspace/paste-device':
          return this.withSnapshot(this.pasteDevice(command), [
            this.createEvent('workspace.device.pasted'),
          ])
        case 'workspace/validate-project': {
          const validation = this.validateProject({ mode: command.mode })
          return {
            ok: validation.valid,
            snapshot: this.getSnapshot(),
            validation,
            events,
          }
        }
        case 'workspace/get-snapshot':
          return this.withSnapshot(this.getSnapshot(), events)
        case 'workspace/get-spatial-index-debug':
          return {
            ok: true,
            snapshot: this.getSnapshot(),
            debug: {
              spatialIndex: this.getSpatialIndexSnapshot(),
            },
            events,
          }
        default:
          throw new WorkspaceSessionError(
            'WORKSPACE_SESSION_COMMAND_UNKNOWN',
            `Unknown workspace command: ${(command as { type?: string }).type}`,
          )
      }
    } catch (error) {
      return toErrorResult(error, events)
    }
  }

  createProject(command: CreateProjectCommand): WorkspaceSnapshot {
    const config: WorkspaceConfig = {
      id: createId('project'),
      name: command.name.trim() || 'Untitled project',
      width: command.width,
      height: command.height,
      metersPerUnit: command.metersPerUnit ?? DEFAULT_METERS_PER_UNIT,
    }

    this.workspace = new Workspace(config)
    this.clipboardDevice = null

    return this.getSnapshot()
  }

  addDevice(command: AddDeviceCommand): WorkspaceSnapshot {
    const workspace = this.getWorkspaceOrThrow()
    const baseSnapshot = this.getSnapshot()
    const finalPosition = this.placementService.findFreePlacementNear(baseSnapshot, command.position)
    const deviceId = createId('device')
    const presetDefaults = getDevicePresetDefaults(command.preset)
    const moduleTemplates = command.modules ?? presetDefaults.modules ?? []
    const loraAddress = this.resolveLoRaAddressForNewDevice({
      workspace,
      deviceId,
      loraAddress: command.loraAddress,
      shouldGenerate: command.loraAddress === undefined && hasLoRaModuleTemplate(moduleTemplates),
    })
    const modules = moduleTemplates.map((template) =>
      this.moduleFactory.createModule(template, {
        deviceId,
        loraAddress,
      }),
    )
    const device = DeviceFactory.createDevice({
      id: deviceId,
      model: command.model ?? presetDefaults.model ?? DEFAULT_DEVICE_MODEL,
      version: DEFAULT_DEVICE_VERSION,
      role: toDeviceRole(command.role ?? presetDefaults.role),
      name: command.name ?? `Device ${baseSnapshot.devices.length + 1}`,
      x: finalPosition.x,
      y: finalPosition.y,
      modules,
    })

    const endpoints: NetworkEndpoint[] = []
    const loraModuleId = getFirstLoRaModuleIdFromModules(modules)

    if (loraAddress && loraModuleId) {
      endpoints.push({
        deviceId,
        moduleId: loraModuleId,
        protocol: 'lora',
        address: loraAddress,
      })
    }

    workspace.addDevice(device, finalPosition, { endpoints })

    return this.getSnapshot()
  }

  moveDevice(command: MoveDeviceCommand): WorkspaceSnapshot {
    const workspace = this.getWorkspaceOrThrow()
    const finalPosition = this.placementService.findFreePlacementNear(
      this.getSnapshot(),
      command.position,
      command.deviceId,
    )

    workspace.moveDevice(command.deviceId, finalPosition)

    return this.getSnapshot()
  }

  deleteDevice(command: DeleteDeviceCommand): WorkspaceSnapshot {
    this.getWorkspaceOrThrow().removeDevice(command.deviceId)
    return this.getSnapshot()
  }

  updateDeviceRole(command: UpdateDeviceRoleCommand): WorkspaceSnapshot {
    this.getWorkspaceOrThrow().updateDeviceRole(command.deviceId, toDeviceRole(command.role))
    return this.getSnapshot()
  }

  addModule(command: AddModuleCommand): WorkspaceSnapshot {
    const workspace = this.getWorkspaceOrThrow()

    const module = this.moduleFactory.createModule(command.template, {
      deviceId: command.deviceId,
      loraAddress: workspace.getRegistryQueries().getLoRaAddress(command.deviceId),
    })

    workspace.addModule(command.deviceId, module)

    return this.getSnapshot()
  }

  updateModule(command: UpdateModuleCommand): WorkspaceSnapshot {
    const workspace = this.getWorkspaceOrThrow()
    const deviceSnapshot = this.findDeviceSnapshot(command.deviceId)
    const moduleSnapshot = deviceSnapshot.modules.find((module) => module.id === command.moduleId)

    if (!moduleSnapshot) {
      throw new WorkspaceSessionError('WORKSPACE_SESSION_MODULE_NOT_FOUND', `Module not found: ${command.moduleId}`)
    }

    if (moduleSnapshot.communication?.protocol === 'lora' && command.patch.communication) {
      workspace.updateLoRaModuleConfig(
        command.deviceId,
        command.moduleId,
        this.createLoRaConfigPatch(command.patch),
      )
    } else if (command.patch.config || command.patch.communication) {
      workspace.updateStubModuleConfig(command.deviceId, command.moduleId, {
        ...(command.patch.config ?? {}),
        ...(command.patch.communication ? { communication: command.patch.communication } : {}),
      })
    }

    return this.getSnapshot()
  }

  removeModule(command: RemoveModuleCommand): WorkspaceSnapshot {
    this.getWorkspaceOrThrow().removeModule(command.deviceId, command.moduleId)
    return this.getSnapshot()
  }

  assignDeviceLoRaAddress(command: AssignDeviceLoRaAddressCommand): WorkspaceSnapshot {
    this.getWorkspaceOrThrow().assignDeviceLoRaAddress(command.deviceId, command.loraAddress, command.moduleId)
    return this.getSnapshot()
  }

  copyDevice(command: CopyDeviceCommand): WorkspaceSnapshot {
    const deviceSnapshot = this.findDeviceSnapshot(command.deviceId)

    this.clipboardDevice = {
      info: { ...deviceSnapshot.info },
      modules: deviceSnapshot.modules.map(moduleSnapshotToTemplate),
      loraAddress: deviceSnapshot.address,
    }

    return this.getSnapshot()
  }

  pasteDevice(command: PasteDeviceCommand): WorkspaceSnapshot {
    if (!this.clipboardDevice) {
      throw new WorkspaceSessionError('WORKSPACE_SESSION_CLIPBOARD_EMPTY', 'No copied device to paste')
    }

    return this.addDevice({
      type: 'workspace/add-device',
      position: command.position,
      model: this.clipboardDevice.info.model,
      name: `${this.clipboardDevice.info.name ?? this.clipboardDevice.info.id} Copy`,
      role: this.clipboardDevice.info.role,
      modules: this.clipboardDevice.modules,
    })
  }

  validateProject(options?: { mode?: 'project' | 'network' }): WorkspaceValidationResult {
    return this.getWorkspaceOrThrow().validate(options)
  }

  getSnapshot(): WorkspaceSnapshot {
    const workspace = this.getWorkspaceOrThrow()
    const snapshot = workspace.getSnapshot()

    return {
      ...snapshot,
      devices: snapshot.devices.map((device) => ({
        ...device,
        info: { ...device.info },
        position: { ...device.position },
        modules: device.modules.map((module) => ({
          ...module,
          communication: module.communication ? { ...module.communication } : undefined,
          config: module.config ? { ...module.config } : undefined,
        })),
      })),
      possibleConnections: this.findPossibleConnections(snapshot),
    }
  }

  getSpatialIndexSnapshot(): WorkspaceSpatialIndexSnapshot {
    return this.getWorkspaceOrThrow().getSpatialIndexSnapshot()
  }

  getRuntimeContext(): { workspace?: Workspace } {
    return this.workspace ? { workspace: this.workspace } : {}
  }

  private createLoRaConfigPatch(patch: WorkspaceModulePatchDto): LoRaModuleConfigPatch {
    const radioPatch: NonNullable<LoRaModuleConfigPatch['radio']> = {}

    if (patch.communication?.bandwidthHz !== undefined) {
      radioPatch.bandwidthHz = patch.communication.bandwidthHz
    }

    if (patch.communication?.spreadingFactor !== undefined) {
      radioPatch.spreadingFactor = patch.communication.spreadingFactor
    }

    if (patch.communication?.codingRate !== undefined) {
      radioPatch.codingRate = patch.communication.codingRate
    }

    if (patch.communication?.txPowerDbm !== undefined) {
      radioPatch.txPowerDbm = patch.communication.txPowerDbm
    }

    if (patch.communication?.maxRangeMeters !== undefined) {
      radioPatch.maxRangeMeters = patch.communication.maxRangeMeters
    }

    if (patch.communication?.maxConnections !== undefined) {
      radioPatch.maxConnections = patch.communication.maxConnections
    }

    return {
      radio: radioPatch,
    }
  }

  private resolveLoRaAddressForNewDevice(params: {
    workspace: Workspace
    deviceId: string
    loraAddress?: string
    shouldGenerate: boolean
  }): string | undefined {
    const address = params.loraAddress?.trim() || (params.shouldGenerate ? createDefaultLoRaAddress(params.deviceId) : undefined)

    if (!address) {
      return undefined
    }

    if (params.workspace.getDeviceByAddress(address)) {
      throw new WorkspaceSessionError(
        'LORA_ADDRESS_ALREADY_EXISTS',
        `LoRa address already exists: ${address}`,
        { loraAddress: address },
      )
    }

    return address
  }

  private findPossibleConnections(snapshot: WorkspaceSnapshot): WorkspacePossibleConnection[] {
    const workspace = this.getWorkspaceOrThrow()
    const devicesById = new Map(snapshot.devices.map((device) => [device.id, device]))
    const connections: WorkspacePossibleConnection[] = []

    for (const sourceDevice of snapshot.devices) {
      const sourceModule = getLoRaModule(sourceDevice)
      const communication = sourceModule?.communication

      if (!sourceModule || !communication || communication.maxRangeMeters <= 0) {
        continue
      }

      const sourceConnections = workspace
        .findNearbyDevices(sourceDevice.id, communication.maxRangeMeters)
        .map((nearbyDevice) => {
        const targetDevice = devicesById.get(nearbyDevice.deviceId)
        const targetModule = targetDevice ? getLoRaModule(targetDevice) : undefined

        if (!targetDevice || !targetModule) {
          return undefined
        }

        return {
          id: createConnectionId(sourceDevice.id, targetDevice.id, sourceModule.id),
          protocol: 'lora',
          sourceDeviceId: sourceDevice.id,
          targetDeviceId: targetDevice.id,
          sourceModuleId: sourceModule.id,
          targetModuleId: targetModule.id,
          distanceUnits: nearbyDevice.distanceUnits,
          distanceMeters: nearbyDevice.distanceMeters,
          maxRangeMeters: communication.maxRangeMeters,
          sourceLabel: communication.sourceLabel,
        } satisfies WorkspacePossibleConnection
        })
        .filter((connection): connection is WorkspacePossibleConnection => Boolean(connection))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, Math.max(0, Math.floor(communication.maxConnections ?? 8)))

      connections.push(...sourceConnections)
    }

    return connections.sort((a, b) => {
      if (a.sourceDeviceId === b.sourceDeviceId) {
        return a.distanceMeters - b.distanceMeters
      }

      return a.sourceDeviceId.localeCompare(b.sourceDeviceId)
    })
  }

  private findDeviceSnapshot(deviceId: string): WorkspaceDeviceSnapshot {
    const device = this.getSnapshot().devices.find((currentDevice) => currentDevice.id === deviceId)

    if (!device) {
      throw new WorkspaceSessionError('WORKSPACE_SESSION_DEVICE_NOT_FOUND', `Device not found: ${deviceId}`)
    }

    return device
  }

  private getWorkspaceOrThrow(): Workspace {
    if (!this.workspace) {
      throw new WorkspaceSessionError('WORKSPACE_SESSION_NOT_READY', 'Workspace project is not created')
    }

    return this.workspace
  }

  private withSnapshot(snapshot: WorkspaceSnapshot, events: WorkspaceSessionEvent[]): WorkspaceCommandResult {
    return {
      ok: true,
      snapshot,
      events,
    }
  }

  private createEvent(type: string, payload?: Record<string, unknown>): WorkspaceSessionEvent {
    return {
      id: createId('event'),
      type,
      timestamp: Date.now(),
      payload,
    }
  }
}
