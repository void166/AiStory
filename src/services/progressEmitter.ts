import { EventEmitter } from 'events';

export interface ProgressEvent {
  step: string;
  message: string;
  percent?: number;
  sceneIndex?: number;
  totalScenes?: number;
}

class ProgressEmitter extends EventEmitter {}
export const progressEmitter = new ProgressEmitter();
progressEmitter.setMaxListeners(200);

export function emitProgress(jobId: string, data: ProgressEvent): void {
  progressEmitter.emit(`job:${jobId}`, data);
}
