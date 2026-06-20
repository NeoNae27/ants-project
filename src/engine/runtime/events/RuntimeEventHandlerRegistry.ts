import type { EventHandlerMap } from './EventDispatcherTypes'
import {
  DeviceStateChangeHandler,
  GatewayPacketReceivedHandler,
  PacketDeliveryHandler,
  TelemetrySampleHandler,
  TelemetrySendHandler
} from './handlers'
import { RuntimeEventType } from './RuntimeEventTypes'

export function createDefaultRuntimeEventHandlers(): EventHandlerMap {
  return {
    [RuntimeEventType.TELEMETRY_SAMPLE]: TelemetrySampleHandler,
    [RuntimeEventType.TELEMETRY_SEND]: TelemetrySendHandler,
    [RuntimeEventType.PACKET_DELIVERY]: PacketDeliveryHandler,
    [RuntimeEventType.DEVICE_STATE_CHANGE]: DeviceStateChangeHandler,
    [RuntimeEventType.GATEWAY_PACKET_RECEIVED]: GatewayPacketReceivedHandler
  }
}
