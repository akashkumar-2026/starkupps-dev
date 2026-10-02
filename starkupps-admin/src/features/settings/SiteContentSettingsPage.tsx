import { trpc } from "@/api/trpc";
import { FormField } from "@/components/shared/FormField";
import { PageHeading } from "@/components/shared/PageHeading";
import { ErrorPanel, PageLoading } from "@/components/shared/StatePanels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiError } from "@/utils/errors";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Every field of `public.site_settings`.
 *
 * Kept as one flat object so the form, the save payload and the server's zod
 * schema stay in step: a field added here without a column (or the reverse) is a
 * type error rather than a silently dropped edit.
 */
type SiteContentForm = {
  brandName: string;
  tagline: string;
  phoneDigits: string;
  whatsappNumber: string;
  address: string;
  addressDetail: string;
  mapsQuery: string;
  latitude: number | null;
  longitude: number | null;
  hoursSummary: string;
  hoursShort: string;
  hoursNote: string;
  openTime: string;
  closeTime: string;
  closedDays: string;
  fssaiLicense: string;
  heroHeading: string;
  heroSubheading: string;
  heroBadge: string;
  heroCtaLabel: string;
  openBadge: string;
  statRatingLabel: string;
  statOrdersLabel: string;
  statPickupLabel: string;
  trustHeading: string;
  trustClaim1: string;
  trustClaim2: string;
  trustClaim3: string;
  trustPickupStat: string;
  trustPickupCaption: string;
  trustPremadeStat: string;
  trustPremadeCaption: string;
  galleryHeading: string;
  galleryBody: string;
  menuHeading: string;
  menuEmptyMessage: string;
  metaTitle: string;
  metaDescription: string;
  metaOgDescription: string;
  galleryImages: { url: string; alt: string; span: "" | "sm:col-span-2" }[];
};

/**
 * Blank, not defaulted.
 *
 * The storefront renders an unconfigured field by omitting it, so seeding this
 * form with placeholder values would put fake business facts back into the
 * database the moment an owner opened the page and pressed Save.
 */
const BLANK: SiteContentForm = {
  brandName: "",
  tagline: "",
  phoneDigits: "",
  whatsappNumber: "",
  address: "",
  addressDetail: "",
  mapsQuery: "",
  latitude: null,
  longitude: null,
  hoursSummary: "",
  hoursShort: "",
  hoursNote: "",
  openTime: "",
  closeTime: "",
  closedDays: "",
  fssaiLicense: "",
  heroHeading: "",
  heroSubheading: "",
  heroBadge: "",
  heroCtaLabel: "",
  openBadge: "",
  statRatingLabel: "",
  statOrdersLabel: "",
  statPickupLabel: "",
  trustHeading: "",
  trustClaim1: "",
  trustClaim2: "",
  trustClaim3: "",
  trustPickupStat: "",
  trustPickupCaption: "",
  trustPremadeStat: "",
  trustPremadeCaption: "",
  galleryHeading: "",
  galleryBody: "",
  menuHeading: "",
  menuEmptyMessage: "",
  metaTitle: "",
  metaDescription: "",
  metaOgDescription: "",
  galleryImages: [],
};

const text = (value: unknown): string => (value == null ? "" : String(value));
const num = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

