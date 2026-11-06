import { cn } from '@/lib/utils';

/** Conbert logo: a wizard hat made of a folded document, with a spark. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('size-8', className)}>
      <path
        d="M8 54h48c2 0 3 1.5 3 3s-1 3-3 3H8c-2 0-3-1.5-3-3s1-3 3-3z"
        className="fill-violet-700"
      />
      <path d="M14 54 28 8l10 6-6 0 6 6-4 0 12 28z" className="fill-violet-600" />
      <path d="M28 8l10 6h-6z" className="fill-violet-300" />
      <path d="M20 40h22l3 8H18z" className="fill-violet-400" />
      <path
        d="M50 10l1.8 4.2L56 16l-4.2 1.8L50 22l-1.8-4.2L44 16l4.2-1.8z"
        className="fill-amber-400"
      />
      <circle cx="24" cy="30" r="2" className="fill-amber-400" />
    </svg>
  );
}
