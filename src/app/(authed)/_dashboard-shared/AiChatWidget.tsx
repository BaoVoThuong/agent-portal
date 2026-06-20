"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Send, Sparkles, X } from "lucide-react";

type AnswerStat = { label: string; value: string };
type Answer = {
  headline: string;
  stats: AnswerStat[];
};

type ChatTurn = {
  question: string;
  answer: Answer | null;
  error: string | null;
  /** Bước tiến trình hiện tại khi đang xử lý (index trong PROGRESS_STEPS). */
  step: number;
};

type AiChatWidgetProps = {
  /** Mảng dashboard hiện tại — khoá nguồn dữ liệu phía server. */
  context: "pc" | "health";
  /** View đang hiển thị: "agent" (mặc định, data của mình) hay "company" (toàn cty). */
  scope?: "agent" | "company";
};

// Các bước hiển thị tiến trình. Server trả về 1 lần (không streaming), nên client
// tự "diễn" tiến trình theo timer cho tới khi có kết quả thì dừng ở bước cuối.
const PROGRESS_STEPS = [
  "Understanding your question",
  "Querying P&C data",
  "Calculating the numbers",
  "Writing the answer",
] as const;
const STEP_INTERVAL_MS = 700;

const SUGGESTIONS: Record<"pc" | "health", string[]> = {
  pc: [
    "How many active policies this month?",
    "My total premium this year",
    "Estimate unpaid commission by agent",
  ],
  health: [
    "How many policies this month?",
    "How many clients by carrier?",
    "My agent commission this year",
  ],
};

const CONTEXT_LABEL: Record<"pc" | "health", string> = {
  pc: "P&C",
  health: "Health",
};

export function AiChatWidget({ context, scope = "agent" }: AiChatWidgetProps) {
  const label = CONTEXT_LABEL[context];
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, []);

  async function send(question: string) {
    if (!question || loading) return;
    // Lịch sử các lượt đã hoàn tất (để server hiểu câu hỏi nối tiếp).
    // Gửi cả headline + các dòng stat, để câu sau hiểu "khách số 1", "cái thứ 2"...
    const history = turns
      .filter((t) => t.answer)
      .map((t) => {
        const lines = t.answer!.stats.map((s) => `${s.label}: ${s.value}`);
        const answer = [t.answer!.headline, ...lines].join("\n");
        return { question: t.question, answer };
      });

    setInput("");
    setLoading(true);
    setTurns((prev) => [...prev, { question, answer: null, error: null, step: 0 }]);
    scrollToBottom();

    // "Diễn" tiến trình các bước cho tới gần cuối; bước cuối giữ lại đến khi có data.
    if (stepTimer.current) clearInterval(stepTimer.current);
    stepTimer.current = setInterval(() => {
      setTurns((prev) =>
        updateLast(prev, (t) => ({
          step: Math.min(t.step + 1, PROGRESS_STEPS.length - 1),
        }))
      );
    }, STEP_INTERVAL_MS);

    try {
      const res = await fetch("/api/ai/dashboard-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context, scope, history }),
      });
      const data = await res.json();
      setTurns((prev) =>
        updateLast(prev, () => ({
          answer: res.ok ? (data.answer as Answer) : null,
          error: res.ok ? null : data.error ?? "Something went wrong.",
        }))
      );
    } catch {
      setTurns((prev) =>
        updateLast(prev, () => ({
          answer: null,
          error: "Network error. Please retry.",
        }))
      );
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
      setLoading(false);
      scrollToBottom();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open data assistant"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#0f2849] text-white shadow-lg shadow-[#0f2849]/30 transition hover:scale-105 hover:bg-[#19365c]"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[34rem] w-[23rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center justify-between bg-[#0f2849] px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">Dashboard Assistant</p>
            <p className="text-xs text-white/60">Ask about your {label} data</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="rounded-full p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-4 py-4"
      >
        {turns.length === 0 ? (
          <div className="mt-6 space-y-3">
            <p className="text-center text-sm text-slate-400">
              Ask me anything about your {label} numbers.
            </p>
            <div className="space-y-2">
              {SUGGESTIONS[context].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 transition hover:border-[#0f2849]/30 hover:bg-slate-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-[#0f2849] px-3.5 py-2 text-sm text-white shadow-sm">
                {turn.question}
              </div>
              {turn.answer && <AnswerCard answer={turn.answer} />}
              {turn.error && (
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm border border-red-100 bg-red-50 px-3.5 py-2 text-sm text-red-600">
                  {turn.error}
                </div>
              )}
              {!turn.answer && !turn.error && <ProgressCard step={turn.step} />}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-slate-100 bg-white p-3">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 focus-within:border-[#0f2849]/40 focus-within:bg-white">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input.trim());
              }
            }}
            rows={1}
            placeholder="Ask a question…"
            className="max-h-24 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => send(input.trim())}
            disabled={loading || !input.trim()}
            aria-label="Send"
            className="mb-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f2849] text-white transition hover:bg-[#19365c] disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressCard({ step }: { step: number }) {
  return (
    <div className="w-fit max-w-[90%] space-y-1.5 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm">
      {PROGRESS_STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div
            key={label}
            className={`flex items-center gap-2 text-xs transition ${
              done
                ? "text-slate-400"
                : active
                  ? "font-medium text-[#0f2849]"
                  : "text-slate-300"
            }`}
          >
            {done ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0f2849]" />
            ) : (
              <span className="h-3.5 w-3.5 rounded-full border border-slate-200" />
            )}
            {label}
          </div>
        );
      })}
    </div>
  );
}

function AnswerCard({ answer }: { answer: Answer }) {
  return (
    <div className="w-fit max-w-[90%] space-y-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm">
      <p className="leading-snug">{answer.headline}</p>
      {answer.stats.length > 0 && (
        <dl className="space-y-1 border-t border-slate-100 pt-2">
          {answer.stats.map((stat, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4">
              <dt className="text-xs text-slate-500">{stat.label}</dt>
              <dd className="font-semibold tabular-nums text-[#0f2849]">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function updateLast(
  turns: ChatTurn[],
  patch: (turn: ChatTurn) => Partial<ChatTurn>
): ChatTurn[] {
  if (turns.length === 0) return turns;
  const next = [...turns];
  const last = next[next.length - 1];
  next[next.length - 1] = { ...last, ...patch(last) };
  return next;
}
