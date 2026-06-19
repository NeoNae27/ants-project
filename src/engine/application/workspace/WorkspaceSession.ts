import { DeviceFactory } from '../../domain/device/DeviceFactory'
import { DeviceRole } from '../../domain/device/DeviceRole'
import type { DeviceModule } from '../../domain/module'
import { LoRaModule } from '../../domain/modules/network/lora'
import { ModuleFactory } from '../../domain/modules'
import { StubModule } from '../../domain/modules'
import { Workspace } from '../../domain/workspace'
import type {
  WorkspaceConfig,
  WorkspaceDeviceSnapshot,
  WorkspaceModuleSnapshot,
  WorkspacePossibleConnection,
  WorkspaceSnapshot,
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
  UpdateModuleCommand,
  WorkspaceCommand,
  WorkspaceCommandResult,
  WorkspaceModulePatchDto,
  WorkspaceModuleTemplateDto,
  WorkspaceSessionEvent,
} from '../../../shared/workspaceSession'
import { WorkspacePlacementService } from './WorkspacePlacementService'
import { WorkspaceSessionError } from './WorkspaceSessionErrors'

const DEFAULT_DEVICE_MODEL = 'ANT-UI-100'
const DEFAULT_DEVICE_VERSION = '1.0.0'
const DEFAULT_METERS_PER_UNIT = 10

type WorkspaceSessionDependencies = {
  moduleFactory?: ModuleFactory
  placementService?: WorkspacePlacementService
}

type ClipboardDeviceDto = {
  info: WorkspaceDeviceSnapshot['info']
  modules: WorkspaceModuleTemplateDto[]
  loraAddress?: string
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
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
          const validation = this.validateProject()
          return {
            ok: validation.valid,
            snapshot: this.getSnapshot(),
            validation,
            events,
          }
        }
        case 'workspace/get-snapshot':
          return this.withSnapshot(this.getSnapshot(), events)
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
    const modules = (command.modules ?? []).map((template) =>
      this.moduleFactory.createModule(template, {
        deviceId,
        loraAddress: command.loraAddress,
      }),
    )
    const device = DeviceFactory.createDevice({
      id: deviceId,
      model: command.model ?? DEFAULT_DEVICE_MODEL,
      version: DEFAULT_DEVICE_VERSION,
      role: toDeviceRole(command.role),
      name: command.name ?? `Device ${baseSnapshot.devices.length + 1}`,
      x: finalPosition.x,
      y: finalPosition.y,
      modules,
    })

    workspace.addDevice(device, finalPosition, {
      address: command.loraAddress,
    })

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

  addModule(command: AddModuleCommand): WorkspaceSnapshot {
    const workspace = this.getWorkspaceOrThrow()
    const device = workspace.getRegistryQueries().get(command.deviceId)

    if (!device) {
      throw new WorkspaceSessionError('WORKSPACE_SESSION_DEVICE_NOT_FOUND', `Device not found: ${command.deviceId}`)
    }

    const module = this.moduleFactory.createModule(command.template, {
      deviceId: command.deviceId,
      loraAddress: workspace.getRegistryQueries().getLoRaAddress(command.deviceId),
    })

    device.addModule(module)

    return this.getSnapshot()
  }

  updateModule(command: UpdateModuleCommand): WorkspaceSnapshot {
    const workspace = this.getWorkspaceOrThrow()
    const device = workspace.getRegistryQueries().get(command.deviceId)

    if (!device) {
      throw new WorkspaceSessionError('WORKSPACE_SESSION_DEVICE_NOT_FOUND', `Device not found: ${command.deviceId}`)
    }

    const module = device.getModule(command.moduleId)

    if (!module) {
      throw new WorkspaceSessionError('WORKSPACE_SESSION_MODULE_NOT_FOUND', `Module not found: ${command.moduleId}`)
    }

    this.applyModulePatch(module, command.patch)

    return this.getSnapshot()
  }

  assignDeviceLoRaAddress(command: AssignDeviceLoRaAddressCommand): WorkspaceSnapshot {
    this.getWorkspaceOrThrow().assignDeviceLoRaAddress(command.deviceId, command.loraAddress)
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

  validateProject(): WorkspaceValidationResult {
    return this.getWorkspaceOrThrow().validate()
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

  private applyModulePatch(module: DeviceModule | undefined, patch: WorkspaceModulePatchDto): void {
    if (!module) {
      throw new WorkspaceSessionError('WORKSPACE_SESSION_MODULE_NOT_FOUND', 'Module not found')
    }

    if (module instanceof LoRaModule && patch.communication) {
      const radioPatch: NonNullable<Parameters<LoRaModule['updateConfig']>[0]['radio']> = {}

      if (patch.communication.bandwidthHz !== undefined) {
        radioPatch.bandwidthHz = patch.communication.bandwidthHz
      }

      if (patch.communication.spreadingFactor !== undefined) {
        radioPatch.spreadingFactor = patch.communication.spreadingFactor
      }

      if (patch.communication.codingRate !== undefined) {
        radioPatch.codingRate = patch.communication.codingRate
      }

      if (patch.communication.txPowerDbm !== undefined) {
        radioPatch.txPowerDbm = patch.communication.txPowerDbm
      }

      if (patch.communication.maxRangeMeters !== undefined) {
        radioPatch.maxRangeMeters = patch.communication.maxRangeMeters
      }

      if (patch.communication.maxConnections !== undefined) {
        radioPatch.maxConnections = patch.communication.maxConnections
      }

      module.updateConfig({
        radio: radioPatch,
      })
      return
    }

    if (module instanceof StubModule) {
      module.updateConfig({
        ...(patch.config ?? {}),
        ...(patch.communication ? { communication: patch.communication } : {}),
      })
    }
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
