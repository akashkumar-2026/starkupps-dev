// Apple fluid-interface spring translation.
// Given a damping ratio + response (seconds), derive stiffness/damping for mass 1.

export function spring(dampingRatio: number, response: number) {
  const stiffness = ((2 * Math.PI) / response) ** 2;
  const damping = (4 * Math.PI * dampingRatio) / response;
  return { type: "spring" as const, stiffness, damping, mass: 1 };
}

export const springs = {
  addToCart: spring(1.0, 0.3),
  sheet: spring(0.8, 0.3),
  toast: spring(1.0, 0.4),
  carousel: spring(0.8, 0.4),
  section: spring(1.0, 0.4),
};

// Apple's momentum projection: where a flick would come to rest.
export function projectEndpoint(current: number, velocity: number, decay = 0.998) {
  return current + (velocity / 1000) * (decay / (1 - decay));
}
