import { Link } from "@tanstack/react-router";
import { entityKey } from "@/lib/api";
import type { Sport } from "@/lib/api-types";
import { cn } from "@/lib/utils";

export function TeamLogo({
  src,
  size = 16,
  className,
}: {
  src: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!src)
    return (
      <span
        className={cn("inline-block shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={cn("inline-block shrink-0 object-contain", className)}
    />
  );
}

/** Logo + name linking to the team page (non-D-I teams render as plain text). */
export function TeamLink({
  sport,
  season,
  id,
  name,
  slug,
  logo,
  subtitle,
  linked = true,
}: {
  sport: Sport;
  season: number;
  id: number;
  name: string | null;
  slug?: string | null;
  logo?: string | null;
  subtitle?: string | null;
  linked?: boolean;
}) {
  const body = (
    <>
      <TeamLogo src={logo} />
      <span className="truncate">{name ?? `Team ${id}`}</span>
      {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
    </>
  );
  if (!linked) return <span className="inline-flex max-w-full items-center gap-1.5">{body}</span>;
  return (
    <Link
      to="/$sport/$season/teams/$teamKey"
      params={{ sport, season: String(season), teamKey: entityKey(id, slug) }}
      className="inline-flex max-w-full items-center gap-1.5 text-foreground hover:text-primary hover:no-underline"
    >
      {body}
    </Link>
  );
}
