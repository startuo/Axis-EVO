import { HttpAxisClient, type AxisClient } from './httpAxisClient';

export type { AxisClient } from './httpAxisClient';
export { HttpAxisClient } from './httpAxisClient';

export const socket: AxisClient = new HttpAxisClient();
