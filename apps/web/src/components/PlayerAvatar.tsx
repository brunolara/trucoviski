import { useMemo } from "react";
import { avatarUrl } from "../utils/avatar.js";

type PlayerAvatarProps = {
  seed: string;
  alt?: string;
  size?: number;
  className?: string | undefined;
};

export function PlayerAvatar({
  seed,
  alt = "",
  size = 64,
  className,
}: PlayerAvatarProps) {
  const src = useMemo(() => avatarUrl(seed, size), [seed, size]);
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      data-testid="player-avatar"
    />
  );
}
