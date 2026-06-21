import type { DeviceCore } from '../../domain/device/DeviceCore'
import { LoRaModule, type LoRaPacket } from '../../domain/modules/network/lora'
import type { NetworkEndpoint } from '../../domain/registry'
import type { WorkspacePosition } from '../../domain/workspace'
import type { EventQueue } from '../events/EventQueue'
import type { DispatchContext, DispatchLoggerPort } from '../events/EventDispatcherTypes'
import { EventPriority } from '../events/EventQueueTypes'
import {
  findRuntimeDeviceByAddress,
  findRuntimeDeviceById,
  findRuntimeLoRaEndpoint,
  findRuntimeLoRaModule,
  getRuntimeDeviceId,
  isRuntimeLoRaModule
} from '../events/RuntimeEventContext'
import type {
  PacketDeliveryPayload,
  WirelessPacketLostPayload
} from '../events/RuntimeEventPayloads'
import { RuntimeEventType } from '../events/RuntimeEventTypes'
import type { ChannelModel } from './ChannelModel'
import type { RadioLinkSnapshot } from './RadioLinkSnapshot'
import {
  getOriginalLoRaPacket,
  isRadioPacket,
  toRadioPacketFromLoRaPacket,
  type RadioPacket,
  type TransmissionDropReason,
  type TransmissionResult
} from './RadioTypes'

export type WirelessMediumRuntimeContext = Partial<
  Omit<DispatchContext, 'simulationTimeMs' | 'eventQueue'>
>

export type WirelessMediumDeps = {
  eventQueue: EventQueue
  channelModel: ChannelModel
  now: () => number
  runtimeContextProvider?: () => WirelessMediumRuntimeContext
  logger?: DispatchLoggerPort
  scheduleLostEvents?: boolean
}

export type WirelessMediumTransmitOptions = {
  sourceDeviceId?: string
  parentEventId?: string
}

type RuntimeContextLookup = Pick<DispatchContext, 'workspace' | 'registry'>

type WirelessWorkspacePort = {
  getConfig?(): { metersPerUnit?: number }
  getDevice?(deviceId: string): DeviceCore | undefined
  getDeviceByAddress?(address: string): DeviceCore | undefined
  getDevicePosition?(deviceId: string): WorkspacePosition | undefined
  findNearbyDevices?(
    deviceId: string,
    rangeMeters: number
  ): Array<{
    deviceId: string
    distanceMeters: number
  }>
  getRegistryQueries?(): {
    getLoRaAddress(deviceId: string, moduleId?: string): string | undefined
    getEndpointsByDevice(deviceId: string): readonly NetworkEndpoint[]
    getEndpointsByModule(moduleId: string): readonly NetworkEndpoint[]
  }
}

type TargetCandidate = {
  deviceId: string
  address: string
  position: WorkspacePosition
  radio?: {
    frequencyHz?: number
    bandwidthHz?: number
    spreadingFactor?: number
    rxSensitivityDbm?: number
  }
}

export class WirelessMedium {
  private readonly eventQueue: EventQueue
  private readonly channelModel: ChannelModel
  private readonly now: () => number
  private readonly runtimeContextProvider?: () => WirelessMediumRuntimeContext
  private readonly logger?: DispatchLoggerPort
  private readonly scheduleLostEvents: boolean
  private readonly linksById = new Map<string, RadioLinkSnapshot>()
  private nextScheduledEventSequence = 1

  constructor(deps: WirelessMediumDeps) {
    this.eventQueue = deps.eventQueue
    this.channelModel = deps.channelModel
    this.now = deps.now
    this.runtimeContextProvider = deps.runtimeContextProvider
    this.logger = deps.logger
    this.scheduleLostEvents = deps.scheduleLostEvents ?? true
  }

