export class LoRaPhyCodecError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PHY_PAYLOAD_TOO_LARGE'
      | 'PHY_PREAMBLE_NOT_FOUND'
      | 'PHY_SYNC_WORD_MISMATCH'
      | 'PHY_HEADER_CRC_FAILED'
      | 'PHY_PAYLOAD_CRC_FAILED'
      | 'PHY_FEC_UNCORRECTABLE'
      | 'PHY_INVALID_PAYLOAD_LENGTH'
      | 'PHY_IMPLICIT_LENGTH_UNSUPPORTED',
  ) {
    super(message)
    this.name = 'LoRaPhyCodecError'
  }
}
