import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Join class names, last one winning within a Tailwind family — shadcn's `cn`.
 *
 * The design doc's decision 7 dropped `tailwind-merge` on the grounds that a
 * package owning every class name in its subtree has no conflicts to reconcile.
 * The vendored components disprove it: one composer button arrives carrying
 * `size-8` (ui/button's icon variant), `size-6` (tooltip-icon-button) and
 * `size-7` (the caller), plus `rounded-lg` and `rounded-full`. All of them are
 * real rules, armour marks all of them `!important`, and the winner is then
 * Tailwind's own source order — so the button rendered 32px and square where the
 * website renders 28px and round. Order in the string, which is what every
 * shadcn-registry file is written against, only decides with this merge.
 *
 * Cost, measured on a Vite app that renders <Talk2ViewChat> and nothing else:
 * 407.1 KB gzip without it, 416.2 KB with — 9.1 KB, ~2%.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
