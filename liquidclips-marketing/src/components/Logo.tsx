import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Liquid Clips home">
      <span className="logo-mark">/</span>
      <span>
        liquid<span className="logo-slash">/</span>clips
      </span>
    </Link>
  );
}
