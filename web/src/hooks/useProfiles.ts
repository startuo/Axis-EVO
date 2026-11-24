/** Model profile list: bootstrap seed + live profile.updated. */
import { useEffect, useState } from 'react';
import type { BootstrapState, Profile } from '@axis/protocol';
import { useSocketEvent } from './useSocket';

export function useProfiles(bootstrap: BootstrapState | null): Profile[] {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  useEffect(() => {
    if (bootstrap) setProfiles(bootstrap.profiles);
  }, [bootstrap]);
  useSocketEvent((e) => {
    if (e.type === 'profile.updated') {
      setProfiles((cur) => {
        const next = cur.filter((p) => p.id !== e.profile.id);
        next.push(e.profile);
        return next;
      });
    } else if (e.type === 'profile.removed') {
      setProfiles((cur) => cur.filter((profile) => profile.id !== e.profileId));
    }
  });
  return profiles;
}
