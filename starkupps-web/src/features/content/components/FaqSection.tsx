import { motion } from "motion/react";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Pressable } from "@/components/shared/Pressable";
import { usePublicFaqs } from "@/features/content/useSiteContent";
import { springs } from "@/utils/motion";

/**
 * Customer-facing FAQs, from `public.faqs` (Admin > Content > FAQs).
 *
 * One question is open at a time: opening another closes the previous one, which
 * keeps the section a predictable height instead of letting it grow without
 * bound.
 *
 * The grid uses `items-start` deliberately. Grid items default to `stretch`, so a
 * card in a row whose sibling expanded would be stretched into a tall empty box —
 * that was the original bug in this section. Each cell keeps its own height.
 */
export function FaqSection({ contactHref = "#visit" }: { contactHref?: string }) {
  const { data: faqs, error, isLoading, isFetching, refetch } = usePublicFaqs();
  const [openId, setOpenId] = useState<number | null>(null);

  if (!isLoading && !error && !faqs?.length) return null;

  const list = faqs ?? [];

  return (
    <section aria-labelledby="faq-heading" className="section-y bg-background">
      <div className="mx-auto w-full max-w-6xl px-4">
        <header className="max-w-2xl">
          <p className="eyebrow text-primary">Help &amp; info</p>
          <h2 id="faq-heading" className="display-lg mt-2 max-w-xl text-balance">
            Questions, answered.
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground sm:text-base">
            A few useful details to make your next StarKupps order even easier.
          </p>
        </header>

        <div className="mt-8 sm:mt-10">
          {isLoading ? (
            <div className="columns-1 gap-3 md:columns-2">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  aria-hidden="true"
                  className="mb-3 h-[68px] break-inside-avoid animate-pulse rounded-2xl border border-border bg-card"
                />
              ))}
            </div>
          ) : error ? (
            <div role="alert" className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <p className="text-sm text-muted-foreground">
                FAQs are temporarily unavailable. Please try again.
              </p>
              <Pressable
                onClick={() => void refetch()}
                disabled={isFetching}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-chip transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
                {isFetching ? "Retrying" : "Try again"}
              </Pressable>
            </div>
          ) : (
            /* CSS columns rather than grid: grid rows are sized by the tallest
               cell, so an expanded answer left a visible gap beside it. Columns
               pack tightly and keep the two halves balanced. */
            <ul className="columns-1 gap-3 md:columns-2">
              {list.map((faq) => {
                const isOpen = openId === faq.id;
                const panelId = `faq-panel-${faq.id}`;
                const buttonId = `faq-button-${faq.id}`;
                return (
                  <li
                    key={faq.id}
                    className="mb-3 break-inside-avoid overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-colors has-[button[aria-expanded='true']]:border-primary/40"
                  >
                    <h3>
                      <button
                        id={buttonId}
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => setOpenId(isOpen ? null : faq.id)}
                        className="group flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-6"
                      >
                        <span
                          className={
                            isOpen
                              ? "text-base font-semibold sm:text-lg"
                              : "text-base font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-lg"
                          }
                        >
                          {faq.question}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`ml-auto grid size-9 shrink-0 place-items-center rounded-full border transition-[background-color,border-color,transform] duration-200 ${
                            isOpen
                              ? "rotate-45 border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-primary group-hover:border-primary/40"
                          }`}
                        >
                          <Plus className="size-4" />
                        </span>
                      </button>
                    </h3>

                    {/* Always mounted so `aria-controls` always points at a real
                        element; only the height animates. */}
                    <motion.div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      aria-hidden={!isOpen}
                      initial={false}
                      animate={isOpen ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                      transition={springs.section}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-5 text-sm leading-7 text-muted-foreground sm:px-6">
                        {faq.answer}
                      </p>
                    </motion.div>
                  </li>
                );
              })}
            </ul>
          )}

          {!isLoading && !error && list.length ? (
            <p className="mt-6 text-sm text-muted-foreground">
              Still need a hand?{" "}
              <a
                href={contactHref}
                className="-my-1 rounded-sm px-1 py-1 font-semibold text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary active:opacity-70"
              >
                Get in touch
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
