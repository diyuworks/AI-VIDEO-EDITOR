export const API_BASE_URL = 
  ((import.meta as any).env?.VITE_API_BASE_URL) ||
  (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://localhost:4005"
    : "https://reel-backend.jamin24.com");

