export type RadioProtocol = 'lora'

export type TransmissionDropReason =
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_POSITION_MISSING'
  | 'NO_RECEIVERS_FOUND'
  | 'OUT_OF_RANGE'
  | 'LINK_BUDGET_TOO_LOW'
  | 'FREQUENCY_MISMATCH'
  | 'BANDWIDTH_MISMATCH'
  | 'SPREADING_FACTOR_MISMATCH'
  | 'RECEIVER_NOT_AVAILABLE'
  | 'CHANNEL_MODEL_REJECTED'

export type RadioLinkStatus =
  | 'reachable'
  | 'weak'
  | 'lost'
  | 'invalid_config'

export type RadioLinkSnapshot = {
  id: string
  sourceDeviceId: string
  targetDeviceId: string
  protocol: RadioProtocol
  status: RadioLinkStatus
  distanceMeters: number
  rssiDbm?: number
  snrDb?: number
  pathLossDb?: number
  rxPowerDbm?: number
  rxSensitivityDbm?: number
  linkMarginDb?: number
  delayMs?: number
  reason?: TransmissionDropReason
  updatedAt: number
}
