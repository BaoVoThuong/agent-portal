// Display a person as a NAME, never a raw "user@domain" address.
// Prefer a real account name; otherwise render the email's local part as a
// name (john.doe@x.com -> "John Doe").

export function formatEmailAsName(email: string): string {
  const localPart = email.split("@")[0] ?? email;
  const name = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return name || email;
}

// Single source of truth for "how do we show this person": a real name if the
// account has one, else a name-ish rendering of the email. `labelByEmail` holds
// known account names (built from portal_account).
export function personLabel(
  email: string,
  labelByEmail?: Map<string, string>
): string {
  const name = labelByEmail?.get(email)?.trim();
  return name || formatEmailAsName(email);
}
