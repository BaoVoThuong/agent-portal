/**
 * A value that can be selected from a searchable list. `keywords` are optional
 * searchable aliases (for example a person's email) and are never displayed
 * or persisted as the selected value.
 */
export type SearchableChoice = {
  value: string;
  label: string;
  keywords?: readonly string[];
  disabled?: boolean;
};

/**
 * Normalize user-facing text for matching without changing the canonical
 * value. NFKD handles combining accents; Vietnamese Đ/đ needs an explicit
 * mapping because it does not decompose into D/d.
 */
export function normalizeOptionSearchText(value: string): string {
  return value
    .replace(/[Đđ]/g, (character) => (character === "Đ" ? "D" : "d"))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Filter in source order. Every query token must occur in the label or one of
 * the optional aliases, which supports searches such as "blue adv" and
 * person searches by either name or email.
 */
export function filterSearchableChoices(
  choices: readonly SearchableChoice[],
  query: string
): SearchableChoice[] {
  const normalizedQuery = normalizeOptionSearchText(query);
  if (!normalizedQuery) return [...choices];

  const tokens = normalizedQuery.split(" ");
  return choices.filter((choice) => {
    const haystack = normalizeOptionSearchText(
      [choice.label, ...(choice.keywords ?? [])].join(" ")
    );
    return tokens.every((token) => haystack.includes(token));
  });
}

/** Return whether an item may receive keyboard focus/selection. */
function isEnabled(choice: SearchableChoice | undefined): boolean {
  return Boolean(choice && !choice.disabled);
}

/**
 * Choose the initial active result. A selected value wins only when it is
 * present and enabled; otherwise the first enabled result is used.
 */
export function initialEnabledChoiceIndex(
  choices: readonly SearchableChoice[],
  selectedValue?: string
): number {
  if (selectedValue !== undefined) {
    const selectedIndex = choices.findIndex(
      (choice) => choice.value === selectedValue && isEnabled(choice)
    );
    if (selectedIndex >= 0) return selectedIndex;
  }

  return choices.findIndex((choice) => isEnabled(choice));
}

/**
 * Move to the next/previous enabled result. Navigation is clamped at the
 * bounds rather than wrapping, and disabled choices are skipped.
 */
export function moveEnabledChoiceIndex(
  choices: readonly SearchableChoice[],
  currentIndex: number,
  direction: -1 | 1
): number {
  if (choices.length === 0) return -1;

  if (currentIndex < 0 || currentIndex >= choices.length) {
    if (direction > 0) return initialEnabledChoiceIndex(choices);
    for (let index = choices.length - 1; index >= 0; index -= 1) {
      if (isEnabled(choices[index])) return index;
    }
    return -1;
  }

  for (
    let index = currentIndex + direction;
    index >= 0 && index < choices.length;
    index += direction
  ) {
    if (isEnabled(choices[index])) return index;
  }

  if (isEnabled(choices[currentIndex])) return currentIndex;
  return initialEnabledChoiceIndex(choices);
}
