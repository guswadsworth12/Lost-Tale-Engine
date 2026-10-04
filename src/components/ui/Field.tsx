import { useEffect, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

// `text-base sm:text-sm`: 16px on mobile keeps iOS Safari from auto-zooming the page on focus;
// desktop stays at the denser 14px. `py-2.5 sm:py-2` gives a slightly taller touch target on phones.
const CONTROL_CLASS =
  'w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55 sm:py-2 sm:text-sm'

/** A label + optional hint wrapper shared by every field control here, so spacing/typography stay identical. */
function FieldFrame({
  label,
  hint,
  actions,
  className = '',
  children,
}: {
  label?: string
  hint?: ReactNode
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`mb-3 block ${className}`}>
      {(label || actions) && (
        <span className="mb-1 flex items-center justify-between gap-2">
          {label && <span className="text-xs font-medium text-text-muted">{label}</span>}
          {actions}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  )
}

export function TextField({
  label,
  hint,
  className = '',
  ...props
}: { label: string; hint?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldFrame label={label} hint={hint} className={className}>
      <input {...props} className={CONTROL_CLASS} />
    </FieldFrame>
  )
}

/** A comma-separated list as typed: items trimmed, empty ones dropped. */
export function parseCommaList(text: string): string[] {
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, i) => item === b[i])

/**
 * A list edited as comma-separated text. It keeps the text as typed and reports the parsed list on
 * every change. Rebuilding the text from the list each keystroke would swallow a comma just typed
 * (its empty item is dropped) and a space at the end of an item (it is trimmed), so neither could
 * ever be typed. A list changed from outside (a reset, a loaded card) replaces the text.
 */
export function CommaListField({
  value,
  onChange,
  ...props
}: {
  label: string
  hint?: ReactNode
  className?: string
  value: readonly string[]
  onChange: (list: string[]) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(() => value.join(', '))
  useEffect(() => {
    setText((typed) => (sameList(parseCommaList(typed), value) ? typed : value.join(', ')))
  }, [value])
  return (
    <TextField
      {...props}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseCommaList(e.target.value))
      }}
    />
  )
}

export function NumberField({
  label,
  hint,
  className = '',
  suffix,
  ...props
}: { label: string; hint?: ReactNode; className?: string; suffix?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldFrame label={label} hint={hint} className={className}>
      <span className="relative block">
        <input {...props} type="number" inputMode="numeric" className={CONTROL_CLASS} />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">
            {suffix}
          </span>
        )}
      </span>
    </FieldFrame>
  )
}

export function SelectField({
  label,
  hint,
  className = '',
  children,
  ...props
}: {
  label: string
  hint?: ReactNode
  className?: string
  children: ReactNode
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldFrame label={label} hint={hint} className={className}>
      <select {...props} className={`${CONTROL_CLASS} cursor-pointer`}>
        {children}
      </select>
    </FieldFrame>
  )
}

export function TextAreaField({
  label,
  hint,
  actions,
  className = '',
  ...props
}: {
  label: string
  hint?: ReactNode
  actions?: ReactNode
  className?: string
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldFrame label={label} hint={hint} actions={actions} className={className}>
      <textarea {...props} className={`${CONTROL_CLASS} resize-y leading-relaxed`} />
    </FieldFrame>
  )
}
