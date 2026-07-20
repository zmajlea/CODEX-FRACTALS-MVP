"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type Props = {
  value: string;
  categories: string[];
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Ana catpick: type a new category or pick one already in use.
 * Spec 47 Block A step 3 / demo.js buildCatPicker.
 */
export function CategoryPicker({
  value,
  categories,
  onChange,
  onCommit,
  placeholder = "Category to assign",
  "aria-label": ariaLabel = "Category to assign",
  disabled,
  className,
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const trimmed = value.trim();
  const q = trimmed.toLowerCase();
  const matches = useMemo(
    () =>
      categories.filter((c) => !q || c.toLowerCase().includes(q)).slice(0, 40),
    [categories, q]
  );
  const exact = categories.some((c) => c.toLowerCase() === q);
  const showNew = Boolean(trimmed && !exact);
  const showList = open && (matches.length > 0 || showNew);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(c: string) {
    onChange(c);
    setOpen(false);
    onCommit?.(c);
  }

  return (
    <div
      ref={wrapRef}
      className={`catpick${className ? ` ${className}` : ""}`}
    >
      <input
        type="text"
        className="cp-in"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const next = value.trim();
            if (next) choose(next);
          }
        }}
      />
      {showList ? (
        <div
          id={listId}
          className="cp-list"
          role="listbox"
          aria-label="Categories in use"
        >
          {matches.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              className="cp-opt"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
            >
              {c}
            </button>
          ))}
          {showNew ? (
            <button
              type="button"
              role="option"
              className="cp-opt cp-new"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(trimmed)}
            >
              {`Use "${trimmed}" as a new category`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
