export type DeviceCoreConfig = {
  heartbeatIntervalMs: number
  transmissionIntervalMs: number
  maxRetries: number
  powerMode: 'normal' | 'low_power' // Not finale
}