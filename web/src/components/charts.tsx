// Charts (spec §6.3, phase 6). Colors: validated diverging pair --chart-good/--chart-bad
// (blue/red) and a recessive --chart-context gray for "the rest of the field".
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { TeamGame, TeamStatsRow } from "@/lib/api-types";
import { fmt1, fmtGameDate, fmtSigned } from "@/lib/format";

const AXIS = { stroke: "var(--border)", tick: { fill: "var(--muted-foreground)", fontSize: 11 } };
const GRID = { stroke: "var(--border)", strokeDasharray: "2 4", opacity: 0.6 };

function TooltipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-xs shadow-md">{children}</div>
  );
}

interface Pt {
  id: number;
  name: string;
  abbr: string;
  ortg: number;
  drtg: number;
  net: number | null;
}

const toPt = (r: TeamStatsRow): Pt | null =>
  r.ortg === null || r.drtg === null
    ? null
    : {
        id: r.team_id,
        name: r.name,
        abbr: r.abbreviation ?? "",
        ortg: r.ortg,
        drtg: r.drtg,
        net: r.net_rtg,
      };

/** ORtg (x) vs DRtg (y, reversed so "good defense" is up). Members highlighted. */
export function RatingScatter({
  field,
  memberIds,
  memberLabel,
}: {
  field: TeamStatsRow[];
  memberIds: Set<number>;
  memberLabel: string;
}) {
  const all = field
    .filter((r) => r.box_games >= 5)
    .map(toPt)
    .filter((p): p is Pt => p !== null);
  const members = all.filter((p) => memberIds.has(p.id));
  const rest = all.filter((p) => !memberIds.has(p.id));
  if (members.length === 0) return null;
  return (
    <figure
      className="rounded-md border p-2"
      aria-label={`Offensive vs defensive rating: ${memberLabel} teams against the D-I field`}
    >
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis
              type="number"
              dataKey="ortg"
              name="ORtg"
              domain={["dataMin - 2", "dataMax + 2"]}
              tickFormatter={(v: number) => v.toFixed(0)}
              {...AXIS}
            />
            <YAxis
              type="number"
              dataKey="drtg"
              name="DRtg"
              reversed
              domain={["dataMin - 2", "dataMax + 2"]}
              tickFormatter={(v: number) => v.toFixed(0)}
              width={36}
              {...AXIS}
            />
            <ZAxis range={[72, 72]} />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                const p = active && (payload?.[0]?.payload as Pt | undefined);
                if (!p) return null;
                return (
                  <TooltipBox>
                    <div className="font-medium text-foreground">{p.name}</div>
                    <div className="font-mono text-muted-foreground">
                      ORtg {fmt1(p.ortg)} · DRtg {fmt1(p.drtg)} · Net {fmtSigned(p.net)}
                    </div>
                  </TooltipBox>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={24}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
            />
            <Scatter
              name="Other D-I teams"
              data={rest}
              fill="var(--chart-context)"
              isAnimationActive={false}
            />
            <Scatter
              name={memberLabel}
              data={members}
              fill="var(--chart-good)"
              stroke="var(--background)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="abbr"
                position="top"
                offset={6}
                style={{ fill: "var(--foreground)", fontSize: 10 }}
              />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-muted-foreground">
        x: offensive rating (right = better offense) · y: defensive rating, inverted (up = better
        defense). Teams with at least 5 box-score games.
      </figcaption>
    </figure>
  );
}

interface MarginPt {
  id: number;
  label: string;
  margin: number;
  game: TeamGame;
}

/** Bar with a 4px rounded data end, anchored square at the zero baseline. */
function MarginBar(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
}) {
  const { x = 0, y = 0, width = 0, fill } = props;
  let { height = 0 } = props;
  if (!width || !height) return null;
  const down = height < 0;
  height = Math.abs(height);
  const top = down ? y - height : y;
  const r = Math.min(4, width / 2, height);
  const d = down
    ? // rounded at the bottom (data end), square at the top (baseline)
      `M${x},${top} h${width} v${height - r} q0,${r} -${r},${r} h-${width - 2 * r} q-${r},0 -${r},-${r} Z`
    : `M${x},${top + height} v-${height - r} q0,-${r} ${r},-${r} h${width - 2 * r} q${r},0 ${r},${r} v${height - r} Z`;
  return <path d={d} fill={fill} />;
}

/** Point margin per completed game, in date order. */
export function MarginChart({ games }: { games: TeamGame[] }) {
  const data: MarginPt[] = games
    .filter((g) => g.completed && g.pts !== null && g.opp_pts !== null)
    .map((g) => ({
      id: g.game_id,
      label: fmtGameDate(g.date),
      margin: (g.pts as number) - (g.opp_pts as number),
      game: g,
    }));
  if (data.length < 2) return null;
  const wins = data.filter((d) => d.margin > 0).length;
  return (
    <figure
      className="rounded-md border p-2"
      aria-label={`Point margin by game: ${wins} wins and ${data.length - wins} losses`}
    >
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap={2}
          >
            <CartesianGrid vertical={false} {...GRID} />
            <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={24} {...AXIS} />
            <YAxis
              width={32}
              tickFormatter={(v: number) => (v > 0 ? `+${v}` : String(v))}
              {...AXIS}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} />
            <Tooltip
              cursor={{ fill: "var(--surface-hover)" }}
              content={({ active, payload }) => {
                const p = active && (payload?.[0]?.payload as MarginPt | undefined);
                if (!p) return null;
                const g = p.game;
                return (
                  <TooltipBox>
                    <div className="text-foreground">
                      {fmtGameDate(g.date, true)} {g.site === "away" ? "@" : "vs"} {g.opponent.name}
                    </div>
                    <div className="font-mono text-muted-foreground">
                      {g.result} {g.pts}-{g.opp_pts} ({p.margin > 0 ? "+" : ""}
                      {p.margin})
                    </div>
                  </TooltipBox>
                );
              }}
            />
            <Bar dataKey="margin" shape={<MarginBar />} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.id} fill={d.margin > 0 ? "var(--chart-good)" : "var(--chart-bad)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-muted-foreground">
        Point margin by game (blue above zero = win, red below = loss). Full numbers in the game
        log.
      </figcaption>
    </figure>
  );
}