export default function SiteContentSettingsPage() {
  const query = trpc.siteContent.get.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.siteContent.save.useMutation({
    // The public site holds this row in its React Query cache and in edge
    // caches, so invalidate both sides after a write rather than waiting for a
    // staleTime window to expire.
    onSuccess: async () => {
      toast.success("Storefront content saved");
      await utils.siteContent.get.invalidate();
    },
    onError: e => toast.error(apiError(e)),
  });

  const [form, setForm] = useState<SiteContentForm>(BLANK);
  // `hydrated` guards the effect against a background refetch replacing the
  // row while the owner is mid-edit.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    if (hydrated) return;
    const s = query.data as Record<string, unknown>;
    setForm({
      brandName: text(s.brandName),
      tagline: text(s.tagline),
      phoneDigits: text(s.phoneDigits),
      whatsappNumber: text(s.whatsappNumber),
      address: text(s.address),
      addressDetail: text(s.addressDetail),
      mapsQuery: text(s.mapsQuery),
      latitude: num(s.latitude),
      longitude: num(s.longitude),
      hoursSummary: text(s.hoursSummary),
      hoursShort: text(s.hoursShort),
      hoursNote: text(s.hoursNote),
      openTime: text(s.openTime),
      closeTime: text(s.closeTime),
      closedDays: text(s.closedDays),
      fssaiLicense: text(s.fssaiLicense),
      heroHeading: text(s.heroHeading),
      heroSubheading: text(s.heroSubheading),
      heroBadge: text(s.heroBadge),
      heroCtaLabel: text(s.heroCtaLabel),
      openBadge: text(s.openBadge),
      statRatingLabel: text(s.statRatingLabel),
      statOrdersLabel: text(s.statOrdersLabel),
      statPickupLabel: text(s.statPickupLabel),
      trustHeading: text(s.trustHeading),
      trustClaim1: text(s.trustClaim1),
      trustClaim2: text(s.trustClaim2),
      trustClaim3: text(s.trustClaim3),
      trustPickupStat: text(s.trustPickupStat),
      trustPickupCaption: text(s.trustPickupCaption),
      trustPremadeStat: text(s.trustPremadeStat),
      trustPremadeCaption: text(s.trustPremadeCaption),
      galleryHeading: text(s.galleryHeading),
      galleryBody: text(s.galleryBody),
      menuHeading: text(s.menuHeading),
      menuEmptyMessage: text(s.menuEmptyMessage),
      metaTitle: text(s.metaTitle),
      metaDescription: text(s.metaDescription),
      metaOgDescription: text(s.metaOgDescription),
      galleryImages: Array.isArray(s.galleryImages)
        ? (s.galleryImages as SiteContentForm["galleryImages"])
        : [],
    });
    setHydrated(true);
  }, [query.data, hydrated]);

  if (query.isLoading) return <PageLoading />;
  if (query.isError)
    return (
      <ErrorPanel
        detail={apiError(query.error)}
        retry={() => query.refetch()}
      />
    );

  const set = <K extends keyof SiteContentForm>(
    key: K,
    value: SiteContentForm[K]
  ) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <>
      <PageHeading
        kicker="Configuration"
        title="Storefront content"
        detail="Everything the public site says about the cafe. Fields left blank are omitted from the page rather than filled with a placeholder — only owners can edit these."
      />

      <div className="space-y-6">
        {(
          [
            {
              title: "Brand & contact",
              fields: [
                ["brandName", "Brand name", "StarKupps", "text"],
                [
                  "tagline",
                  "Tagline",
                  "Coffee, Pizza & Burgers in Munger",
                  "text",
                ],
                ["phoneDigits", "Phone (digits only)", "918252433504", "text"],
                [
                  "whatsappNumber",
                  "WhatsApp (digits only)",
                  "918252433504",
                  "text",
                ],
                ["address", "Address", "Street, area, city, state", "text"],
                ["addressDetail", "Address (full, as printed)", "", "text"],
                [
                  "mapsQuery",
                  "Maps search query",
                  "Used for the embed and directions link",
                  "text",
                ],
                ["latitude", "Latitude", "Optional", "number"],
                ["longitude", "Longitude", "Optional", "number"],
              ],
            },
            {
              title: "Hours & compliance",
              fields: [
                [
                  "openTime",
                  "Opens at",
                  "Drives the Open/Closed badge on the storefront",
                  "time",
                ],
                [
                  "closeTime",
                  "Closes at",
                  "Earlier than the opening time means it runs past midnight",
                  "time",
                ],
                [
                  "closedDays",
                  "Closed days",
                  "Weekday numbers, 1 = Mon to 7 = Sun. Leave blank for open every day.",
                  "text",
                ],
                ["hoursSummary", "Hours (full)", "10:00 AM – 11:00 PM", "text"],
                ["hoursShort", "Hours (short)", "10 AM – 11 PM", "text"],
                [
                  "hoursNote",
                  "Hours note",
                  "Every day, including Sundays",
                  "text",
                ],
                [
                  "fssaiLicense",
                  "FSSAI licence",
                  "Printed on the trust section and about page",
                  "text",
                ],
              ],
            },
            {
              title: "Hero",
              fields: [
                ["heroBadge", "Badge", "e.g. Open now", "text"],
                ["openBadge", "Badge suffix", "e.g. Closes 11 PM", "text"],
                ["heroHeading", "Heading", "", "text"],
                ["heroSubheading", "Sub-heading", "", "area"],
                ["heroCtaLabel", "Button label", "Order now", "text"],
              ],
            },
            {
              title: "Stats strip",
              fields: [
                [
                  "statRatingLabel",
                  "Rating",
                  "e.g. 4.8 on Google · 1,240 reviews",
                  "text",
                ],
                [
                  "statOrdersLabel",
                  "Orders",
                  "e.g. 312 orders this week",
                  "text",
                ],
                [
                  "statPickupLabel",
                  "Pickup time",
                  "e.g. Avg. pickup time 9 min",
                  "text",
                ],
              ],
            },
            {
              title: "Trust section",
              fields: [
                ["trustHeading", "Heading", "", "text"],
                ["trustClaim1", "Claim 1", "", "area"],
                ["trustClaim2", "Claim 2", "", "area"],
                [
                  "trustClaim3",
                  "Claim 3",
                  "Also shown on the about page as the hygiene audit",
                  "area",
                ],
                ["trustPickupStat", "Pickup stat", "e.g. 9 min", "text"],
                ["trustPickupCaption", "Pickup caption", "", "area"],
                ["trustPremadeStat", "Pre-made stat", "e.g. 0", "text"],
                ["trustPremadeCaption", "Pre-made caption", "", "area"],
              ],
            },
            {
              title: "Gallery & menu",
              fields: [
                ["galleryHeading", "Gallery heading", "", "text"],
                ["galleryBody", "Gallery body", "", "area"],
                ["menuHeading", "Menu heading", "", "text"],
                [
                  "menuEmptyMessage",
                  "Menu empty message",
                  "Shown when no categories are published",
                  "area",
                ],
              ],
            },
            {
              title: "SEO",
              fields: [
                ["metaTitle", "Page title", "", "text"],
                ["metaDescription", "Meta description", "", "area"],
                ["metaOgDescription", "Social description", "", "area"],
              ],
            },
          ] as const
        ).map(section => (
          <section
            key={section.title}
            className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-6 space-y-4"
          >
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#A83825]">
              {section.title}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {section.fields.map(([key, label, hint, kind]) => {
                const value = form[key];
                return (
                  <FormField
                    key={key}
                    label={label}
                    hint={hint}
                    className={kind === "area" ? "md:col-span-2" : undefined}
                  >
                    {kind === "area" ? (
                      <Textarea
                        value={typeof value === "string" ? value : ""}
                        onChange={e =>
                          set(
                            key as keyof SiteContentForm,
                            e.target.value as never
                          )
                        }
                        rows={3}
                      />
                    ) : (
                      <Input
                        type={
                          kind === "number"
                            ? "number"
                            : kind === "time"
                              ? "time"
                              : "text"
                        }
                        step={kind === "number" ? "any" : undefined}
                        value={
                          value === null || value === undefined
                            ? ""
                            : String(value)
                        }
                        onChange={e =>
                          set(
                            key as keyof SiteContentForm,
                            (kind === "number"
                              ? num(e.target.value)
                              : e.target.value) as never
                          )
                        }
                      />
                    )}
                  </FormField>
                );
              })}
            </div>
          </section>
        ))}

        <div className="flex items-center justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setHydrated(false);
              void query.refetch();
            }}
          >
            Discard changes
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? "Saving…" : "Save storefront content"}
          </Button>
        </div>
      </div>
    </>
  );
}
