import Image from "next/image";

// The signature pink pixel Space Invader. Used across every surface as the
// brand mascot — favicon, header plate, footer idle, list markers, loader.
export function Invader({
  size = 24,
  className = "",
  alt = "Liquid Clips",
  src = "/brand/invader.png",
}: {
  size?: number;
  className?: string;
  alt?: string;
  src?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`pixel-invader ${className}`}
      style={{ imageRendering: "pixelated", width: size, height: size }}
      priority
    />
  );
}
