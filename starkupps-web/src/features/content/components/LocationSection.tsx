import { MapPin, Phone, MessageCircle, Clock } from "lucide-react";

const MAPS_QUERY = "StarKupps+Main+Road+Munger+Bihar";

export function LocationSection() {
  return (
    <section id="visit" className="mx-auto w-full max-w-6xl scroll-mt-16 px-4 py-14">
      <p className="eyebrow text-primary">Visit</p>
      <h2 className="display-lg mt-2 max-w-2xl">Azad Chowk, Munger — open till 11 PM.</h2>

      <div className="mt-8 grid gap-3 md:grid-cols-5">
        <div className="overflow-hidden rounded-3xl border border-border shadow-card md:col-span-3">
          <iframe
            title="Map showing StarKupps on Main Road, Munger"
            src={`https://www.google.com/maps?q=${MAPS_QUERY}&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="h-64 w-full border-0 md:h-full md:min-h-[22rem]"
          />
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-card md:col-span-2">
          <div className="flex gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-base">
              StarKupps Café
              <br />
              <span className="text-muted-foreground">
                Azad Chowk, Infront Of Jain Dharamshala, Shah Family, Dilawer Pur, Munger, Bihar
              </span>
            </p>
          </div>
          <div className="mt-4 flex gap-3">
            <Clock className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-base">
              10:00 AM – 11:00 PM
              <br />
              <span className="text-muted-foreground">Every day, including Sundays</span>
            </p>
          </div>

          <div className="mt-6 grid gap-2">
            <a
              href={`https://maps.google.com/?q=${MAPS_QUERY}`}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-espresso px-5 text-base font-semibold text-espresso-foreground shadow-raised"
            >
              <MapPin className="size-5" />
              Get directions
            </a>
            <div className="grid grid-cols-2 gap-2">
              <a
                href="https://wa.me/918252433504"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-4 text-base font-semibold"
              >
                <MessageCircle className="size-5 text-veg" />
                WhatsApp
              </a>
              <a
                href="tel:+918252433504"
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-4 text-base font-semibold"
              >
                <Phone className="size-5 text-primary" />
                Call
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
