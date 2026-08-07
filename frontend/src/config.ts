const _env_url = (import.meta as any).env?.VITE_API_BASE_URL;
const _isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

// export const API_BASE_URL: string = _env_url || (_isLocal ? "http://localhost:4005" : "https://reel-backend.jamin24.com");

// export const API_BASE_URL: string = "https://reel-backend.jamin24.com";   LIVE MATE CHE...
