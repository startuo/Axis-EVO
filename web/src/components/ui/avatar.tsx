/** Avatar — dependency-free image + fallback (Radix Avatar is not installed).
 *  The fallback renders until the image loads, then unmounts (Radix-like). */
import { createContext, useContext, useState } from 'react';
import { cn } from '../../lib/utils';

interface AvatarState {
  loaded: boolean;
  setLoaded: (loaded: boolean) => void;
}

const AvatarContext = createContext<AvatarState | null>(null);

export function Avatar({ className, ...props }: React.ComponentProps<'span'>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <AvatarContext.Provider value={{ loaded, setLoaded }}>
      <span
        className={cn('relative flex size-9 shrink-0 overflow-hidden rounded-full bg-surface-2', className)}
        {...props}
      />
    </AvatarContext.Provider>
  );
}

export interface AvatarImageProps extends React.ComponentProps<'img'> {
  /** Called on load/error transitions (Radix Avatar parity). */
  onLoadingStatusChange?: (status: 'loading' | 'loaded' | 'error') => void;
}

export function AvatarImage({ className, src, alt = '', onLoad, onError, onLoadingStatusChange, ...props }: AvatarImageProps) {
  const avatar = useContext(AvatarContext);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  if (!src || status === 'error') return null;
  return (
    <img
      src={src}
      alt={alt}
      className={cn('aspect-square size-full object-cover', status !== 'loaded' && 'hidden', className)}
      onLoad={(e) => {
        setStatus('loaded');
        avatar?.setLoaded(true);
        onLoadingStatusChange?.('loaded');
        onLoad?.(e);
      }}
      onError={(e) => {
        setStatus('error');
        avatar?.setLoaded(false);
        onLoadingStatusChange?.('error');
        onError?.(e);
      }}
      {...props}
    />
  );
}

export function AvatarFallback({ className, ...props }: React.ComponentProps<'span'>) {
  const avatar = useContext(AvatarContext);
  if (avatar?.loaded) return null;
  return (
    <span
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
