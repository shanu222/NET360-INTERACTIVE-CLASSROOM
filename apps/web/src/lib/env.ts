/**
 * Where the realtime server lives.
 *  - Same origin (local dev with the Vite proxy, or the server serving the app): leave VITE_API_URL empty.
 *  - Split hosting (web on Vercel, server on Railway): VITE_API_URL=https://your-server.up.railway.app
 */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export const apiPath = (path: string) => `${API_URL}${path}`;
