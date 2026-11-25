// Polyfills for running unit tests under jsdom (the default Vitest environment).
// Ionic components such as ion-menu and ion-split-pane query `window.matchMedia`,
// which jsdom does not implement.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Las pruebas usan español (jsdom simula un navegador en inglés y la app elegiría inglés).
try {
  localStorage.setItem('conectard-idioma', 'es');
} catch {
  // Sin almacenamiento en este entorno: se usa el idioma por defecto.
}
