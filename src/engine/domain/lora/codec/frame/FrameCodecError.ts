export class FrameCodecError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'FRAME_TOO_SHORT'
      | 'FRAME_VERSION_UNSUPPORTED'
      | 'FRAME_PAYLOAD_TOO_LARGE'
      | 'FRAME_PAYLOAD_LENGTH_INVALID'
      | 'FRAME_CRC_FAILED',
  ) {
    super(message)
    this.name = 'FrameCodecError'
  }
}
