import type { DeviceCore } from '../device/DeviceCore'
import type { DeviceRole } from '../device/DeviceRole'
import type { DeviceModule } from '../module'
import { DeviceRegistry, type DeviceAddress, type DeviceId, type LoRaAddress, type ModuleId } from '../registry'
import type { NetworkEndpoint } from '../registry'
import { StubModule, type StubModuleConfig } from '../modules'
import { LoRaModule, type LoRaModuleConfigPatch } from '../modules/network/lora'
import { SpatialGrid, type SpatialIndex } from '../spatial'
import { createWorkspaceDeviceSnapshot, createWorkspaceSnapshot } from './WorkspaceMappers'
import { WorkspaceError } from './WorkspaceErrors'
import type {
  NearbyWorkspaceDevice,
  DeviceRegistryQueryPort,
  WorkspaceAddDeviceOptions,
  WorkspaceConfig,
  WorkspacePosition,
  WorkspaceSnapshot,
  WorkspaceValidationIssue,
  WorkspaceValidationResult,
} from './WorkspaceTypes'

type WorkspaceRuntimeDependencies = {
  registry?: DeviceRegistry
  spatialIndex?: SpatialIndex
}

type WorkspaceRuntimeConfig = Pick<
  WorkspaceConfig,
  'id' | 'name' | 'width' | 'height' | 'metersPerUnit'
>

export class Workspace {
  private readonly config: WorkspaceRuntimeConfig
  private readonly registry: DeviceRegistry
  private readonly spatialIndex: SpatialIndex
  private readonly placementIndex = new Map<DeviceId, WorkspacePosition>()

  constructor(config: WorkspaceConfig, dependencies?: WorkspaceRuntimeDependencies) {
    this.assertConfig(config)

    this.config = {
      id: config.id,
      name: config.name,
      width: config.width,
      height: config.height,
      metersPerUnit: config.metersPerUnit,
    }
    this.registry = dependencies?.registry ?? new DeviceRegistry()
    this.spatialIndex =
      dependencies?.spatialIndex ??
      new SpatialGrid({
        width: config.width,
        height: config.height,
        metersPerUnit: config.metersPerUnit,
        cellSize: config.cellSize ?? this.getDefaultCellSize(config),
      })
  }

  getConfig(): WorkspaceRuntimeConfig {
    return { ...this.config }
  }

  addDevice(device: DeviceCore, position: WorkspacePosition, options?: WorkspaceAddDeviceOptions): void {
    const deviceId = this.getDeviceId(device)
    this.assertDeviceId(deviceId)
    this.assertPosition(position)

    if (this.registry.has(deviceId) || this.placementIndex.has(deviceId)) {
      throw new WorkspaceError(
        'WORKSPACE_DEVICE_ALREADY_PLACED',
        `Device is already placed in workspace: ${deviceId}`,
        { deviceId },
      )
    }

    this.registry.add(device, options)

    try {
      this.spatialIndex.insert(deviceId, position)
    } catch (error) {
      this.registry.remove(deviceId)
      throw error
    }

    this.placementIndex.set(deviceId, { ...position })
  }

  removeDevice(deviceId: DeviceId): void {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)

    const position = this.getStoredPositionOrThrow(deviceId)
    this.registry.getOrThrow(deviceId)
    this.registry.getLoRaAddress(deviceId)

    this.spatialIndex.remove(deviceId)

    try {
      this.registry.remove(deviceId)
    } catch (error) {
      try {
        this.spatialIndex.insert(deviceId, position)
      } catch (rollbackError) {
        throw new WorkspaceError(
          'WORKSPACE_OPERATION_ROLLBACK_FAILED',
          `Failed to restore spatial position after registry remove failure: ${deviceId}`,
          { deviceId, error, rollbackError },
        )
      }

      throw error
    }

