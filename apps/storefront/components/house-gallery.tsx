"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

/** Swipeable photos of a house: one photo per swipe on a phone, arrows and a counter for everyone else. */
export default function HouseGallery({ images, alt }: { images: string[]; alt: string }) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-secondary-500/10 text-secondary-400">
        <ImageOff size={40} aria-hidden />
      </div>
    );
  }

  const go = (direction: 1 | -1) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth });

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-secondary-500/10">
      <div
        ref={strip}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={`${alt} - photo ${i + 1}`} draggable={false} loading={i === 0 ? "eager" : "lazy"} className="h-full w-full shrink-0 snap-center object-cover" />
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow disabled:hidden"
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={index >= images.length - 1}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow disabled:hidden"
          >
            <ChevronRight size={20} aria-hidden />
          </button>
          <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
            {index + 1}/{images.length}
          </span>
        </>
      )}
    </div>
  );
}
