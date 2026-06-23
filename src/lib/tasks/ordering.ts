// Fractional ranking for card order within a column. The client computes the
// new position from the neighbours in the drop target and sends it to the API.
export function midpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
