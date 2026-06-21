import type { EventHandlerMap } from './EventDispatcherTypes'
import {
  DeviceStateChangeHandler,
  GatewayPacketReceivedHandler,
  LoRaCodecSendHandler,
  LoRaPingSendHandler,
  PacketDeliveryHandler,
  PacketLostHandler,
  TelemetrySampleHandler,
  TelemetrySendHandler
} from './handlers'
import { RuntimeEventType } from './RuntimeEventTypes'

export function createDefaultRuntimeEventHandlers(): EventHandlerMap {
  return {
    [RuntimeEventType.TELEMETRY_SAMPLE]: TelemetrySampleHandler,
    [RuntimeEventType.TELEMETRY_SEND]: TelemetrySendHandler,
    [RuntimeEventType.LORA_CODEC_SEND]: LoRaCodecSendHandler,
    [RuntimeEventType.LORA_PING_SEND]: LoRaPingSendHandler,
    [RuntimeEventType.PACKET_DELIVERY]: PacketDeliveryHandler,
    [RuntimeEventType.PACKET_LOST]: PacketLostHandler,
    [RuntimeEventType.DEVICE_STATE_CHANGE]: DeviceStateChangeHandler,
    [RuntimeEventType.GATEWAY_PACKET_RECEIVED]: GatewayPacketReceivedHandler
  }
}
