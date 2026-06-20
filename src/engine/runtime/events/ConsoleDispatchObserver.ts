import type { DispatchObserver, EventDispatchTrace } from './EventDispatcherTypes'

export class ConsoleDispatchObserver implements DispatchObserver {
  onDispatchStart(trace: EventDispatchTrace): void {
    console.log(`[dispatch:start] ${trace.eventType} ${trace.eventId}`)
  }

  onDispatchSuccess(trace: EventDispatchTrace): void {
    const scheduledSuffix =
      trace.scheduledEventIds.length > 0 ? ` scheduled=[${trace.scheduledEventIds.join(',')}]` : ''

    console.log(
      `[dispatch:ok] ${trace.eventType} ${trace.eventId} duration=${trace.durationWallMs ?? 0}ms${scheduledSuffix}`
    )
  }

  onDispatchFailure(trace: EventDispatchTrace): void {
    console.log(
      `[dispatch:failed] ${trace.eventType} ${trace.eventId} error=${trace.error?.code} severity=${trace.error?.severity}`
    )
  }
}
