import type { RowData } from "@tanstack/react-table";
import { Check, Copy, Download, Flame } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type StatColumn, toDelimited } from "./stat-table";

/** Copy-as-TSV and download-CSV for the current (filtered, sorted) view. */
export function ExportButtons<T extends RowData>({
  columns,
  rows,
  hidden,
  filename,
}: {
  columns: StatColumn<T>[];
  rows: T[];
  hidden: string[];
  filename: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        title="Copy as tab-separated values (pastes into spreadsheets)"
        onClick={async () => {
          await navigator.clipboard.writeText(toDelimited(columns, rows, hidden, "\t"));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        title="Download CSV"
        onClick={() => {
          const blob = new Blob([toDelimited(columns, rows, hidden, ",")], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${filename}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Download className="size-3.5" /> CSV
      </Button>
    </>
  );
}

export function ShadeToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title="Shade cells by percentile"
      className={`h-7 gap-1.5 px-2 text-xs ${on ? "bg-surface-hover text-foreground" : ""}`}
    >
      <Flame className="size-3.5" /> Shade
    </Button>
  );
}
