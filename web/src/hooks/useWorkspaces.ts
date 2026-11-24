/** Workspace list: bootstrap seed + live workspace.updated. */
import { useEffect, useState } from 'react';
import type { BootstrapState, Workspace } from '@axis/protocol';
import { useSocketEvent } from './useSocket';

export function useWorkspaces(bootstrap: BootstrapState | null): Workspace[] {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  useEffect(() => {
    if (bootstrap) setWorkspaces(bootstrap.workspaces);
  }, [bootstrap]);
  useSocketEvent((e) => {
    if (e.type === 'workspace.updated') {
      setWorkspaces((cur) => {
        const next = cur.filter((w) => w.id !== e.workspace.id);
        next.push(e.workspace);
        return next;
      });
    }
  });
  return workspaces;
}
