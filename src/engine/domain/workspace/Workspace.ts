import type { DeviceCore } from '../device/DeviceCore'
import { DeviceRole } from '../device/DeviceRole'
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
  WorkspaceDeviceSnapshot,
  WorkspacePossibleConnection,
  WorkspaceSnapshot,
  WorkspaceValidationIssue,
  WorkspaceValidationOptions,
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

  validate(options?: WorkspaceValidationOptions): WorkspaceValidationResult {
    const issues: WorkspaceValidationIssue[] = []
    const mode = options?.mode ?? 'project'
    const registryDevices = this.registry.list()
    const registryDeviceIds = new Set(registryDevices.map((device) => this.getDeviceId(device)))
    const placementDeviceIds = new Set(this.placementIndex.keys())

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

    for (const deviceId of registryDeviceIds) {
      const placementPosition = this.placementIndex.get(deviceId)
      const spatialPosition = this.spatialIndex.getPosition(deviceId)

      if (!placementPosition) {
        this.addValidationIssue(issues, 'WORKSPACE_DEVICE_MISSING_PLACEMENT', `Device is missing placement: ${deviceId}`, 'error', {
          deviceId,
        })
      }

      if (!spatialPosition) {
        this.addValidationIssue(issues, 'WORKSPACE_DEVICE_MISSING_SPATIAL_INDEX', `Device is missing spatial index entry: ${deviceId}`, 'error', {
          deviceId,
        })
      }

      if (placementPosition && !this.isPositionInsideBounds(placementPosition)) {
        this.addValidationIssue(issues, 'WORKSPACE_DEVICE_POSITION_OUT_OF_BOUNDS', `Device position is outside workspace bounds: ${deviceId}`, 'error', {
          deviceId,
          position: placementPosition,
          bounds: {
            width: this.config.width,
            height: this.config.height,
          },
        })
      }

      if (placementPosition && spatialPosition && !this.arePositionsEqual(placementPosition, spatialPosition)) {
        this.addValidationIssue(issues, 'WORKSPACE_DEVICE_SPATIAL_POSITION_MISMATCH', `Device placement and spatial index position differ: ${deviceId}`, 'error', {
          deviceId,
          placementPosition,
          spatialPosition,
        })
      }
    }

    for (const deviceId of placementDeviceIds) {
      if (!registryDeviceIds.has(deviceId)) {
        this.addValidationIssue(issues, 'WORKSPACE_PLACEMENT_DEVICE_NOT_REGISTERED', `Placement references a device not in registry: ${deviceId}`, 'error', {
          deviceId,
        })
      }
    }

    const endpointAddresses = new Set<DeviceAddress>()

    for (const device of registryDevices) {
      const deviceId = this.getDeviceId(device)
      const deviceModules = device.getModules()
      const deviceModuleIds = new Set(deviceModules.map((module) => module.id))
      const registeredModules = this.registry.listModulesByDevice(deviceId)

      for (const module of deviceModules) {
        const registeredModule = this.registry.getModule(module.id)

        if (!registeredModule || registeredModule.deviceId !== deviceId) {
          this.addValidationIssue(issues, 'WORKSPACE_DEVICE_MODULE_NOT_REGISTERED', `Device module is missing registry index: ${module.id}`, 'error', {
            deviceId,
            moduleId: module.id,
          })
        }
      }

      for (const registeredModule of registeredModules) {
        if (!deviceModuleIds.has(registeredModule.module.id)) {
          this.addValidationIssue(issues, 'WORKSPACE_REGISTERED_MODULE_MISSING_FROM_DEVICE', `Registered module is missing from DeviceCore: ${registeredModule.module.id}`, 'error', {
            deviceId,
            moduleId: registeredModule.module.id,
          })
        }
      }

      for (const endpoint of this.registry.getEndpointsByDevice(deviceId)) {
        const registeredModule = this.registry.getModule(endpoint.moduleId)

        if (!registeredModule || registeredModule.deviceId !== endpoint.deviceId) {
          this.addValidationIssue(issues, 'WORKSPACE_ENDPOINT_MODULE_NOT_FOUND', `Endpoint points to a missing module: ${endpoint.moduleId}`, 'error', {
            endpoint,
          })
        }

        if (endpointAddresses.has(endpoint.address)) {
          this.addValidationIssue(issues, 'WORKSPACE_ENDPOINT_ADDRESS_DUPLICATE', `Endpoint address is duplicated: ${endpoint.address}`, 'error', {
            endpoint,
          })
        }

        endpointAddresses.add(endpoint.address)

        const addressEndpoint = this.registry.getEndpointByAddress(endpoint.address)

        if (!addressEndpoint || !this.areEndpointsEqual(addressEndpoint, endpoint)) {
          this.addValidationIssue(issues, 'WORKSPACE_ENDPOINT_ADDRESS_INDEX_MISMATCH', `Endpoint address index is inconsistent: ${endpoint.address}`, 'error', {
            endpoint,
            addressEndpoint,
          })
        }

        const moduleEndpoints = this.registry.getEndpointsByModule(endpoint.moduleId)

        if (!moduleEndpoints.some((moduleEndpoint) => this.areEndpointsEqual(moduleEndpoint, endpoint))) {
          this.addValidationIssue(issues, 'WORKSPACE_ENDPOINT_MODULE_INDEX_MISMATCH', `Endpoint module index is inconsistent: ${endpoint.moduleId}`, 'error', {
            endpoint,
          })
        }
      }
    }

    const validatableDevices = this.createValidatableDeviceSnapshots(registryDevices)
    const possibleConnections = this.findPossibleLoRaConnections(validatableDevices)

    for (const connection of possibleConnections) {
      const sourceDevice = validatableDevices.find((device) => device.id === connection.sourceDeviceId)
      const targetDevice = validatableDevices.find((device) => device.id === connection.targetDeviceId)

      if (sourceDevice && sourceDevice.modules.length === 0) {
        this.addValidationIssue(issues, 'WORKSPACE_CONNECTION_SOURCE_HAS_NO_MODULES', `Connection source has no modules: ${sourceDevice.id}`, 'error', {
          connection,
        })
      }

      if (targetDevice && targetDevice.modules.length === 0) {
        this.addValidationIssue(issues, 'WORKSPACE_CONNECTION_TARGET_HAS_NO_MODULES', `Connection target has no modules: ${targetDevice.id}`, 'error', {
          connection,
        })
      }
    }

    if (mode === 'network') {
      const gatewayIds = new Set(
        validatableDevices
          .filter((device) => device.info.role === DeviceRole.GATEWAY)
          .map((device) => device.id),
      )

      if (validatableDevices.length > 0 && gatewayIds.size === 0) {
        this.addValidationIssue(issues, 'WORKSPACE_GATEWAY_REQUIRED', 'Network validation requires at least one gateway', 'error')
      }

      if (gatewayIds.size > 0) {
        const reachableDeviceIds = this.findDevicesThatCanReachGateways(possibleConnections, gatewayIds)

        for (const device of validatableDevices) {
          if (device.info.role !== DeviceRole.NODE || gatewayIds.has(device.id)) {
            continue
          }

          if (!reachableDeviceIds.has(device.id)) {
            this.addValidationIssue(issues, 'WORKSPACE_NODE_ISOLATED_FROM_GATEWAY', `Node has no possible path to a gateway: ${device.id}`, 'warning', {
              deviceId: device.id,
              gatewayIds: Array.from(gatewayIds),
            })
          }
        }
      }
    }

    return {
      valid: issues.every((issue) => issue.severity !== 'error'),
      issues,
    }
  }

  private addValidationIssue(
    issues: WorkspaceValidationIssue[],
    code: string,
    message: string,
    severity: WorkspaceValidationIssue['severity'],
    details?: Record<string, unknown>,
  ): void {
    issues.push({
      code,
      message,
      severity,
      ...(details ? { details } : {}),
    })
  }

  private isPositionInsideBounds(position: WorkspacePosition): boolean {
    return (
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      position.x >= 0 &&
      position.y >= 0 &&
      position.x <= this.config.width &&
      position.y <= this.config.height
    )
  }

  private arePositionsEqual(left: WorkspacePosition, right: WorkspacePosition): boolean {
    return left.x === right.x && left.y === right.y
  }

  private areEndpointsEqual(left: NetworkEndpoint, right: NetworkEndpoint): boolean {
    return (
      left.deviceId === right.deviceId &&
      left.moduleId === right.moduleId &&
      left.protocol === right.protocol &&
      left.address === right.address
    )
  }

  private createValidatableDeviceSnapshots(devices: readonly DeviceCore[]): WorkspaceDeviceSnapshot[] {
    return devices.flatMap((device) => {
      const deviceId = this.getDeviceId(device)
      const position = this.placementIndex.get(deviceId)

      if (!position || !this.isPositionInsideBounds(position)) {
        return []
      }

      return [
        createWorkspaceDeviceSnapshot({
          device,
          position,
          address: this.registry.getLoRaAddress(deviceId),
          networkEndpoints: this.registry.getEndpointsByDevice(deviceId),
        }),
      ]
    })
  }

  private findPossibleLoRaConnections(devices: readonly WorkspaceDeviceSnapshot[]): WorkspacePossibleConnection[] {
    const connections: WorkspacePossibleConnection[] = []

    for (const sourceDevice of devices) {
      const sourceModules = sourceDevice.modules.filter((module) => module.communication?.protocol === 'lora')

      for (const sourceModule of sourceModules) {
        const communication = sourceModule.communication

        if (!communication || communication.maxRangeMeters <= 0) {
          continue
        }

        const sourceConnections = devices
          .filter((targetDevice) => targetDevice.id !== sourceDevice.id)
          .map((targetDevice) => {
            const targetModule = targetDevice.modules.find((module) => module.communication?.protocol === 'lora')

            if (!targetModule) {
              return undefined
            }

            const distanceUnits = this.getDistanceUnits(sourceDevice.position, targetDevice.position)
            const distanceMeters = distanceUnits * this.config.metersPerUnit

            if (distanceMeters > communication.maxRangeMeters) {
              return undefined
            }

            return {
              id: `${sourceDevice.id}->${targetDevice.id}:${sourceModule.id}`,
              protocol: 'lora',
              sourceDeviceId: sourceDevice.id,
              targetDeviceId: targetDevice.id,
              sourceModuleId: sourceModule.id,
              targetModuleId: targetModule.id,
              distanceUnits,
              distanceMeters,
              maxRangeMeters: communication.maxRangeMeters,
              sourceLabel: communication.sourceLabel,
            } satisfies WorkspacePossibleConnection
          })
          .filter((connection): connection is WorkspacePossibleConnection => Boolean(connection))
          .sort((left, right) => left.distanceMeters - right.distanceMeters)
          .slice(0, Math.max(0, Math.floor(communication.maxConnections ?? 8)))

        connections.push(...sourceConnections)
      }
    }

    return connections
  }

  private getDistanceUnits(source: WorkspacePosition, target: WorkspacePosition): number {
    return Math.hypot(source.x - target.x, source.y - target.y)
  }

  private findDevicesThatCanReachGateways(
    connections: readonly WorkspacePossibleConnection[],
    gatewayIds: ReadonlySet<DeviceId>,
  ): Set<DeviceId> {
    const reverseAdjacency = new Map<DeviceId, Set<DeviceId>>()

    for (const connection of connections) {
      const incomingSources = reverseAdjacency.get(connection.targetDeviceId) ?? new Set<DeviceId>()
      incomingSources.add(connection.sourceDeviceId)
      reverseAdjacency.set(connection.targetDeviceId, incomingSources)
    }

    const reachable = new Set<DeviceId>(gatewayIds)
    const queue = Array.from(gatewayIds)

    while (queue.length > 0) {
      const currentDeviceId = queue.shift()

      if (!currentDeviceId) {
        continue
      }

      for (const sourceDeviceId of reverseAdjacency.get(currentDeviceId) ?? []) {
        if (reachable.has(sourceDeviceId)) {
          continue
        }

        reachable.add(sourceDeviceId)
        queue.push(sourceDeviceId)
      }
    }

    return reachable
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