  transmit(
    packet: LoRaPacket | RadioPacket,
    context?: DispatchContext,
    options: WirelessMediumTransmitOptions = {}
  ): TransmissionResult {
    const radioPacket = isRadioPacket(packet)
      ? packet
      : toRadioPacketFromLoRaPacket(packet, {
          ...(options.sourceDeviceId ? { sourceDeviceId: options.sourceDeviceId } : {})
        })
    const nowMs = context?.simulationTimeMs ?? this.now()
    const runtimeContext = this.getRuntimeContext(context)
    const workspace = toWorkspace(runtimeContext.workspace)
    const sourceDeviceId =
      options.sourceDeviceId ??
      radioPacket.sourceDeviceId ??
      this.findDeviceIdByAddress(runtimeContext, radioPacket.sourceAddress)

    if (!sourceDeviceId || !findRuntimeDeviceById(runtimeContext, sourceDeviceId)) {
      return this.emptyResult(radioPacket, sourceDeviceId ?? '', 'SOURCE_NOT_FOUND')
    }

    const sourcePosition = workspace?.getDevicePosition?.(sourceDeviceId)

    if (!sourcePosition) {
      return this.emptyResult(radioPacket, sourceDeviceId, 'SOURCE_POSITION_MISSING')
    }

    const candidates = this.findTargetCandidates({
      radioPacket,
      runtimeContext,
      workspace,
      sourceDeviceId
    })

    if (candidates.length === 0) {
      return this.emptyResult(radioPacket, sourceDeviceId, 'NO_RECEIVERS_FOUND')
    }

    const scheduledEventIds: string[] = []
    const targetDeviceIds: string[] = []
    const links: RadioLinkSnapshot[] = []
    const metersPerUnit = getMetersPerUnit(workspace)

    for (const candidate of candidates) {
      const distanceMeters = getDistanceMeters(sourcePosition, candidate.position, metersPerUnit)
      const evaluation = this.channelModel.evaluate({
        packet: radioPacket,
        source: {
          deviceId: sourceDeviceId,
          x: sourcePosition.x,
          y: sourcePosition.y
        },
        target: {
          deviceId: candidate.deviceId,
          x: candidate.position.x,
          y: candidate.position.y,
          ...(candidate.radio ? { radio: candidate.radio } : {})
        },
        distanceMeters,
        nowMs
      })

      this.recordLink(evaluation.link)
      links.push(evaluation.link)

      if (evaluation.canDeliver) {
        const deliveryEventId = this.schedulePacketDelivery({
          radioPacket,
          target: candidate,
          link: evaluation.link,
          delayMs: evaluation.delayMs,
          nowMs,
          eventQueue: context?.eventQueue ?? this.eventQueue,
          parentEventId: options.parentEventId
        })

        if (deliveryEventId) {
          scheduledEventIds.push(deliveryEventId)
          targetDeviceIds.push(candidate.deviceId)
        }
        continue
      }

      const lostEventId = this.schedulePacketLost({
        radioPacket,
        target: candidate,
        link: evaluation.link,
        reason: evaluation.reason ?? evaluation.link.reason ?? 'CHANNEL_MODEL_REJECTED',
        nowMs,
        eventQueue: context?.eventQueue ?? this.eventQueue,
        parentEventId: options.parentEventId
      })

      if (lostEventId) {
        scheduledEventIds.push(lostEventId)
      }
    }

    return {
      ok: targetDeviceIds.length > 0,
      packetId: radioPacket.id,
      sourceDeviceId,
      targetDeviceIds,
      scheduledDeliveries: targetDeviceIds.length,
      scheduledEventIds,
      links,
      ...(targetDeviceIds.length === 0
        ? { reason: links[0]?.reason ?? 'CHANNEL_MODEL_REJECTED' }
        : {})
    }
  }

  getLinks(): readonly RadioLinkSnapshot[] {
    return Array.from(this.linksById.values()).map((link) => ({ ...link }))
  }

  getLinksForDevice(deviceId: string): readonly RadioLinkSnapshot[] {
    return this.getLinks().filter(
      (link) => link.sourceDeviceId === deviceId || link.targetDeviceId === deviceId
    )
  }

  clearLinks(): void {
    this.linksById.clear()
  }

