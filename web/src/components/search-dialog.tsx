import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search, Shield, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { entityKey, searchQuery } from "@/lib/api";
import type { Sport } from "@/lib/api-types";
import { search } from "@/lib/search";

/** ⌘K / "/" search over teams and players for the current sport + season. */
export function SearchDialog({
  sport,
  season,
  current,
}: {
  sport: Sport;
  season: number | null;
  current: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const target = season ?? current;
  const { data, isFetching } = useQuery({ ...searchQuery(sport, target, current), enabled: open });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [teams, players] = useMemo(() => (data ? search(data, q) : [[], []]), [data, q]);

  const go = (kind: "team" | "player", id: number, slug: string) => {
    setOpen(false);
    setQ("");
    const params = { sport, season: String(target) };
    if (kind === "team")
      navigate({
        to: "/$sport/$season/teams/$teamKey",
        params: { ...params, teamKey: entityKey(id, slug) },
      });
    else
      navigate({
        to: "/$sport/$season/players/$playerKey",
        params: { ...params, playerKey: entityKey(id, slug) },
      });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 gap-2 px-2 text-xs text-muted-foreground"
        aria-label="Search teams and players"
      >
        <Search className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border px-1 font-mono text-[10px] sm:inline">⌘K</kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search teams and players"
        showCloseButton={false}
        shouldFilter={false}
      >
        <CommandInput placeholder="Search teams and players…" value={q} onValueChange={setQ} />
        {/* Filtering is ours (thousands of players); cmdk only handles keyboard nav. */}
        <CommandList className="max-h-96">
          {q.trim() && !isFetching ? <CommandEmpty>No matches.</CommandEmpty> : null}
          {!q.trim() ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {isFetching ? "Loading index…" : "Type a team or player name."}
            </div>
          ) : null}
          {teams.length ? (
            <CommandGroup heading="Teams">
              {teams.map((t) => (
                <CommandItem
                  key={`t${t.id}`}
                  value={`t${t.id}`}
                  onSelect={() => go("team", t.id, t.slug)}
                >
                  <Shield className="size-3.5 text-muted-foreground" aria-hidden />
                  {t.name}
                  <span className="ml-auto text-xs text-muted-foreground">{t.sub}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {players.length ? (
            <CommandGroup heading="Players">
              {players.map((p) => (
                <CommandItem
                  key={`p${p.id}`}
                  value={`p${p.id}`}
                  onSelect={() => go("player", p.id, p.slug)}
                >
                  <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
                  {p.name}
                  <span className="ml-auto text-xs text-muted-foreground">{p.sub}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
