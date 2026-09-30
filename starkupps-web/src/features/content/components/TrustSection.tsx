import { BadgeCheck, Coffee, Timer, Star } from "lucide-react";

const reviews = [
  {
    name: "Ritika S.",
    initials: "RS",
    text: "The cold coffee is genuinely better than what I drink in Patna. Came for one, ordered two.",
  },
  {
    name: "Md. Faisal",
    initials: "MF",
    text: "Pizza came out in nine minutes and the crust was still crackling. Staff let me watch them stretch it.",
  },
  {
    name: "Ankur K.",
    initials: "AK",
    text: "Clean kitchen, they show you the counter, and the smash burger is the real thing. Weekly stop now.",
  },
];

export function TrustSection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-14">
      <p className="eyebrow text-primary">Why trust us</p>
      <h2 className="display-lg mt-2 max-w-2xl">Licensed, sourced and made in front of you.</h2>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
          <span className="grid size-11 place-items-center rounded-full bg-accent text-primary">
            <BadgeCheck className="size-5" />
          </span>
          <h3 className="mt-4 text-xl">Hygiene & sourcing</h3>
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-accent/60 p-3">
            <BadgeCheck className="size-5 shrink-0 text-primary" />
            <div>
              <p className="eyebrow text-muted-foreground">FSSAI licence</p>
              <p className="text-base font-semibold tabular-nums">10424998000217</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>Single-origin Chikmagalur beans, roasted every 10 days.</li>
            <li>Pizza dough made fresh daily — never frozen.</li>
            <li>Grade A kitchen audit, renewed quarterly.</li>
          </ul>
        </div>

        <div className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-card">
          <span className="grid size-11 place-items-center rounded-full bg-accent text-primary">
            <Star className="size-5 fill-primary" />
          </span>
          <h3 className="mt-4 text-xl">Real reviews</h3>
          <div className="relative mt-4 h-[264px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]">
            <ul className="review-track flex flex-col gap-4" aria-live="off">
              {[...reviews, ...reviews].map((r, idx) => (
                <li
                  key={`${r.name}-${idx}`}
                  aria-hidden={idx >= reviews.length ? true : undefined}
                  className="flex gap-3"
                >
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-espresso text-xs font-bold text-espresso-foreground"
                  >
                    {r.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">“{r.text}”</p>
                    <p className="mt-1 text-xs font-semibold">{r.name} · Google review</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
          <span className="grid size-11 place-items-center rounded-full bg-accent text-primary">
            <Timer className="size-5" />
          </span>
          <h3 className="mt-4 text-xl">Fast & fresh</h3>
          <dl className="mt-4 space-y-3">
            <div>
              <dd className="font-display text-4xl font-semibold tabular-nums">9 min</dd>
              <dt className="text-sm text-muted-foreground">Average pickup time this month</dt>
            </div>
            <div>
              <dd className="font-display text-4xl font-semibold tabular-nums">0</dd>
              <dt className="text-sm text-muted-foreground">
                Items pre-made or held warm. Everything starts when you order.
              </dt>
            </div>
          </dl>
          <p className="mt-4 flex items-center gap-2 text-sm font-semibold">
            <Coffee className="size-4 text-primary" />
            Beans ground per cup, not per batch.
          </p>
        </div>
      </div>
    </section>
  );
}
