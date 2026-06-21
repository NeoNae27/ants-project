export const TelemetrySensorFlags = {
  AIR_TEMPERATURE: 1 << 0,
  AIR_HUMIDITY: 1 << 1,
  SOIL_TEMPERATURE: 1 << 2,
  SOIL_MOISTURE: 1 << 3,
  CO2: 1 << 4,
  BATTERY: 1 << 5,
} as const

export type TelemetryPayloadV1 = {
  schemaVersion: 1
  messageId: string
  sequence: number
  measuredAtUnix: number
  sensorFlags: number
  airTempCentiC?: number
  airHumidityCentiPct?: number
  soilTempCentiC?: number
  soilMoistureCentiPct?: number
  co2ppm?: number
  batteryPermille?: number
}

export type DecodedTelemetryPayloadV1 = Omit<TelemetryPayloadV1, 'messageId'> & {
  messageId?: string
}
