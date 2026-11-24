import type { BootstrapState } from '@axis/protocol';
import { socket } from './socket';

export async function fetchBootstrap(): Promise<BootstrapState> {
  return socket.bootstrap();
}
