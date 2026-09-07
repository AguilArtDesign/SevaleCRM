const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const apiUrl = import.meta.env.DEV
  ? window.location.origin
  : configuredApiUrl || window.location.origin;
