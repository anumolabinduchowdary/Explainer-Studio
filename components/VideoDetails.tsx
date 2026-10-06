"use client";

import { useId } from "react";
import { ASPECT_RATIOS, LIMITS, type AspectRatio } from "@/lib/schemas";
import { inputClass } from "./ui";

export const SHAPE_LABELS: Record<AspectRatio, string> = {
  "9:16": "Tall (9:16)",
  "16:9": "Wide (16:9)",
  "1:1": "Square (1:1)",
};

type Props = {
  title: string;
  aspectRatio: AspectRatio;
  disabled: boolean;
  /** Whether the video ends with the Instagram QR card. Null hides the switch (no card picture). */
  endCard: boolean | null;
  onTitleChange: (title: string) => void;
  onAspectRatioChange: (aspectRatio: AspectRatio) => void;
  onEndCardChange: (on: boolean) => void;
};

/** The title and shape controls shared by both kinds of video. */
export function VideoDetails(props: Props) {
  const id = useId();
  return (
    <fieldset disabled={props.disabled} className="min-w-0 space-y-4 disabled:opacity-60">
      <legend className="sr-only">Video details</legend>
      <div>
        <label htmlFor={`${id}-title`} className="mb-1 block font-semibold">
          Video title
        </label>
        <input
          id={`${id}-title`}
          type="text"
          value={props.title}
          maxLength={LIMITS.title}
          onChange={(event) => props.onTitleChange(event.target.value)}
          className={inputClass}
        />
      </div>
      <fieldset>
        <legend className="mb-1 font-semibold">Shape</legend>
        <div className="flex flex-wrap gap-2">
          {ASPECT_RATIOS.map((ratio) => (
            <label key={ratio} className="cursor-pointer">
              <input
                type="radio"
                name={`${id}-shape`}
                value={ratio}
                checked={props.aspectRatio === ratio}
                onChange={() => props.onAspectRatioChange(ratio)}
                className="peer sr-only"
              />
              <span className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 font-semibold transition-colors duration-200 hover:border-brand peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand-strong peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                {SHAPE_LABELS[ratio]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {props.endCard !== null && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={props.endCard}
            onChange={(event) => props.onEndCardChange(event.target.checked)}
            className="size-5 accent-brand"
          />
          End with our Instagram QR code
        </label>
      )}
    </fieldset>
  );
}
