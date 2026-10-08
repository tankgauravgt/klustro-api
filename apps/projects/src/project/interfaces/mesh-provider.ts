export const MESH_PROVIDERS = ['Tailscale', 'Cloudflare', 'Headscale'] as const;

export type MeshProvider = (typeof MESH_PROVIDERS)[number];
