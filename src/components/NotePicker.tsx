import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { AllNotesData } from "../interaction/allNotesData";

export default function NotePicker({
  data,
  onPick,
}: {
  data: AllNotesData;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const list = useId();
  const search = useMemo(
    () => data.notes.map((n) => (n.title + " " + n.id).toLowerCase()),
    [data],
  );
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.rank.slice(0, 40);
    const exact: number[] = [],
      prefix: number[] = [],
      partial: number[] = [];
    for (const i of data.rank) {
      if (!search[i].includes(needle)) continue;
      const title = data.notes[i].title.toLowerCase();
      const bucket =
        title === needle || data.notes[i].id.toLowerCase() === needle
          ? exact
          : title.startsWith(needle)
            ? prefix
            : partial;
      if (bucket.length < 40) bucket.push(i);
    }
    return [...exact, ...prefix, ...partial].slice(0, 40);
  }, [data, query, search]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(list + "-" + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [list, active, open]);
  function close() {
    setOpen(false);
    button.current?.focus();
  }
  function pick(i: number | undefined) {
    if (i === undefined) return;
    close();
    onPick(data.notes[i].id);
  }
  return (
    <div
      className="map-picker"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        aria-label="Jump to note"
        title="Jump to note"
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setActive(0);
          setOpen(!open);
        }}
      >
        <span>Jump to note</span>
        <Search className="map-picker-icon" size={15} />
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="map-picker-popup">
          <label className="map-picker-search">
            <Search size={14} />
            <input
              ref={input}
              role="combobox"
              aria-label="Find a note or hub"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={list}
              aria-activedescendant={
                matches.length ? list + "-" + active : undefined
              }
              placeholder="Find a note or hub"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) =>
                    Math.max(
                      0,
                      Math.min(
                        matches.length - 1,
                        a + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
                  );
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  pick(matches[active]);
                }
              }}
            />
          </label>
          <div
            className="map-options"
            role="listbox"
            id={list}
            aria-label="Matching notes"
          >
            {matches.map((i, j) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                id={list + "-" + j}
                aria-selected={j === active}
                key={data.notes[i].id}
                title={data.notes[i].id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
              >
                <i
                  style={{ background: data.groups[data.subjects[i]].color }}
                />
                <span>
                  {data.notes[i].title}
                  <small>{data.notes[i].id}</small>
                </span>
                <span
                  className="map-degree"
                  aria-label={data.neighbors[i].length + " links"}
                >
                  {data.neighbors[i].length}
                </span>
              </button>
            ))}
          </div>
          {!matches.length && <p role="status">No matching notes</p>}
        </div>
      )}
    </div>
  );
}
