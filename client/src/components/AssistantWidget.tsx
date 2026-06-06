import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Bot, Send, X, Minus, Sparkles, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

// Mirror of server AssistantAnswer. Keep in sync with server/assistantEngine.ts.
interface AssistantSection {
  heading?: string;
  bullets?: string[];
  body?: string;
}
interface AssistantSource {
  label: string;
  url?: string | null;
}
interface AssistantAnswer {
  intent: string;
  title: string;
  sections: AssistantSection[];
  sources: AssistantSource[];
  disclaimer: string;
  followUps: string[];
  mode: "rules" | "llm";
}

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; answer: AssistantAnswer }
  | { id: string; role: "assistant"; loading: true }
  | { id: string; role: "assistant"; error: string };

const SUGGESTED: Record<string, string[]> = {
  "/": [
    "What does TreasuryLens do?",
    "How does the goal calculator work?",
    "Where are Stock Picks?",
  ],
  "/dashboard": [
    "What is RSI?",
    "Explain the Buffett Index",
    "What data is live?",
  ],
  "/app": [
    "What is RSI?",
    "Explain the Buffett Index",
    "What data is live?",
  ],
  "/stock-picks": [
    "Show top 12m performers",
    "Show AI Energy ETFs",
    "What does 3x potential mean?",
  ],
  "/themes": [
    "Show top 12m performers",
    "Show AI Energy ETFs",
    "What does 3x potential mean?",
  ],
  "/superinvestors": [
    "What is a 13F?",
    "Show Berkshire top holdings",
    "What did Scion sell?",
  ],
  "/13f": [
    "What is a 13F?",
    "Show Berkshire top holdings",
    "What did Scion sell?",
  ],
  "/conviction": [
    "Why is TSLA optionality?",
    "Show kill criteria for PLTR",
    "Compare compounders",
    "What must be true for META?",
  ],
  "/ideas": [
    "Why is TSLA optionality?",
    "Show kill criteria for PLTR",
    "Compare compounders",
    "What must be true for META?",
  ],
};

function suggestionsFor(route: string): string[] {
  return SUGGESTED[route] ?? SUGGESTED["/"];
}

function genId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function AnswerBlock({ answer, idx }: { answer: AssistantAnswer; idx: number }) {
  return (
    <div
      data-testid={`assistant-message-${idx}`}
      className="rounded-lg border border-border bg-card/60 p-3 text-sm space-y-2"
    >
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span>{answer.title}</span>
      </div>
      {answer.sections.map((s, i) => (
        <div key={i} className="space-y-1">
          {s.heading && (
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {s.heading}
            </div>
          )}
          {s.body && <p className="text-foreground/90 leading-relaxed">{s.body}</p>}
          {s.bullets && s.bullets.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5 text-foreground/90">
              {s.bullets.map((b, bi) => (
                <li key={bi}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {answer.sources.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          Sources:{" "}
          {answer.sources.map((src, i) => (
            <span key={i}>
              {i > 0 ? ", " : ""}
              {src.url ? (
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline hover:text-foreground"
                >
                  {src.label}
                </a>
              ) : (
                src.label
              )}
            </span>
          ))}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground italic">
        {answer.disclaimer}
      </div>
    </div>
  );
}

export function AssistantWidget() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const route = useMemo(() => location || "/", [location]);
  const suggestions = useMemo(() => suggestionsFor(route), [route]);

  // Auto-scroll on new message
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      // Delay to let the panel render before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      const userMsg: ChatMessage = { id: genId(), role: "user", text: trimmed };
      const loadingMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        loading: true,
      };
      setMessages((prev) => [...prev, userMsg, loadingMsg]);
      setInput("");
      setSending(true);
      try {
        const res = await apiRequest("POST", "/api/assistant/query", {
          route,
          question: trimmed,
        });
        const answer = (await res.json()) as AssistantAnswer;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingMsg.id
              ? { id: m.id, role: "assistant", answer }
              : m,
          ),
        );
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingMsg.id
              ? {
                  id: m.id,
                  role: "assistant",
                  error:
                    (e as Error).message ||
                    "Couldn't reach the assistant. Try again.",
                }
              : m,
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [route, sending],
  );

  return (
    <>
      {/* Launcher button — visible everywhere, above the mobile bottom nav */}
      {!open && (
        <button
          type="button"
          data-testid="assistant-launcher"
          aria-label="Open TreasuryLens assistant"
          onClick={() => setOpen(true)}
          className="fixed right-4 z-50 inline-flex items-center gap-2 rounded-full border border-border bg-primary text-primary-foreground shadow-lg shadow-black/20 px-4 py-2.5 text-sm font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] md:bottom-4"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          <span>Ask</span>
        </button>
      )}

      {/* Chat panel — fixed bottom-right on desktop, full-width sheet above mobile nav */}
      {open && (
        <div
          data-testid="assistant-panel"
          role="dialog"
          aria-label="TreasuryLens assistant"
          className="fixed z-50 flex flex-col border border-border bg-background shadow-2xl right-2 left-2 md:left-auto md:right-4 md:w-[380px] md:max-w-[calc(100vw-2rem)] md:rounded-xl rounded-t-xl bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] md:bottom-4 max-h-[70vh] md:max-h-[560px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="rounded-full bg-primary/10 p-1.5">
                <Bot className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight truncate">
                  TreasuryLens Assistant
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 leading-4 h-auto"
                  >
                    Free screen helper
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    Rules-based beta
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Minimize assistant"
                data-testid="assistant-minimize"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setMessages([]);
                }}
                aria-label="Close assistant"
                data-testid="assistant-close"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          {/* Body */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
          >
            {messages.length === 0 && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Ask about anything on this screen. I answer from internal
                  TreasuryLens data only — no LLM is used.
                </p>
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wide">
                    Try
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s, i) => (
                      <button
                        key={s}
                        type="button"
                        data-testid={`assistant-suggested-${i}`}
                        onClick={() => send(s)}
                        className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((m, idx) =>
              m.role === "user" ? (
                <div
                  key={m.id}
                  data-testid={`assistant-message-${idx}`}
                  className="ml-auto max-w-[88%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                >
                  {m.text}
                </div>
              ) : "loading" in m ? (
                <div
                  key={m.id}
                  data-testid={`assistant-message-${idx}`}
                  className="text-sm text-muted-foreground italic"
                >
                  Thinking…
                </div>
              ) : "error" in m ? (
                <div
                  key={m.id}
                  data-testid={`assistant-message-${idx}`}
                  className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive"
                >
                  {m.error}
                </div>
              ) : (
                <div key={m.id} className="space-y-1.5">
                  <AnswerBlock answer={m.answer} idx={idx} />
                  {m.answer.followUps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.answer.followUps.map((f, fi) => (
                        <button
                          key={f}
                          type="button"
                          data-testid={`assistant-followup-${idx}-${fi}`}
                          onClick={() => send(f)}
                          className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-border p-2"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              data-testid="assistant-input"
              placeholder="Ask about this screen…"
              aria-label="Ask the assistant"
              disabled={sending}
              maxLength={500}
              className="h-9 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              data-testid="assistant-send"
              disabled={sending || !input.trim()}
              aria-label="Send question"
            >
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
