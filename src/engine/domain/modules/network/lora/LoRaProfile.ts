/**
 * LoRaProfile описывает режим работы LoRa-модуля.
 *
 * RAW_LORA — простая LoRa-передача без LoRaWAN.
 * LORAWAN — режим с логикой LoRaWAN.
 * LORA_MESH — mesh-режим, где устройства могут ретранслировать сообщения.
 */
export enum LoRaProfile {
  RAW_LORA = 'raw_lora',
  LORAWAN = 'lorawan',
  LORA_MESH = 'lora_mesh',
}