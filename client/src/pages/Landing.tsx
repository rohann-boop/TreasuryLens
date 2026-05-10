import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { WordMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
  PiggyBank,
  LineChart as LineIcon,
  Lock,
  TrendingUp,
  AlertTriangle,
  Smartphone,
  Calculator,
  CircleDot,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// Dark mode toggle is preserved across the app via the .dark class on <html>.
function useEnsureDark() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
}

function fmtUSD(value: number, frac = 0): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}

// Goal calculator: standard future-value formula with monthly contributions.
//   FV = P*(1+r)^n + C * [((1+r)^n - 1) / r]
// where r is the monthly rate, n is months, P is starting amount, C monthly.
function projectFutureValue(
  starting: number,
  monthly: number,
  years: number,
  annualReturnPct: number,
) {
  const n = Math.max(0, Math.round(years * 12));
  const r = annualReturnPct / 100 / 12;
  const series: { month: number; value: number; contributions: number }[] = [];
  let value = starting;
  let contributed = starting;
  series.push({ month: 0, value, contributions: contributed });
  for (let i = 1; i <= n; i++) {
    value = value * (1 + r) + monthly;
    contributed += monthly;
    if (i % 6 === 0 || i === n) {
      series.push({ month: i, value, contributions: contributed });
    }
  }
  return { final: value, contributions: contributed, series };
}

// Solve for the monthly contribution needed to hit a target by horizon.
function requiredMonthly(
  starting: number,
  target: number,
  years: number,
  annualReturnPct: number,
) {
  const n = Math.max(1, Math.round(years * 12));
  const r = annualReturnPct / 100 / 12;
  const startGrown = starting * Math.pow(1 + r, n);
  const remaining = target - startGrown;
  if (remaining <= 0) return 0;
  if (r === 0) return remaining / n;
  const denom = (Math.pow(1 + r, n) - 1) / r;
  return remaining / denom;
}

const ALLOCATION = [
  { name: "US Equities", value: 55, color: "hsl(188 80% 55%)" },
  { name: "Intl Equities", value: 20, color: "hsl(262 60% 65%)" },
  { name: "Bonds & T-Bills", value: 18, color: "hsl(32 95% 60%)" },
  { name: "Cash Reserve", value: 7, color: "hsl(145 55% 55%)" },
];

const ONBOARDING_STEPS = [
  {
    title: "Set your goal",
    minutes: 1,
    icon: Target,
    body: "Pick a target — retirement, a home, or financial independence — and a horizon. We map it to a sensible plan.",
  },
  {
    title: "Connect your paycheck",
    minutes: 2,
    icon: Wallet,
    body: "Tell us roughly what you take home. We work out a contribution that fits your cashflow without crowding out essentials.",
  },
  {
    title: "Risk profile",
    minutes: 2,
    icon: ShieldCheck,
    body: "A short questionnaire surfaces a risk band you're comfortable with — measured, not pushy.",
  },
  {
    title: "Account setup",
    minutes: 3,
    icon: Lock,
    body: "Open a brokerage in-app or link an existing one. Your data stays encrypted; we never sell it.",
  },
  {
    title: "First investment plan",
    minutes: 2,
    icon: Sparkles,
    body: "Approve your starting allocation, schedule auto-contributions, and you're investing from day one.",
  },
];

const NEXT_STEPS = [
  {
    title: "Increase auto-contribution to $620/mo",
    detail: "Closes the gap to your 2046 target by 4 years.",
    impact: "+4 yrs faster",
  },
  {
    title: "Rebalance international sleeve",
    detail: "Drift exceeds 3% band. One tap to bring back to plan.",
    impact: "Tax-aware",
  },
  {
    title: "Open a Roth IRA",
    detail: "$7,000/yr unused tax-advantaged room based on your inputs.",
    impact: "+$71k @ 25y",
  },
];