  private getRuntimeContext(context?: DispatchContext): DispatchContext {
    const provided = this.runtimeContextProvider?.() ?? {}

    return {
      simulationTimeMs: context?.simulationTimeMs ?? this.now(),
      eventQueue: context?.eventQueue ?? this.eventQueue,
      ...provided,
      ...context,
      workspace: context?.workspace ?? provided.workspace,
      registry: context?.registry ?? provided.registry,
      logger: context?.logger ?? provided.logger ?? this.logger
    }
  }

  private findTargetCandidates(params: {
    radioPacket: RadioPacket
    runtimeContext: RuntimeContextLookup
    workspace?: WirelessWorkspacePort
    sourceDeviceId: string
  }): TargetCandidate[] {
    const directTarget = this.findDirectTargetCandidate(params)

    if (directTarget) {
      return [directTarget]
    }

    const nearbyDevices = params.workspace?.findNearbyDevices?.(
      params.sourceDeviceId,
      params.radioPacket.radio.candidateSearchRadiusMeters
    ) ?? []

    return nearbyDevices.flatMap((nearbyDevice) => {
      const device = findRuntimeDeviceById(params.runtimeContext, nearbyDevice.deviceId)
      const position = params.workspace?.getDevicePosition?.(nearbyDevice.deviceId)

      if (!device || !position) {
        return []
      }

      const target = this.createTargetCandidate({
        runtimeContext: params.runtimeContext,
        device,
        position,
        targetAddress: params.radioPacket.targetAddress
      })

      return target ? [target] : []
    })
  }

  private findDirectTargetCandidate(params: {
    radioPacket: RadioPacket
    runtimeContext: RuntimeContextLookup
    workspace?: WirelessWorkspacePort
  }): TargetCandidate | undefined {
    const targetDevice =
      (params.radioPacket.targetDeviceId
        ? findRuntimeDeviceById(params.runtimeContext, params.radioPacket.targetDeviceId)
        : undefined) ??
      (params.radioPacket.targetAddress
        ? findRuntimeDeviceByAddress(params.runtimeContext, params.radioPacket.targetAddress)
        : undefined)

    if (!targetDevice) {
      return undefined
    }

    const targetDeviceId = getRuntimeDeviceId(targetDevice)
    const position = params.workspace?.getDevicePosition?.(targetDeviceId)

    if (!position) {
      return undefined
    }

    return this.createTargetCandidate({
      runtimeContext: params.runtimeContext,
      device: targetDevice,
      position,
      targetAddress: params.radioPacket.targetAddress
    })
  }

  private createTargetCandidate(params: {
    runtimeContext: RuntimeContextLookup
    device: DeviceCore
    position: WorkspacePosition
    targetAddress?: string
  }): TargetCandidate | undefined {
    const deviceId = getRuntimeDeviceId(params.device)
    const endpoint = findRuntimeLoRaEndpoint(params.runtimeContext, deviceId, params.targetAddress)
    const module = endpoint ? params.device.getModule(endpoint.moduleId) : findRuntimeLoRaModule(params.device)
    const loraModule =
      isRuntimeLoRaModule(module) ? module : module instanceof LoRaModule ? module : undefined

    if (!loraModule) {
      return undefined
    }

    const config = loraModule.getConfig()

    return {
      deviceId,
      address: endpoint?.address ?? params.targetAddress ?? deviceId,
      position: params.position,
      radio: {
        frequencyHz: config.radio.frequencyHz,
        bandwidthHz: config.radio.bandwidthHz,
        spreadingFactor: config.radio.spreadingFactor
      }
    }
  }

  private schedulePacketDelivery(params: {
    radioPacket: RadioPacket
    target: TargetCandidate
    link: RadioLinkSnapshot
    delayMs: number
    nowMs: number
    eventQueue: EventQueue
    parentEventId?: string
  }): string | undefined {
    const packet = getOriginalLoRaPacket(params.radioPacket)

    if (!packet) {
      return undefined
    }

    const id = this.createScheduledEventId(params.radioPacket.id, params.target.deviceId, 'delivery')
    const scheduled = params.eventQueue.schedule<PacketDeliveryPayload>({
      id,
      type: RuntimeEventType.PACKET_DELIVERY,
      scheduledAt: params.nowMs + params.delayMs,
      createdAt: params.nowMs,
      priority: EventPriority.WIRELESS_DELIVERY,
      source: { type: 'wireless_medium', id: 'wireless-medium' },
      target: { deviceId: params.target.deviceId },
      payload: {
        packet,
        targetAddress: params.target.address,
        targetDeviceId: params.target.deviceId,
        sourceDeviceId: params.link.sourceDeviceId,
        sentAtSimulationMs: params.nowMs,
        link: params.link
      },
      meta: {
        ...(params.parentEventId ? { parentEventId: params.parentEventId } : {})
      }
    })

    return scheduled.id
  }

