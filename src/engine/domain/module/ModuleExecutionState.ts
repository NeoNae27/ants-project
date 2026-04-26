/**
 * ModuleExecutionState описывает, что модуль делает прямо сейчас.
 *
 * LifecycleState отвечает за "стадию жизни" модуля.
 * ExecutionState отвечает за "текущее действие" модуля.
 */
export enum ModuleExecutionState {
  /**
   * Модуль ничего не выполняет.
   */
  IDLE = 'idle',

  /**
   * Модуль выполняет действие.
   *
   * Например:
   * - LoRaModule передаёт пакет;
   * - SensorModule считывает значение;
   * - PowerModule пересчитывает заряд.
   */
  RUNNING = 'running',

  /**
   * Выполнение временно приостановлено.
   */
  PAUSED = 'paused',

  /**
   * Выполнение полностью остановлено.
   */
  STOPPED = 'stopped',
}