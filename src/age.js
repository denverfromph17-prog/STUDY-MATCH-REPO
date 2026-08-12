export const UNDERAGE_MESSAGE = 'Study Match PH is currently available to users 18 years old and above.';

export function parseDateOfBirth(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function isAtLeast18(dateOfBirth, now = new Date()) {
  const dob = parseDateOfBirth(dateOfBirth);
  if (!dob) return false;
  const today = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  let age = today.year - dob.year;
  if (today.month < dob.month || (today.month === dob.month && today.day < dob.day)) age--;
  return age >= 18;
}
