import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function scoreTone(overall: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (overall === null) return 'none';
  return overall >= 70 ? 'good' : overall >= 45 ? 'warn' : 'bad';
}
