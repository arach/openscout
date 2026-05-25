/**
 * Tiny className concat helper. Returns a single string of truthy
 * class tokens — no need for clsx for this scope.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
