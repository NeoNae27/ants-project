export enum MeshFrameType {
  DATA = 0x01,
  ACK = 0x02,
  HELLO = 0x03,
  ROUTE_REQUEST = 0x04,
  ROUTE_REPLY = 0x05,
  ROUTE_ADVERTISEMENT = 0x06,
}

export type MeshFrame = {
  version: 1
  src: number
  dst: number
  nextHop: number
  prevHop: number
  seq: number
  ttl: number
  hopCount: number
  type: MeshFrameType
  flags: number
  payload: Uint8Array
}
