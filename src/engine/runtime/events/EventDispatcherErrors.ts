export type EventDispatchErrorSeverity = 'recoverable' | 'fatal'

export type EventDispatchErrorCode =
  | 'EVENT_HANDLER_NOT_FOUND'
  | 'DEVICE_ID_REQUIRED'
  | 'GATEWAY_DEVICE_ID_REQUIRED'
  | 'TARGET_ADDRESS_REQUIRED'
  | 'PACKET_REQUIRED'
  | 'DEVICE_NOT_FOUND'
  | 'SOURCE_DEVICE_NOT_FOUND'
  | 'TARGET_DEVICE_NOT_FOUND'
  | 'SOURCE_LORA_ADDRESS_REQUIRED'
  | 'TARGET_LORA_ADDRESS_REQUIRED'
  | 'TARGET_GATEWAY_REQUIRED'
  | 'NETWORK_MODULE_NOT_FOUND'
  | 'SOURCE_NETWORK_MODULE_NOT_FOUND'
  | 'TARGET_NETWORK_MODULE_NOT_FOUND'
  | 'TARGET_MODULE_NOT_FOUND'
  | 'WIRELESS_MEDIUM_NOT_AVAILABLE'
  | 'PACKET_DROPPED'
  | 'PACKET_DELIVERY_FAILED'
  | 'INVALID_EVENT_PAYLOAD'
  | 'INVALID_INTERVAL'
  | 'INVALID_STATE_TRANSITION'
  | 'ACK_TIMEOUT'
  | 'EVENT_QUEUE_CORRUPTED'
  | 'CLOCK_MOVED_BACKWARD'
  | 'DUPLICATED_EVENT_ID'
  | 'REGISTRY_INCONSISTENT'
  | 'HANDLER_REGISTRY_BROKEN'
  | 'UNEXPECTED_STATE_MUTATION'
  | 'DISPATCH_CONTEXT_INVALID'
  | 'HANDLER_UNEXPECTED_ERROR'

export class EventDispatchError extends Error {
  constructor(
    public readonly code: EventDispatchErrorCode,
    public readonly severity: EventDispatchErrorSeverity,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'EventDispatchError'
  }
}

export function isEventDispatchError(error: unknown): error is EventDispatchError {
  return error instanceof EventDispatchError
}
