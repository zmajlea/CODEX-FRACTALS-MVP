"use client";

import { Field, TextAreaField } from "@/components/bcn/atoms/Field";
import { FGrid, Panel } from "@/components/bcn/forms/Panel";
import type { BcnIconName } from "@/lib/bcn/icons";

export function SegmentChoice({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label?: string;
  options: string[];
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field wide">
      {label ? <label>{label}</label> : null}
      <div className="choices">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`seg${value === opt ? " on" : ""}`}
            disabled={disabled}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CheckToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`check${checked ? " on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="box" aria-hidden />
      <span className="opt-text">
        <span className="opt-label">{label}</span>
        {description ? <span className="opt-desc">{description}</span> : null}
      </span>
    </button>
  );
}

export function NotesPanel({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <Panel title={label} icon="doc">
      <TextAreaField
        label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </Panel>
  );
}

export function RoleBlocksEditor({
  title,
  icon,
  blocks,
  fieldKeys,
  disabled,
  onChange,
  onBlur,
}: {
  title: string;
  icon?: BcnIconName;
  blocks: Array<{ label: string; hint?: string; fields: Record<string, string> }>;
  fieldKeys: string[];
  disabled?: boolean;
  onChange: (blocks: Array<{ label: string; hint?: string; fields: Record<string, string> }>) => void;
  onBlur: () => void;
}) {
  return (
    <Panel title={title} icon={icon ?? "people"}>
      {blocks.map((block, index) => (
        <div className="contact-row" key={block.label}>
          <div className="cr-fields">
            <div className="advlabel">
              {block.label}
              {block.hint ? <span className="advhint">{block.hint}</span> : null}
            </div>
            <FGrid>
              {fieldKeys.map((key) => (
                <Field
                  key={key}
                  label={key}
                  value={block.fields[key] ?? ""}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...blocks];
                    next[index] = {
                      ...block,
                      fields: { ...block.fields, [key]: e.target.value },
                    };
                    onChange(next);
                  }}
                  onBlur={onBlur}
                />
              ))}
            </FGrid>
          </div>
        </div>
      ))}
    </Panel>
  );
}

export function TableEditor({
  title,
  icon,
  columns,
  rows,
  note,
  disabled,
  onChange,
  onBlur,
}: {
  title: string;
  icon?: BcnIconName;
  columns: string[];
  rows: string[][];
  note?: string;
  disabled?: boolean;
  onChange: (rows: string[][]) => void;
  onBlur: () => void;
}) {
  return (
    <Panel title={title} icon={icon ?? "people"}>
      <table className="dtable">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {columns.map((col, ci) => (
                <td key={col}>
                  <input
                    type="text"
                    aria-label={col}
                    value={row[ci] ?? ""}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = rows.map((r) => [...r]);
                      next[ri]![ci] = e.target.value;
                      onChange(next);
                    }}
                    onBlur={onBlur}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note ? (
        <div className="tbl-extra" style={{ marginTop: 12 }}>
          <TextAreaField
            label={note}
            value=""
            disabled={disabled}
            onChange={() => {}}
            onBlur={onBlur}
          />
        </div>
      ) : null}
    </Panel>
  );
}

export function RatingRows({
  rows,
  disabled,
  onChange,
  onBlur,
}: {
  rows: Array<{ label: string; value: number }>;
  disabled?: boolean;
  onChange: (rows: Array<{ label: string; value: number }>) => void;
  onBlur: () => void;
}) {
  return (
    <div className="ratings">
      {rows.map((row, index) => (
        <div className="rrow" key={row.label}>
          <span className="rlbl">{row.label}</span>
          <div className="rscale">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={`rdot${n <= row.value ? " on" : ""}`}
                disabled={disabled}
                aria-label={String(n)}
                onClick={() => {
                  const next = [...rows];
                  next[index] = { ...row, value: n };
                  onChange(next);
                  onBlur();
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
