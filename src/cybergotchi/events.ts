import { EventEmitter } from 'node:events';

export type CybergotchiEventType =
  | 'toolError'
  | 'toolSuccess'
  | 'longWait'
  | 'commit'
  | 'taskComplete'
  | 'userAddressed'
  | 'idle';

export interface CybergotchiEvent {
  type: CybergotchiEventType;
  toolName?: string;
  text?: string;
}

class CybergotchiEventEmitter extends EventEmitter {
  emit(event: 'cybergotchi', data: CybergotchiEvent): boolean {
    return super.emit('cybergotchi', data);
  }
  on(event: 'cybergotchi', listener: (data: CybergotchiEvent) => void): this {
    return super.on('cybergotchi', listener);
  }
  off(event: 'cybergotchi', listener: (data: CybergotchiEvent) => void): this {
    return super.off('cybergotchi', listener);
  }
}

export const cybergotchiEvents = new CybergotchiEventEmitter();
