/**
 * Choosing one person from the phone's own contacts, for a "who to call" entry. Only the one number the
 * person taps is handed over; the app never sees the address book and asks for no contacts permission.
 *
 * Two ways, and null where neither exists:
 * - In the phone app: the system's own picker through @capgo/capacitor-contacts, asked for a single phone
 *   number (`property: 'phoneNumber'`). On Android that reads only the one row the picker grants, so it needs
 *   neither READ_CONTACTS nor WRITE_CONTACTS (the plugin's manifest adds only a "queries" line so the picker
 *   can be found). The picker lists one row per number, so the person picks the number as well as the name.
 * - In a browser that has the Contact Picker API (Chrome on Android, over https): navigator.contacts.select.
 *
 * `pick()` gives `{ name, phones }`, or null when the person cancels. A real failure throws an Error whose
 * message is plain words.
 *
 * Not yet run on a real phone: the Capacitor path was written from the plugin's source and has not been built
 * into the app or tried. The browser path is tried only against a stand-in for navigator.contacts.
 */
import { Capacitor } from '@capacitor/core';

const words = (name, phones) => ({ name: (name || '').trim(), phones: [...new Set(phones.map((p) => (p || '').trim()).filter(Boolean))] });

/** A picker, or null where this device has none. */
export function contactPicker() {
  if (Capacitor.isNativePlatform()) {
    return {
      async pick() {
        let picked;
        try {
          const { CapacitorContacts, ContactProperty } = await import('@capgo/capacitor-contacts');
          picked = await CapacitorContacts.pickContact({ property: ContactProperty.PhoneNumber });
        } catch {
          throw new Error("Couldn't open your contacts. You can type the name and number instead.");
        }
        const one = picked?.contacts?.[0];
        if (!one) return null;
        return words(one.displayName, (one.phoneNumbers || []).map((n) => n.value));
      },
    };
  }
  if (typeof navigator !== 'undefined' && navigator.contacts && typeof navigator.contacts.select === 'function') {
    return {
      async pick() {
        let found;
        try {
          found = await navigator.contacts.select(['name', 'tel'], { multiple: false });
        } catch (problem) {
          // Closing the picker rejects in some browsers; that is a cancel, not a failure.
          if (problem && ['AbortError', 'NotAllowedError'].includes(problem.name)) return null;
          throw new Error("Couldn't open your contacts. You can type the name and number instead.");
        }
        const one = found && found[0];
        if (!one) return null;
        return words((one.name || [])[0], one.tel || []);
      },
    };
  }
  return null;
}
