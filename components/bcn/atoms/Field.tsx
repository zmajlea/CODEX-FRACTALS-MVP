import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  wide?: boolean;
};

export function Field({ label, id, wide, className = "", ...rest }: InputProps) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className={`field${wide ? " wide" : ""}${className ? ` ${className}` : ""}`}>
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} {...rest} />
    </div>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  wide?: boolean;
};

export function TextAreaField({ label, id, wide, className = "", ...rest }: TextareaProps) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className={`field wide${className ? ` ${className}` : ""}`}>
      <label htmlFor={fieldId}>{label}</label>
      <textarea id={fieldId} {...rest} />
    </div>
  );
}
