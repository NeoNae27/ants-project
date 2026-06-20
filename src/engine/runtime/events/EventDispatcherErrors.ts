export type EventDispatchErrorSeverity = 'recoverable' | 'fatal'

export type EventDispatchErrorCode =
  | 'EVENT_HANDLER_NOT_FOUND'
  | 'DEVICE_NOT_FOUND'
  | 'TARGET_MODULE_NOT_FOUND'
  | 'PACKET_DROPPED'
  | 'INVALID_EVENT_PAYLOAD'
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
