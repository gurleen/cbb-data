import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, Moon, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { SearchDialog } from "@/components/search-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SPORTS, type Sport } from "@/lib/api-types";
import { type Density, type Prefs, setDensity, setTheme, type Theme } from "@/lib/prefs";
import { SPORT_LABEL, SPORT_NAME, useSeasons, useSportSeason } from "@/lib/season-context";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Conferences", to: "/$sport/$season/conferences" },
  { label: "Teams", to: "/$sport/$season/teams" },
  { label: "Players", to: "/$sport/$season/players" },
] as const;

export function AppHeader({ prefs }: { prefs: Prefs }) {
  const { sport, season } = useSportSeason();
  const seasons = useSeasons(sport);
  const current = seasons?.current_season ?? null;
  const activeSeason = season ?? current;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-11 max-w-[1440px] items-center gap-3 px-4 lg:px-6">
        <MobileNav sport={sport} season={activeSeason} />
        <Link
          to="/"
          className="font-mono text-base font-medium tracking-tight text-foreground hover:no-underline"
        >
          cbb
        </Link>
        <SportToggle sport={sport} season={season} />
        <SeasonPicker sport={sport} season={activeSeason} />
        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
          {activeSeason !== null &&
            NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                params={{ sport, season: String(activeSeason) }}
                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground hover:no-underline"
                activeProps={{ className: "text-foreground bg-surface-hover" }}
              >
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <SearchDialog sport={sport} season={activeSeason} current={current ?? 0} />
          <ThemeToggle initial={prefs.theme} />
          <SettingsMenu initialDensity={prefs.density} />
        </div>
      </div>
    </header>
  );
}

/** Segmented MBB | WBB. Keeps the current page type; falls back to the other sport's
 * current season if this season doesn't exist there. Plain links: works without JS. */
function SportToggle({ sport, season }: { sport: Sport; season: number | null }) {
  const other = useSeasons(sport === "mbb" ? "wbb" : "mbb");
  return (
    <fieldset className="m-0 flex rounded-md border p-0.5">
      <legend className="sr-only">Sport</legend>
      {SPORTS.map((s) => {
        const docs = s === sport ? null : other;
        const targetSeason =
          season === null
            ? null
            : docs && !docs.seasons.some((e) => e.season === season)
              ? docs.current_season
              : season;
        return (
          <Link
            key={s}
            to="."
            params={(prev: Record<string, string>) => ({
              ...prev,
              sport: s,
              ...(targetSeason !== null ? { season: String(targetSeason) } : {}),
            })}
            title={SPORT_NAME[s]}
            aria-current={s === sport ? "page" : undefined}
            className={cn(
              "rounded-sm px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground hover:text-foreground hover:no-underline",
              s === sport && "bg-surface-hover text-foreground",
            )}
          >
            {SPORT_LABEL[s]}
          </Link>
        );
      })}
    </fieldset>
  );
}

/** Season select. Navigates to the same page in the chosen season. */
function SeasonPicker({ sport, season }: { sport: Sport; season: number | null }) {
  const seasons = useSeasons(sport);
  const navigate = useNavigate();
  if (!seasons || season === null) return null;
  return (
    <Select
      value={String(season)}
      onValueChange={(value) =>
        navigate({
          to: ".",
          params: (prev: Record<string, string>) => ({ ...prev, sport, season: value }),
        })
      }
    >
      <SelectTrigger size="sm" aria-label="Season" className="h-7 w-[104px] font-mono text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {seasons.seasons.map((s) => (
          <SelectItem key={s.season} value={String(s.season)} className="font-mono text-xs">
            {s.label}
            {s.current ? <span className="ml-1 text-muted-foreground">·</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setThemeState] = useState<Theme>(initial);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-7"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function SettingsMenu({ initialDensity }: { initialDensity: Density }) {
  const [density, setDensityState] = useState<Density>(initialDensity);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Settings">
          <Settings className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 text-sm">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Table density
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={density}
          onValueChange={(v) => {
            setDensity(v as Density);
            setDensityState(v as Density);
          }}
        >
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileNav({ sport, season }: { sport: Sport; season: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-7 md:hidden" aria-label="Open menu">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-60 p-3">
        <SheetTitle className="mb-2 font-mono text-base">cbb</SheetTitle>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {season !== null &&
            NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                params={{ sport, season: String(season) }}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1.5 text-foreground hover:bg-surface-hover hover:no-underline"
              >
                {item.label}
              </Link>
            ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