const TRUST_POINTS = [
  {
    icon: Lock,
    title: "Bank-grade encryption",
    body: "Account data is encrypted in transit and at rest.",
  },
  {
    icon: ShieldCheck,
    title: "Read-only by default",
    body: "We pull balances and positions — no trade authority unless you grant it.",
  },
  {
    icon: LineIcon,
    title: "Transparent assumptions",
    body: "Every projection shows the rate, horizon, and inputs that produced it.",
  },
];

function NavBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-6">
        <Link
          href="/"
          data-testid="link-home"
          className="inline-flex items-center"
        >
          <WordMark />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <a
            href="#calculator"
            data-testid="link-nav-calculator"
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Goal calculator
          </a>
          <a
            href="#preview"
            data-testid="link-nav-preview"
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Dashboard preview
          </a>
          <a
            href="#onboarding"
            data-testid="link-nav-onboarding"
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            How it works
          </a>
          <a
            href="#disclosures"
            data-testid="link-nav-disclosures"
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Disclosures
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            <Link href="/dashboard" data-testid="link-nav-dashboard">
              Open dashboard
            </Link>
          </Button>
          <Button asChild size="sm">
            <a href="#calculator" data-testid="cta-nav-start">
              Start your plan
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div className="grid-bg absolute inset-0 opacity-[0.35]" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 -top-40 h-80 bg-[radial-gradient(60%_60%_at_50%_50%,hsl(var(--primary)/0.12),transparent)]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-24">
        <Badge
          variant="secondary"
          className="mb-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
          data-testid="badge-hero-tag"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Goal-first investing for working professionals
        </Badge>
        <h1
          className="max-w-4xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl"
          data-testid="text-hero-headline"
        >
          Anyone with a paycheck can get an institutional-grade plan in 10 minutes,
          invest from day one, and never wonder what to do next
        </h1>
        <p
          className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl"
          data-testid="text-hero-subcopy"
        >
          TreasuryLens turns the way pensions and endowments think about money into a
          plan you can run from your phone. Set a goal, connect your cashflow, and get
          a clear, transparent dashboard that tells you what to do — every paycheck.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <a href="#calculator" data-testid="cta-hero-start">
              Start your 10-minute plan
              <ArrowRight className="ml-1 h-4 w-4" />
            </a>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="w-full sm:w-auto"
          >
            <a href="#calculator" data-testid="cta-hero-set-goal">
              Set a goal
            </a>
          </Button>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="w-full sm:w-auto"
          >
            <a href="#preview" data-testid="cta-hero-preview">
              Preview dashboard
              <ChevronRight className="ml-1 h-4 w-4" />
            </a>
          </Button>
        </div>
        <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {[
            { k: "10 min", v: "Average plan setup" },
            { k: "$0", v: "To preview your dashboard" },
            { k: "100%", v: "Transparent assumptions" },
            { k: "Read-only", v: "Account access by default" },
          ].map((s) => (
            <div key={s.v}>
              <dt className="num text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                {s.k}
              </dt>
              <dd className="mt-1 text-xs text-muted-foreground md:text-sm">
                {s.v}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function GoalCalculator() {
  const [starting, setStarting] = useState(2500);
  const [monthly, setMonthly] = useState(450);
  const [years, setYears] = useState(20);
  const [annualReturn, setAnnualReturn] = useState(6.5);
  const [target, setTarget] = useState(250000);

  const projection = useMemo(
    () => projectFutureValue(starting, monthly, years, annualReturn),
    [starting, monthly, years, annualReturn],
  );

  const needed = useMemo(
    () => requiredMonthly(starting, target, years, annualReturn),
    [starting, target, years, annualReturn],
  );

  const progress = Math.max(
    0,
    Math.min(100, (projection.final / target) * 100),
  );
  const gap = projection.final - target;
  const monthlyDelta = needed - monthly;

  const chartData = projection.series.map((p) => ({
    yr: +(p.month / 12).toFixed(1),
    Projected: Math.round(p.value),
    Contributed: Math.round(p.contributions),
  }));

  return (
    <section
      id="calculator"
      className="border-b border-border/60 py-16 md:py-24"
      data-testid="section-calculator"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3 inline-flex gap-1.5">
              <Calculator className="h-3.5 w-3.5 text-primary" /> Interactive
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              See your goal at a glance
            </h2>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Drag the inputs. Watch the projection move. This is the same engine
              that powers the plan inside the app.
            </p>
          </div>
          <p className="text-xs text-muted-foreground md:max-w-xs md:text-right">
            Hypothetical projection — not advice or a guarantee of future results.
            Actual returns vary.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Your inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="calc-starting">Starting amount</Label>
                  <span className="num text-sm">{fmtUSD(starting)}</span>
                </div>
                <Input
                  id="calc-starting"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  value={starting}
                  onChange={(e) => setStarting(Math.max(0, +e.target.value || 0))}
                  data-testid="input-calc-starting"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="calc-monthly">Monthly contribution</Label>
                  <span className="num text-sm">{fmtUSD(monthly)}</span>
                </div>
                <Input
                  id="calc-monthly"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={25}
                  value={monthly}
                  onChange={(e) => setMonthly(Math.max(0, +e.target.value || 0))}
                  data-testid="input-calc-monthly"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Time horizon</Label>
                  <span className="num text-sm">{years} years</span>
                </div>
                <Slider
                  min={1}
                  max={40}
                  step={1}
                  value={[years]}
                  onValueChange={(v) => setYears(v[0])}
                  data-testid="input-calc-years"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Expected annual return</Label>
                  <span className="num text-sm">{annualReturn.toFixed(1)}%</span>
                </div>
                <Slider
                  min={0}
                  max={12}
                  step={0.1}
                  value={[annualReturn]}
                  onValueChange={(v) => setAnnualReturn(v[0])}
                  data-testid="input-calc-return"
                />
                <p className="text-[11px] text-muted-foreground">
                  Hypothetical, before inflation and taxes. Past performance does not
                  predict future results.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="calc-target">Target goal</Label>
                  <span className="num text-sm">{fmtUSD(target)}</span>
                </div>
                <Input
                  id="calc-target"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1000}
                  value={target}
                  onChange={(e) => setTarget(Math.max(0, +e.target.value || 0))}
                  data-testid="input-calc-target"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Projection</CardTitle>
                <Badge variant="secondary" className="text-[10px]">Sample data</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-md border border-border/60 bg-card p-4">
                  <div className="text-xs text-muted-foreground">
                    Projected value at year {years}
                  </div>
                  <div
                    className="num mt-1 text-2xl font-semibold tracking-tight"
                    data-testid="text-calc-projected"
                  >
                    {fmtUSD(projection.final)}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    of which {fmtUSD(projection.contributions)} contributed
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-card p-4">
                  <div className="text-xs text-muted-foreground">
                    Progress vs goal
                  </div>
                  <div
                    className="num mt-1 text-2xl font-semibold tracking-tight"
                    data-testid="text-calc-progress"
                  >
                    {progress.toFixed(0)}%
                  </div>
                  <Progress value={progress} className="mt-2 h-1.5" />
                </div>
                <div className="rounded-md border border-border/60 bg-card p-4">
                  <div className="text-xs text-muted-foreground">
                    {gap >= 0 ? "Surplus over goal" : "Gap to goal"}
                  </div>
                  <div
                    className={`num mt-1 text-2xl font-semibold tracking-tight ${
                      gap >= 0 ? "text-[hsl(var(--pos))]" : "text-[hsl(var(--neg))]"
                    }`}
                    data-testid="text-calc-gap"
                  >
                    {gap >= 0 ? "+" : "−"}
                    {fmtUSD(Math.abs(gap))}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {monthlyDelta > 0
                      ? `Add ~${fmtUSD(monthlyDelta)}/mo to close the gap`
                      : "On track at current contribution"}
                  </div>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradProj" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gradContrib" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                    <XAxis
                      dataKey="yr"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      unit="y"
                    />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => fmtUSD(Number(v))}
                      labelFormatter={(l: number) => `Year ${l}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="Contributed"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1.5}
                      fill="url(#gradContrib)"
                    />
                    <Area
                      type="monotone"
                      dataKey="Projected"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#gradProj)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Projections assume a constant return and contribution. Actual results
                will vary with market conditions, fees, and taxes.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  const data = useMemo(
    () =>
      Array.from({ length: 24 }).map((_, i) => ({
        m: i,
        portfolio: Math.round(12000 + i * 540 + Math.sin(i / 2) * 380),
        plan: Math.round(12000 + i * 500),
      })),
    [],
  );

  return (
    <section
      id="preview"
      className="border-b border-border/60 bg-card/40 py-16 md:py-24"
      data-testid="section-preview"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3 inline-flex gap-1.5">
              <LineIcon className="h-3.5 w-3.5 text-primary" /> Sample dashboard
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              The dashboard that tells you what to do next
            </h2>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Allocation, goal progress, contribution plan, risk metrics, and
              concrete next steps — all in one place. Below is illustrative sample
              data for a hypothetical investor.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/dashboard" data-testid="cta-preview-open-dashboard">
              Open the live dashboard
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Portfolio vs plan</CardTitle>
                <Badge variant="secondary" className="text-[10px]">Sample data</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 pb-3 sm:grid-cols-4">
                <Stat label="Net worth" value="$24,860" tone="pos" delta="+$1,420 mo" testid="stat-networth" />
                <Stat label="On-plan" value="103%" tone="pos" delta="ahead of pace" testid="stat-onplan" />
                <Stat label="Contribution" value="$450 / mo" delta="auto-deposit" testid="stat-contrib" />
                <Stat label="Risk band" value="Moderate" delta="vol target 11%" testid="stat-risk" />
              </div>
              <Separator className="my-2" />
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradPort" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                    <XAxis dataKey="m" hide />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => fmtUSD(Number(v))}
                    />
                    <Area
                      type="monotone"
                      dataKey="plan"
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="3 3"
                      strokeWidth={1.5}
                      fill="transparent"
                    />
                    <Area
                      type="monotone"
                      dataKey="portfolio"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#gradPort)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Allocation</CardTitle>
                <Badge variant="secondary" className="text-[10px]">Sample</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-44 w-full" data-testid="chart-allocation">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={ALLOCATION}
                      dataKey="value"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {ALLOCATION.map((a) => (
                        <Cell key={a.name} fill={a.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number, n: string) => [`${v}%`, n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {ALLOCATION.map((a) => (
                  <li key={a.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-muted-foreground">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: a.color }}
                      />
                      {a.name}
                    </span>
                    <span className="num text-foreground">{a.value}%</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle className="text-base">Next steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border/60" data-testid="list-next-steps">
                {NEXT_STEPS.map((s) => (
                  <li key={s.title} className="flex items-start justify-between gap-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{s.title}</div>
                        <div className="text-xs text-muted-foreground">{s.detail}</div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {s.impact}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="text-base">Risk metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <RiskBar label="Volatility (annualized)" value={11} max={25} display="11.0%" />
              <RiskBar label="Max drawdown (modeled)" value={18} max={50} display="−18%" />
              <RiskBar label="Concentration (single name)" value={4.2} max={10} display="4.2%" />
              <RiskBar label="Cash runway" value={6.5} max={12} display="6.5 mo" />
              <p className="text-[11px] text-muted-foreground">
                Risk metrics are modeled estimates from sample holdings; live values
                update with your actual portfolio.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  delta,
  tone,
  testid,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "pos" | "neg";
  testid?: string;
}) {
  return (
    <div data-testid={testid}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="num mt-0.5 text-lg font-semibold tracking-tight">{value}</div>
      {delta && (
        <div
          className={`text-[11px] ${
            tone === "pos"
              ? "text-[hsl(var(--pos))]"
              : tone === "neg"
                ? "text-[hsl(var(--neg))]"
                : "text-muted-foreground"
          }`}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

function RiskBar({
  label,
  value,
  max,
  display,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="num text-xs">{display}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full rounded bg-primary/80"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function OnboardingFlow() {
  const [step, setStep] = useState(0);
  const cur = ONBOARDING_STEPS[step];
  const Icon = cur.icon;
  const totalMinutes = ONBOARDING_STEPS.reduce((a, s) => a + s.minutes, 0);
  const elapsed = ONBOARDING_STEPS.slice(0, step + 1).reduce(
    (a, s) => a + s.minutes,
    0,
  );

  return (
    <section
      id="onboarding"
      className="border-b border-border/60 py-16 md:py-24"
      data-testid="section-onboarding"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3 inline-flex gap-1.5">
              <Smartphone className="h-3.5 w-3.5 text-primary" /> Mobile-first onboarding
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              From zero to invested in 10 minutes
            </h2>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Tap through the actual flow. Five steps, clear language, no jargon —
              the same thing you'll do when you sign up.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="num">
              {elapsed} of ~{totalMinutes} min
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1" data-testid="list-onboarding-steps">
                {ONBOARDING_STEPS.map((s, i) => {
                  const StepIcon = s.icon;
                  const active = i === step;
                  const done = i < step;
                  return (
                    <li key={s.title}>
                      <button
                        type="button"
                        onClick={() => setStep(i)}
                        data-testid={`btn-onboarding-step-${i}`}
                        className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                          active
                            ? "border-primary/40 bg-primary/5"
                            : "border-transparent hover:bg-accent/50"
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                            done
                              ? "border-[hsl(var(--pos))] bg-[hsl(var(--pos))]/10 text-[hsl(var(--pos))]"
                              : active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground"
                          }`}
                        >
                          {done ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <StepIcon className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {s.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            ~{s.minutes} min
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          <Card className="lg:col-span-8">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">
                  Step {step + 1}: {cur.title}
                </CardTitle>
                <Badge variant="secondary" className="text-[10px]">
                  Demo
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
                <div className="md:col-span-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="text-sm font-medium">{cur.title}</div>
                      <div className="text-xs text-muted-foreground">
                        Estimated time: {cur.minutes} min
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {cur.body}
                  </p>
                  <div className="mt-6 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStep((s) => Math.max(0, s - 1))}
                      disabled={step === 0}
                      data-testid="btn-onboarding-prev"
                    >
                      Back
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        setStep((s) =>
                          Math.min(ONBOARDING_STEPS.length - 1, s + 1),
                        )
                      }
                      disabled={step === ONBOARDING_STEPS.length - 1}
                      data-testid="btn-onboarding-next"
                    >
                      {step === ONBOARDING_STEPS.length - 1 ? "Done" : "Next"}
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="md:col-span-5">
                  <PhoneFrame stepIndex={step} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function PhoneFrame({ stepIndex }: { stepIndex: number }) {
  const labels = [
    "What are you saving for?",
    "Roughly what's your take-home?",
    "How would you feel about a 20% drop?",
    "Open or link a brokerage",
    "Review your starting plan",
  ];
  const items = [
    ["Retirement", "Home", "Education", "Other"],
    ["< $3k / mo", "$3–6k", "$6–10k", "$10k+"],
    ["Wait it out", "Buy more", "Worried", "Sell"],
    ["Open with TreasuryLens", "Link existing", "Skip for now"],
    ["Approve & start", "Adjust", "Save for later"],
  ];
  return (
    <div className="relative mx-auto w-full max-w-[280px]" data-testid="onboarding-phone">
      <div className="rounded-[2rem] border border-border bg-background p-2 shadow-xl">
        <div className="rounded-[1.6rem] border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>9:41</span>
            <WordMark className="scale-90" />
            <span>•••</span>
          </div>
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
            </div>
            <div className="mt-1 text-sm font-semibold leading-snug">
              {labels[stepIndex]}
            </div>
            <div className="mt-3 space-y-1.5">
              {items[stepIndex].map((it, idx) => (
                <div
                  key={it}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
                    idx === 0
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-border/60 text-muted-foreground"
                  }`}
                >
                  <span>{it}</span>
                  {idx === 0 && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 h-8 rounded-md bg-primary text-center text-[11px] font-semibold leading-8 text-primary-foreground">
              Continue
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrustStrip() {
  return (
    <section className="border-b border-border/60 py-12">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TRUST_POINTS.map((t) => {
            const I = t.icon;
            return (
              <div
                key={t.title}
                className="flex items-start gap-3 rounded-md border border-border/60 bg-card/50 p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <I className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">{t.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="border-b border-border/60 py-16 md:py-24">
      <div className="mx-auto max-w-4xl px-4 text-center md:px-6">
        <PiggyBank className="mx-auto h-9 w-9 text-primary" />
        <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
          Stop guessing. Start a plan you can run for decades.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Build your first plan in 10 minutes. No commitment, no fees to preview your
          dashboard.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <a href="#calculator" data-testid="cta-final-start">
              Start your 10-minute plan
              <ArrowRight className="ml-1 h-4 w-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/dashboard" data-testid="cta-final-dashboard">
              Preview the dashboard
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Disclosures() {
  return (
    <section
      id="disclosures"
      className="bg-card/40 py-12"
      data-testid="section-disclosures"
    >
      <div className="mx-auto max-w-5xl px-4 md:px-6">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[hsl(var(--warn))]" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Important disclosures
          </h3>
        </div>
        <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            <strong className="text-foreground">Not investment advice.</strong> The
            information on this page and within the TreasuryLens app is provided for
            educational and informational purposes only. It is not personalized
            investment, tax, or legal advice and does not constitute a recommendation
            to buy or sell any security.
          </p>
          <p>
            <strong className="text-foreground">Investments involve risk.</strong>
            {" "}All investments carry risk, including the possible loss of principal.
            Diversification and asset allocation do not guarantee a profit or protect
            against losses.
          </p>
          <p>
            <strong className="text-foreground">
              Projections are hypothetical.
            </strong>{" "}
            Calculator outputs and dashboard previews shown here use illustrative
            sample inputs and assume a constant rate of return for simplicity. Actual
            returns will fluctuate with market conditions, fees, and taxes. Past
            performance is not indicative of future results, and no outcome shown is
            guaranteed.
          </p>
          <p>
            <strong className="text-foreground">Suitability is personal.</strong>
            {" "}Whether any strategy or allocation is right for you depends on your
            full financial picture, goals, and risk tolerance. You should consider
            consulting a qualified financial professional before making investment
            decisions.
          </p>
          <p>
            <strong className="text-foreground">Data sources and timing.</strong>
            {" "}Market data, fundamentals, and 13F holdings shown elsewhere in
            TreasuryLens are obtained from public sources and may be delayed. 13F
            filings reflect a quarterly snapshot and can be filed up to 45 days after
            quarter-end; positions shown may no longer reflect current holdings.
          </p>
          <p>
            <strong className="text-foreground">No account relationship.</strong>
            {" "}TreasuryLens is a software product. Statements about account opening,
            linking, or contributions describe planned product flows; availability of
            specific account types depends on third-party providers and your
            eligibility.
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-8">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 md:flex-row md:items-center md:px-6">
        <div className="flex items-center gap-3">
          <WordMark />
          <span className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} TreasuryLens
          </span>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Link
            href="/dashboard"
            data-testid="link-footer-dashboard"
            className="hover:text-foreground"
          >
            Dashboard
          </Link>
          <Link
            href="/superinvestors"
            data-testid="link-footer-superinvestors"
            className="hover:text-foreground"
          >
            Superinvestors
          </Link>
          <a href="#disclosures" className="hover:text-foreground">
            Disclosures
          </a>
        </nav>
      </div>
    </footer>
  );
}

export default function Landing() {
  useEnsureDark();
  useEffect(() => {
    document.title =
      "TreasuryLens — Goal-first investing plan in 10 minutes";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        "content",
        "TreasuryLens turns institutional-grade portfolio thinking into a 10-minute plan you can run from your phone — set a goal, connect cashflow, and invest with a clear dashboard.",
      );
    }
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <NavBar />
      <main>
        <Hero />
        <TrustStrip />
        <GoalCalculator />
        <DashboardPreview />
        <OnboardingFlow />
        <FinalCTA />
        <Disclosures />
      </main>
      <Footer />
    </div>
  );
}
