// A page's sections as cards: the page first shows only the cards; a card
// opens its own screen (?s=<key>, scrolled to top) with a "← Page" button,
// and the phone's back button also returns to the cards.
import { useRef, type ComponentType } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { InfoTip } from "@/components/info-tip";

export interface SectionCard<K extends string = string> {
  key: K;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

// `cards` should already be filtered to what this user may open; an unknown
// or not-allowed ?s= falls back to the cards.
export function useSectionNav<K extends string>(basePath: string, cards: SectionCard<K>[]) {
  const [, setLocation] = useLocation();
  const s = new URLSearchParams(useSearch()).get("s");
  const current = cards.find((c) => c.key === s) ?? null;
  const fromCards = useRef(false);
  const open = (key: K) => {
    fromCards.current = true;
    setLocation(`${basePath}?s=${key}`);
    window.scrollTo({ top: 0 });
  };
  const back = () => {
    if (fromCards.current) { fromCards.current = false; window.history.back(); }
    else setLocation(basePath, { replace: true });
  };
  return { current, open, back };
}

export function SectionCardGrid<K extends string>({ cards, onOpen, testPrefix }: {
  cards: SectionCard<K>[];
  onOpen: (key: K) => void;
  testPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 print:hidden">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onOpen(c.key)}
          className="relative text-left rounded-lg border bg-card hover:bg-accent hover:border-primary/50 transition-colors p-4 flex items-center gap-3"
          data-testid={`card-${testPrefix}-${c.key}`}
        >
          <span className="rounded-md bg-primary/10 text-primary p-2.5 shrink-0"><c.icon className="w-5 h-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold leading-tight">{c.title}</span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          <InfoTip text={c.description} />
        </button>
      ))}
    </div>
  );
}

export function SectionBackBar({ pageName, card, onBack, testPrefix }: {
  pageName: string;
  card: SectionCard;
  onBack: () => void;
  testPrefix: string;
}) {
  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button variant="outline" size="sm" onClick={onBack} data-testid={`button-${testPrefix}-back`}>
        <ArrowLeft className="w-4 h-4 mr-1" />{pageName}
      </Button>
      <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 min-w-0">
        <card.icon className="w-5 h-5 text-primary shrink-0" /><span className="leading-tight">{card.title}</span>
      </h2>
    </div>
  );
}
