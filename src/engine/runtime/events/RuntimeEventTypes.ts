export const RuntimeEventType = {
  TELEMETRY_SAMPLE: 'device.telemetry_sample',
  TELEMETRY_SEND: 'device.telemetry_send',
  LORA_CODEC_SEND: 'device.lora_codec_send',
  LORA_PING_SEND: 'device.lora_ping_send',
  PACKET_DELIVERY: 'wireless.packet_delivery',
  PACKET_LOST: 'wireless.packet_lost',
  DEVICE_STATE_CHANGE: 'device.state_change',
  GATEWAY_PACKET_RECEIVED: 'gateway.packet_received'
} as const

export type RuntimeEventType = (typeof RuntimeEventType)[keyof typeof RuntimeEventType]
