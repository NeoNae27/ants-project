export type LoRaPingPayloadV1 = {
  schemaVersion: 1
  messageId: string
  sequence: number
  sentAtUnix: number
}

export type DecodedLoRaPingPayloadV1 = Omit<LoRaPingPayloadV1, 'messageId'> & {
  messageId?: string
}
