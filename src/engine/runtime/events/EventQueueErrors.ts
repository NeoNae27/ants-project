export type EventQueueErrorCode =
  | 'EVENT_ID_REQUIRED'
  | 'EVENT_ID_DUPLICATE'
  | 'EVENT_TYPE_REQUIRED'
  | 'EVENT_TIME_NOT_FINITE'
  | 'EVENT_TIME_NEGATIVE'
  | 'EVENT_SCHEDULED_BEFORE_CREATED'
  | 'EVENT_PRIORITY_NOT_FINITE'
  | 'EVENT_PRIORITY_NEGATIVE'
  | 'EVENT_NOW_NOT_FINITE'
  | 'EVENT_NOW_NEGATIVE'
  | 'EVENT_TARGET_EMPTY'

export class EventQueueError extends Error {
  constructor(
    public readonly code: EventQueueErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'EventQueueError'
  }
}
