export enum DirectFrameType {
  DATA = 0x01,
  ACK = 0x02,
  HELLO = 0x03,
}

export type DirectFrame = {
  version: 1
  src: number
  dst: number
  seq: number
  type: DirectFrameType
  flags: number
  payload: Uint8Array
}
