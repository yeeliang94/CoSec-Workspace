'use client';
import { useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { formatDate } from './workspace';

type Step = { title: string; content: ReactNode };
type SummaryRow = { label: string; value: string };
type Summary = { title: string; rows: SummaryRow[] }[];
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function readSummary(panel: HTMLElement): SummaryRow[] {
  return Array.from(panel.querySelectorAll('label')).flatMap((label) => {
    const control = label.querySelector<Control>('input, select, textarea');
    if (!control || control.disabled || control.type === 'hidden') return [];
    const caption = label.cloneNode(true) as HTMLElement;
    caption.querySelectorAll('input, select, textarea, datalist').forEach((el) => el.remove());
    const legend = label.closest('fieldset')?.querySelector('legend')?.textContent?.trim();
    const text = [legend, caption.textContent?.trim() || control.getAttribute('aria-label')]
      .filter(Boolean)
      .join(', ');
    let value = control.value;
    if (control instanceof HTMLSelectElement)
      value = control.value
        ? Array.from(control.selectedOptions, (option) => option.text).join(', ')
        : '';
    if (control instanceof HTMLInputElement && control.type === 'checkbox')
      value = control.checked ? 'Selected' : 'Not selected';
    if (control.type === 'date' && value) value = formatDate(value);
    return [{ label: text, value: value || control.dataset.reviewEmpty || 'Not provided' }];
  });
}

/** Keep every step mounted so uncontrolled inputs and FormData survive navigation. */
export function GuidedForm({
  steps,
  submitLabel,
  pending,
  secondaryAction,
  children,
  onSubmit,
  className,
  ...props
}: Omit<ComponentProps<'form'>, 'onSubmit'> & {
  steps: Step[];
  submitLabel: string;
  pending: boolean;
  secondaryAction?: ReactNode;
  onSubmit: NonNullable<ComponentProps<'form'>['onSubmit']>;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [active, setActive] = useState(0);
  const [summary, setSummary] = useState<Summary>([]);
  const review = steps.length;
  const titles = [...steps.map((step) => step.title), 'Review'];
  function move(target: number, validate = true) {
    if (!form.current || pending) return false;
    const panels = Array.from(form.current.querySelectorAll<HTMLElement>('[data-guided-step]'));
    if (validate && target > active) {
      for (let index = 0; index < target; index++) {
        const invalid = Array.from(
          panels[index].querySelectorAll<Control>('input, select, textarea'),
        ).find((control) => !control.disabled && !control.checkValidity());
        if (invalid) {
          flushSync(() => setActive(index));
          invalid.reportValidity();
          return false;
        }
      }
    }
    if (target === review)
      setSummary(
        panels.map((panel, index) => ({ title: steps[index].title, rows: readSummary(panel) })),
      );
    flushSync(() => setActive(target));
    form.current.querySelector<HTMLElement>(`#${CSS.escape(id + '-heading-' + target)}`)?.focus();
    return true;
  }
  return (
    <form
      {...props}
      ref={form}
      className={`guided-form ${className || ''}`}
      noValidate
      inert={pending}
      aria-busy={pending}
      onSubmit={(event) => {
        if (active !== review) {
          event.preventDefault();
          move(active + 1);
          return;
        }
        // Revalidate every step even when already on Review.
        const invalid = Array.from(
          event.currentTarget.querySelectorAll<Control>('input, select, textarea'),
        ).find((control) => !control.disabled && !control.checkValidity());
        if (invalid) {
          event.preventDefault();
          const panel = invalid.closest<HTMLElement>('[data-guided-step]');
          move(Number(panel?.dataset.guidedStep || 0), false);
          invalid.reportValidity();
          return;
        }
        onSubmit(event);
      }}
    >
      <nav className="guided-steps" aria-label="Form steps">
        <ol>
          {titles.map((title, index) => (
            <li key={title}>
              <button
                type="button"
                aria-current={active === index ? 'step' : undefined}
                onClick={() => move(index)}
              >
                <span aria-hidden="true">{index + 1}.</span> {title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="guided-content">
        {steps.map((step, index) => (
          <section
            key={step.title}
            data-guided-step={index}
            hidden={active !== index}
            aria-labelledby={`${id}-heading-${index}`}
          >
            <h2 id={`${id}-heading-${index}`} tabIndex={-1}>
              {step.title}
            </h2>
            <div className="form-stack">{step.content}</div>
          </section>
        ))}
        <section hidden={active !== review} aria-labelledby={`${id}-heading-${review}`}>
          <h2 id={`${id}-heading-${review}`} tabIndex={-1}>
            Review
          </h2>
          <div className="guided-review">
            {summary.map(({ title, rows }, index) => (
              <section key={title}>
                <div className="section-header">
                  <h3>{title}</h3>
                  <button
                    type="button"
                    className="section-link"
                    onClick={() => move(index)}
                    aria-label={`Change ${title.toLowerCase()}`}
                  >
                    Change
                  </button>
                </div>
                {rows.length ? (
                  <dl>
                    {rows.map((row, rowIndex) => (
                      <div key={rowIndex}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted">None selected</p>
                )}
              </section>
            ))}
          </div>
        </section>
        {children}
        <div className="actions">
          {active > 0 ? (
            <button type="button" onClick={() => move(active - 1)}>
              Back
            </button>
          ) : null}
          <button type="submit" className="primary" disabled={pending}>
            {pending
              ? 'Saving…'
              : active === review
                ? submitLabel
                : active === review - 1
                  ? 'Review details'
                  : 'Continue'}
          </button>
          {secondaryAction}
        </div>
      </div>
    </form>
  );
}
