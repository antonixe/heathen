import 'fake-indexeddb/auto'

// jsdom does not implement matchMedia. Report reduced motion as enabled so
// animated components take their deterministic, animation-free path in tests.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = query => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
