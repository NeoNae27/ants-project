export type DeviceMessage = {
  id: string
  timestamp: number
  type: 'telemetry' | 'log' | 'control' | 'system'
  payload: unknown
  meta?: {
    retries?: number
    ttl?: number
    priority?: 'low' | 'normal' | 'high'
  }
}