import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn-style class combiner. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}