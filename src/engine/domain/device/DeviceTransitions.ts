import { DeviceLifecycleState } from './DeviceLifecycleState'

/**
 * allowedDeviceTransitions описывает допустимые переходы lifecycle state.
 *
 * DeviceCore использует эту таблицу как единственный источник правил:
 * если перехода нет в списке, transitionTo должен отклонить его
 * доменной ошибкой DEVICE_INVALID_TRANSITION.
 */
export const allowedDeviceTransitions: Record<DeviceLifecycleState, DeviceLifecycleState[]> = {
  [DeviceLifecycleState.NEW]: [DeviceLifecycleState.COMMISSIONING],

  [DeviceLifecycleState.COMMISSIONING]: [
    DeviceLifecycleState.BOUND,
    DeviceLifecycleState.ORPHANED,
    DeviceLifecycleState.FAULT
  ],

  [DeviceLifecycleState.BOUND]: [
    DeviceLifecycleState.PROVISIONED,
    DeviceLifecycleState.ORPHANED,
    DeviceLifecycleState.FAULT
  ],

  [DeviceLifecycleState.PROVISIONED]: [
    DeviceLifecycleState.ACTIVE,
    DeviceLifecycleState.DECOMMISSIONED
  ],

  [DeviceLifecycleState.ACTIVE]: [
    DeviceLifecycleState.SLEEP,
    DeviceLifecycleState.ORPHANED,
    DeviceLifecycleState.FAULT,
    DeviceLifecycleState.DECOMMISSIONED
  ],

  [DeviceLifecycleState.SLEEP]: [
    DeviceLifecycleState.ACTIVE,
    DeviceLifecycleState.ORPHANED,
    DeviceLifecycleState.FAULT,
    DeviceLifecycleState.DECOMMISSIONED
  ],

  [DeviceLifecycleState.ORPHANED]: [
    DeviceLifecycleState.COMMISSIONING,
    DeviceLifecycleState.DECOMMISSIONED
  ],

  [DeviceLifecycleState.FAULT]: [
    DeviceLifecycleState.COMMISSIONING,
    DeviceLifecycleState.DECOMMISSIONED
  ],

  [DeviceLifecycleState.DECOMMISSIONED]: []
}
