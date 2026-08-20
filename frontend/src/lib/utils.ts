import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes so the LAST conflicting utility wins.
 *
 * clsx flattens conditionals; twMerge then resolves collisions that plain
 * concatenation cannot — `cn('px-2', 'px-4')` is `px-4`, not both. Every shadcn
 * component takes a `className` prop and folds it in through here, which is what
 * lets a caller override a variant's padding or colour without `!important` or
 * fighting specificity.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
