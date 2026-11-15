export const storageKey = 'switchboard.payment.v1';
export function saveSession(value: unknown, storage = () => window.localStorage): boolean {
  try {
    storage().setItem(storageKey,JSON.stringify(value));
    return true;
  } catch { return false; }
}