  private schedulePacketLost(params: {
    radioPacket: RadioPacket
    target: TargetCandidate
    link: RadioLinkSnapshot
    reason: TransmissionDropReason
    nowMs: number
    eventQueue: EventQueue
    parentEventId?: string
  }): string | undefined {
    if (!this.scheduleLostEvents) {
      this.logger?.debug?.('wireless.packet_lost', {
        packetId: params.radioPacket.id,
        reason: params.reason,
        link: params.link
      })
      return undefined
    }

    const id = this.createScheduledEventId(params.radioPacket.id, params.target.deviceId, 'lost')
    const scheduled = params.eventQueue.schedule<WirelessPacketLostPayload>({
      id,
      type: RuntimeEventType.PACKET_LOST,
      scheduledAt: params.nowMs,
      createdAt: params.nowMs,
      priority: EventPriority.WIRELESS_DELIVERY,
      source: { type: 'wireless_medium', id: 'wireless-medium' },
      target: { deviceId: params.target.deviceId },
      payload: {
        radioPacket: params.radioPacket,
        packet: getOriginalLoRaPacket(params.radioPacket),
        sourceDeviceId: params.link.sourceDeviceId,
        targetDeviceId: params.target.deviceId,
        targetAddress: params.target.address,
        reason: params.reason,
        link: params.link,
        lostAtSimulationMs: params.nowMs
      },
      meta: {
        reason: params.reason,
        ...(params.parentEventId ? { parentEventId: params.parentEventId } : {})
      }
    })

    return scheduled.id
  }

  private recordLink(link: RadioLinkSnapshot): void {
    this.linksById.set(`${link.sourceDeviceId}->${link.targetDeviceId}`, { ...link })
  }

  private findDeviceIdByAddress(
    runtimeContext: RuntimeContextLookup,
    address: string
  ): string | undefined {
    const device = findRuntimeDeviceByAddress(runtimeContext, address)

    return device ? getRuntimeDeviceId(device) : undefined
  }

  private emptyResult(
    radioPacket: RadioPacket,
    sourceDeviceId: string,
    reason: TransmissionDropReason
  ): TransmissionResult {
    return {
      ok: false,
      packetId: radioPacket.id,
      sourceDeviceId,
      targetDeviceIds: [],
      scheduledDeliveries: 0,
      scheduledEventIds: [],
      links: [],
      reason
    }
  }

  private createScheduledEventId(packetId: string, targetDeviceId: string, suffix: string): string {
    const sequence = this.nextScheduledEventSequence
    this.nextScheduledEventSequence += 1

    return `wireless:${sanitizeEventIdPart(packetId)}:${targetDeviceId}:${suffix}:${sequence}`
  }
}

function toWorkspace(value: unknown): WirelessWorkspacePort | undefined {
  return typeof value === 'object' && value !== null
    ? (value as WirelessWorkspacePort)
    : undefined
}

function getMetersPerUnit(workspace?: WirelessWorkspacePort): number {
  const metersPerUnit = workspace?.getConfig?.().metersPerUnit

  return typeof metersPerUnit === 'number' && Number.isFinite(metersPerUnit) && metersPerUnit > 0
    ? metersPerUnit
    : 1
}

function getDistanceMeters(
  source: WorkspacePosition,
  target: WorkspacePosition,
  metersPerUnit: number
): number {
  return Math.hypot(source.x - target.x, source.y - target.y) * metersPerUnit
}

function sanitizeEventIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '_')
}
