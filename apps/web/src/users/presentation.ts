import type { CSSProperties } from 'react';

type AvatarGradientStyle = CSSProperties & {
  '--avatar-from': string;
  '--avatar-to': string;
};

export function userAvatarGradient(seed?: string): AvatarGradientStyle {
  let hash = 2_166_136_261;
  for (const character of seed || 'SevaleCRM') {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  const unsignedHash = hash >>> 0;
  const startHue = unsignedHash % 360;
  const endHue = (startHue + 50 + ((unsignedHash >>> 8) % 71)) % 360;
  return {
    '--avatar-from': `hsl(${startHue} 72% 42%)`,
    '--avatar-to': `hsl(${endHue} 78% 50%)`,
  };
}

export function userInitials(name?: string): string {
  if (!name) return 'SC';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function userAvatarSeed(
  user?: { id?: string; email?: string; name?: string } | null,
): string {
  return user?.id || user?.email || user?.name || 'SevaleCRM';
}