    this.placementIndex.delete(deviceId)
  }

  moveDevice(deviceId: DeviceId, nextPosition: WorkspacePosition): void {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)
    this.assertPosition(nextPosition)

    this.spatialIndex.update(deviceId, nextPosition)
    this.placementIndex.set(deviceId, { ...nextPosition })
  }

  findNearbyDevices(deviceId: DeviceId, rangeMeters: number): NearbyWorkspaceDevice[] {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)

    if (!Number.isFinite(rangeMeters) || rangeMeters <= 0) {
      throw new WorkspaceError('WORKSPACE_RANGE_INVALID', 'Range must be a positive finite number', {
        deviceId,
        rangeMeters,
      })
    }

    const sourcePosition = this.getStoredPositionOrThrow(deviceId)
    const rangeUnits = rangeMeters / this.config.metersPerUnit

    return this.spatialIndex
      .findNearbyWithDistance(sourcePosition, rangeUnits)
      .filter((result) => result.deviceId !== deviceId)
      .map((result) => ({
        deviceId: result.deviceId,
        distanceUnits: result.distanceUnits,
        distanceMeters: result.distanceMeters,
      }))
  }

  getDevice(deviceId: DeviceId): DeviceCore | undefined {
    this.assertDeviceId(deviceId)
    return this.registry.get(deviceId)
  }

  getDeviceByAddress(address: DeviceAddress): DeviceCore | undefined {
    return this.registry.getByAddress(address)
  }

  hasDevice(deviceId: DeviceId): boolean {
    this.assertDeviceId(deviceId)
    return this.registry.has(deviceId)
  }

  listDevices(): readonly DeviceCore[] {
    return this.registry.list()
  }

  listDevicesByRole(role: DeviceRole): readonly DeviceCore[] {
    return this.registry.listByRole(role)
  }

  getDevicePosition(deviceId: DeviceId): WorkspacePosition | undefined {
    this.assertDeviceId(deviceId)
    const position = this.placementIndex.get(deviceId)
    return position ? { ...position } : undefined
  }

  getAddress(deviceId: DeviceId): DeviceAddress | undefined {
    this.assertDeviceId(deviceId)
    return this.registry.getLoRaAddress(deviceId)
  }

  assignDeviceLoRaAddress(deviceId: DeviceId, loraAddress: LoRaAddress, moduleId?: ModuleId): void {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)
    const targetModuleId = moduleId ?? this.getFirstLoRaModuleId(deviceId)

    this.assignModuleEndpoint(deviceId, targetModuleId, {
      protocol: 'lora',
      address: loraAddress,
    })
  }

  assignModuleEndpoint(
    deviceId: DeviceId,
    moduleId: ModuleId,
    endpoint: Omit<NetworkEndpoint, 'deviceId' | 'moduleId'>,
  ): void {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)
    this.assertDeviceModule(deviceId, moduleId)

    this.registry.registerEndpoint({
      deviceId,
      moduleId,
      ...endpoint,
    })
  }

  addModule(deviceId: DeviceId, module: DeviceModule): void {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)
    const device = this.registry.getOrThrow(deviceId)

    device.addModule(module)

    try {
      this.registry.registerModule(deviceId, module)
    } catch (error) {
      try {
        device.removeModule(module.id)
      } catch (rollbackError) {
        throw new WorkspaceError(
          'WORKSPACE_OPERATION_ROLLBACK_FAILED',
          `Failed to rollback module add after registry update failure: ${module.id}`,
          { deviceId, moduleId: module.id, error, rollbackError },
        )
      }

      throw error
    }
  }

  removeModule(deviceId: DeviceId, moduleId: ModuleId): void {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)
    const device = this.registry.getOrThrow(deviceId)
    const module = this.assertDeviceModule(deviceId, moduleId)

    device.removeModule(moduleId)

    try {
      this.registry.unregisterModule(moduleId)
    } catch (error) {
      try {
        device.addModule(module)
      } catch (rollbackError) {
        throw new WorkspaceError(
          'WORKSPACE_OPERATION_ROLLBACK_FAILED',
          `Failed to rollback module remove after registry update failure: ${moduleId}`,
          { deviceId, moduleId, error, rollbackError },
        )
      }

      throw error
    }
  }

  updateLoRaModuleConfig(deviceId: DeviceId, moduleId: ModuleId, patch: LoRaModuleConfigPatch): void {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)
    const module = this.assertDeviceModule(deviceId, moduleId)

    if (!(module instanceof LoRaModule)) {
      throw new WorkspaceError('WORKSPACE_MODULE_TYPE_INVALID', `Module is not a LoRa module: ${moduleId}`, {
        deviceId,
        moduleId,
      })
    }

    module.updateConfig(patch)
  }

  updateStubModuleConfig(deviceId: DeviceId, moduleId: ModuleId, patch: StubModuleConfig): void {
    this.assertDeviceId(deviceId)
    this.assertPlacedDevice(deviceId)
    const module = this.assertDeviceModule(deviceId, moduleId)

    if (!(module instanceof StubModule)) {
      throw new WorkspaceError('WORKSPACE_MODULE_TYPE_INVALID', `Module is not a stub module: ${moduleId}`, {
        deviceId,
        moduleId,
      })
    }

    module.updateConfig(patch)
  }

  getRegistryQueries(): DeviceRegistryQueryPort {
    return {
      has: (deviceId) => this.registry.has(deviceId),
      getLoRaAddress: (deviceId, moduleId) => this.registry.getLoRaAddress(deviceId, moduleId),
      getEndpointsByDevice: (deviceId) => this.registry.getEndpointsByDevice(deviceId),
      getEndpointsByModule: (moduleId) => this.registry.getEndpointsByModule(moduleId),
      size: () => this.registry.size(),
    }
  }

  getSnapshot(): WorkspaceSnapshot {
    const devices = this.registry.list().map((device) => {
      const deviceId = this.getDeviceId(device)
      const position = this.getStoredPositionOrThrow(deviceId)

      return createWorkspaceDeviceSnapshot({
        device,
        position,
        address: this.registry.getLoRaAddress(deviceId),
        networkEndpoints: this.registry.getEndpointsByDevice(deviceId),
      })
    })

    return createWorkspaceSnapshot(this.config, devices)
  }

  validate(): WorkspaceValidationResult {
    const issues: WorkspaceValidationIssue[] = []

    if (
      this.registry.size() !== this.placementIndex.size ||
      this.registry.size() !== this.spatialIndex.size()
    ) {
      issues.push({
        code: 'WORKSPACE_INDEX_SIZE_MISMATCH',
        message: 'Registry, placement index and spatial index sizes must match',
        severity: 'error',
      })
    }

    return {
      valid: issues.every((issue) => issue.severity !== 'error'),
      issues,
    }
  }

  private getDeviceId(device: DeviceCore): DeviceId {
    return device.getInfo().id
  }

  private assertConfig(config: WorkspaceConfig): void {
    if (!config.id.trim() || !config.name.trim()) {
      throw new WorkspaceError('WORKSPACE_CONFIG_INVALID', 'Workspace id and name are required')
    }

    if (
      !Number.isFinite(config.width) ||
      !Number.isFinite(config.height) ||
      !Number.isFinite(config.metersPerUnit)
    ) {
      throw new WorkspaceError('WORKSPACE_CONFIG_INVALID', 'Workspace dimensions and scale must be finite')
    }

    if (config.width <= 0 || config.height <= 0 || config.metersPerUnit <= 0) {
      throw new WorkspaceError('WORKSPACE_CONFIG_INVALID', 'Workspace dimensions and scale must be positive')
    }

    if (config.cellSize !== undefined && (!Number.isFinite(config.cellSize) || config.cellSize <= 0)) {
      throw new WorkspaceError('WORKSPACE_CONFIG_INVALID', 'Workspace cell size must be positive')
    }
  }

  private assertDeviceId(deviceId: DeviceId): void {
    if (!deviceId.trim()) {
      throw new WorkspaceError('WORKSPACE_DEVICE_NOT_FOUND', 'Device id is required')
    }
  }

  private assertPlacedDevice(deviceId: DeviceId): void {
    if (!this.registry.has(deviceId) || !this.placementIndex.has(deviceId)) {
      throw new WorkspaceError('WORKSPACE_DEVICE_NOT_FOUND', `Device not found in workspace: ${deviceId}`, {
        deviceId,
      })
    }
  }

  private assertPosition(position: WorkspacePosition): void {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new WorkspaceError('WORKSPACE_POSITION_INVALID', 'Position coordinates must be finite', {
        position,
      })
    }

    if (
      position.x < 0 ||
      position.y < 0 ||
      position.x > this.config.width ||
      position.y > this.config.height
    ) {
      throw new WorkspaceError('WORKSPACE_POSITION_OUT_OF_BOUNDS', 'Position is outside workspace bounds', {
        position,
        bounds: {
          width: this.config.width,
          height: this.config.height,
        },
      })
    }
  }

  private getStoredPositionOrThrow(deviceId: DeviceId): WorkspacePosition {
    const position = this.placementIndex.get(deviceId)

    if (!position) {
      throw new WorkspaceError('WORKSPACE_DEVICE_NOT_FOUND', `Device position not found: ${deviceId}`, {
        deviceId,
      })
    }

    return { ...position }
  }

  private assertDeviceModule(deviceId: DeviceId, moduleId: ModuleId): DeviceModule {
    if (!moduleId.trim()) {
      throw new WorkspaceError('WORKSPACE_MODULE_NOT_FOUND', 'Module id is required', {
        deviceId,
        moduleId,
      })
    }

    const registeredModule = this.registry.getModule(moduleId)

    if (!registeredModule || registeredModule.deviceId !== deviceId) {
      throw new WorkspaceError('WORKSPACE_MODULE_NOT_FOUND', `Device module not found: ${moduleId}`, {
        deviceId,
        moduleId,
      })
    }

    return registeredModule.module
  }

  private getFirstLoRaModuleId(deviceId: DeviceId): ModuleId {
    const modules = this.registry.listModulesByDevice(deviceId)
    const loraModule = modules.find((registeredModule) => {
      const snapshot = registeredModule.module.getSnapshot()

      if (typeof snapshot !== 'object' || snapshot === null) {
        return false
      }

      const config = (snapshot as Record<string, unknown>).config

      return (
        typeof config === 'object' &&
        config !== null &&
        'radio' in (config as Record<string, unknown>)
      )
    })

    if (!loraModule) {
      throw new WorkspaceError('WORKSPACE_MODULE_NOT_FOUND', `LoRa module not found for device: ${deviceId}`, {
        deviceId,
      })
    }

    return loraModule.module.id
  }

  private getDefaultCellSize(config: WorkspaceConfig): number {
    return Math.max(1, Math.min(config.width, config.height, 100))
  }
}
