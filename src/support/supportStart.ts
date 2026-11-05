/** Opens the "Message ELUM Support" box from anywhere in Type (the account menu, the inbox). */
export const START_SUPPORT_EVENT = 'elum:type:start-support';

export function openStartSupport() {
  window.dispatchEvent(new Event(START_SUPPORT_EVENT));
}
