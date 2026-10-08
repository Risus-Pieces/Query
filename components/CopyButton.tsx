"use client";

import { useState } from "react";
import { CopyIcon } from "./icons";

export default function CopyButton({ text, label = "Copy", className = "btn" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard unavailable (e.g. insecure context) — nothing to do */
        }
      }}
    >
      <CopyIcon size={15} />
      {done ? "Copied" : label}
    </button>
  );
}
