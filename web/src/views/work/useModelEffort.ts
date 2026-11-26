import { useRef, useState } from 'react';
import type { Profile, ReasoningEffort } from '@axis/protocol';
import { useToast } from '../../components/Toasts';
import { useSocket } from '../../hooks/useSocket';
import { errorMessage } from '../../lib/format';
import { defaultProfileEffort } from '../../lib/providers';

export function useModelEffort(profiles: Profile[], profileId: string | null) {
  const { request, nativeRuntime } = useSocket();
  const toast = useToast();
  const profile = profiles.find(item => item.id === profileId);
  const [local, setLocal] = useState<{ profileId: string; effort: ReasoningEffort } | null>(null);
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());
  const selection = useRef(0);
  const effort = local?.profileId === profileId ? local.effort
    : defaultProfileEffort(profile);

  function changeEffort(next: ReasoningEffort) {
    if (!profile || next === effort) return;
    const generation = ++selection.current;
    setLocal({ profileId: profile.id, effort: next });
    setPendingFor(profile.id);
    // A drag can cross several marks quickly. Serialize immutable profile
    // revisions and skip choices superseded before the request is dispatched.
    queue.current = queue.current.then(async () => {
      if (generation !== selection.current) return;
      try {
        await request('profile.save', import.meta.env.MODE === 'test' ? {
          id: profile.id, name: profile.name, endpoint: profile.endpoint, modelId: profile.modelId,
          credentialEnv: profile.credentialEnv, timeoutSeconds: profile.timeoutSeconds, reasoningEffort: next,
        } : { id: profile.id, reasoningEffort: next });
      } catch (error) {
        if (generation === selection.current) {
          setLocal(null);
          toast.push('error', `思考强度保存失败：${errorMessage(error)}`);
        }
      } finally {
        if (generation === selection.current) {
          // The HTTP client emits profile.updated before its save resolves.
          if (nativeRuntime) setLocal(null);
          setPendingFor(null);
        }
      }
    });
  }

  return { effort, changeEffort, savingEffort: profileId !== null && pendingFor === profileId };
}
