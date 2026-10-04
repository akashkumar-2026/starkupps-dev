/**
 * Copy and timing for the post-order confirmation screen.
 *
 * ## Why this replaces the toast
 *
 * A toast said *"Order #1042 confirmed, Aman!"* in a corner for four seconds.
 * That is the worst possible moment for it: the customer has just handed over
 * money, and the one artefact they need — the ticket number they quote at the
 * counter — is in a transient corner they may never look at, on a page that has
 * already re-rendered empty because the cart was cleared underneath them.
 *
 * The screen is centred, dismisses itself, and holds the number where it cannot
 * be missed.
 *
 * ## Why it self-dismisses
 *
 * An interstitial that requires a tap strands anyone who does not understand it,
 * and the customer already has what they came for. So it closes on a timer — but
 * the timer is **paused on interaction and extended by hovering/focusing**, so
 * it cannot disappear while someone is mid-read or copying the number. Without
 * that, a slow reader loses the ticket number at exactly the wrong second.
 */

/** How long the screen stays up before dismissing itself. */
export const CONFIRMATION_MS = 9000;

/**
 * Extra time granted when the customer interacts with it.
 *
 * Reading a number and copying it takes longer than nine seconds for plenty of
 * people, so any interaction buys a fresh full interval rather than a token
 * few seconds.
 */
export const CONFIRMATION_EXTEND_MS = 9000;

/**
 * What happens next, per fulfilment type.
 *
 * Delivery is the only one with a distinct next step, so it gets its own line —
 * telling a delivery customer to "wait at the counter" would be actively wrong.
 */
export function nextStepLabel(type: string): string {
  switch (type) {
    case "delivery":
      return "We'll call you when it leaves the kitchen.";
    case "dine-in":
      return "We'll bring it to your table.";
    default:
      return "Ready in about 10 minutes — we'll call you.";
  }
}

/** Headline verb, kept short so it fits one line on a 320px screen. */
export function confirmationTitle(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? `Thanks, ${first}` : "Order confirmed";
}
