export async function api(path, options) {
  const response = await fetch(`/api${path}`, { headers: { 'content-type': 'application/json', ...(options?.headers || {}) }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
