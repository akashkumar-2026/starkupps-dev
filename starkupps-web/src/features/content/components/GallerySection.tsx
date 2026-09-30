import { motion } from "motion/react";
import { springs } from "@/utils/motion";
import counterImg from "@/assets/space.jpg";
import windowImg from "@/assets/space-window.jpg";
import cornerImg from "@/assets/space-corner.jpg";
import friendsImg from "@/assets/space-friends.jpg";
import interiorImg from "@/assets/space-interior.jpg";
import teamImg from "@/assets/bts-team.jpg";

const shots = [
  {
    src: counterImg,
    alt: "The StarKupps counter with the espresso machine",
    span: "sm:col-span-2",
  },
  { src: windowImg, alt: "Sunlit window seat with a coffee cup", span: "" },
  { src: cornerImg, alt: "The terracotta arch photo corner with hanging plants", span: "" },
  {
    src: friendsImg,
    alt: "Friends sharing pizza and cold coffee at a table",
    span: "sm:col-span-2",
  },
  { src: interiorImg, alt: "Warm minimal café interior in afternoon light", span: "" },
  { src: teamImg, alt: "The StarKupps team behind the counter", span: "" },
];

export function GallerySection() {
  return (
    <section className="bg-espresso text-espresso-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 py-14">
        <p className="eyebrow text-primary">The space</p>
        <h2 className="display-lg mt-2 max-w-2xl">Munger's spot to slow down.</h2>
        <p className="mt-4 max-w-md text-base opacity-90">
          Twenty-eight seats, free Wi-Fi, plug points at every table, and nobody rushing you out.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {shots.map((s, i) => (
            <motion.img
              key={s.src}
              src={s.src}
              alt={s.alt}
              loading="lazy"
              width={900}
              height={1100}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...springs.section, delay: (i % 3) * 0.05 }}
              className={`h-40 w-full rounded-3xl object-cover sm:h-52 ${s.span}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
