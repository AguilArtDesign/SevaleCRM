import { useEffect, useRef, useState } from 'react';
import { Label, Modal, ProgressBar, Separator, Spinner } from '@heroui/react';
import { CircleCheck, TriangleExclamation } from '@gravity-ui/icons';
import type { ProductRefreshJob } from './api';
import { isRefreshJobActive, useLatestProductRefreshJob } from './useProductRefreshJob';

const integer = new Intl.NumberFormat('es-CO');

type Tone = 'progress' | 'success' | 'danger';
type ProgressColor = 'accent' | 'success' | 'danger';

function count(value: number): string {
  return integer.format(value);
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function toneOf(job: ProductRefreshJob): Tone {
  if (job.status === 'FAILED') return 'danger';
  if (isRefreshJobActive(job)) return 'progress';
  // Completado se pinta verde aunque haya productos con error: el resumen ya muestra la cifra.
  return 'success';
}

function progressColor(tone: Tone): ProgressColor {
  return tone === 'progress' ? 'accent' : tone;
}

function titleOf(job: ProductRefreshJob): string {
  if (job.status === 'FAILED') return 'Interrumpido';
  if (isRefreshJobActive(job)) return 'Actualizando';
  return 'Completado';
}

function progressPercent(job: ProductRefreshJob): number | null {
  if (job.totalResults === null || job.totalResults <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((job.scanned / job.totalResults) * 100)));
}

/** Tiempo restante aproximado a partir del ritmo real de productos por milisegundo. */
function remainingTime(job: ProductRefreshJob, now: number): string | null {
  if (!isRefreshJobActive(job) || job.totalResults === null || job.scanned <= 0) return null;
  const startedAt = new Date(job.startedAt ?? job.createdAt).getTime();
  const elapsed = now - startedAt;
  if (elapsed <= 0) return null;
  const rate = job.scanned / elapsed;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const remaining = (job.totalResults - job.scanned) / rate;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  return `~${formatDuration(remaining)} restantes`;
}

function jobDuration(job: ProductRefreshJob): string {
  const startedAt = new Date(job.startedAt ?? job.createdAt).getTime();
  const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
  return formatDuration(completedAt - startedAt);
}

function summaryRows(job: ProductRefreshJob): Array<{ label: string; value: number }> {
  return [
    { label: 'Revisados', value: job.scanned },
    { label: 'Actualizados', value: job.updated },
    { label: 'Sincronizados', value: job.synced },
    { label: 'Desactualizados', value: job.outOfSync },
    { label: 'Descartados', value: job.discarded },
    { label: 'Con error', value: job.failed },
  ];
}

function StatusIcon({ tone }: { tone: Tone }) {
  return (
    <span className={`product-refresh-icon product-refresh-icon--${tone}`}>
      {tone === 'progress' ? (
        <Spinner size="sm" aria-label="Actualización en curso" />
      ) : tone === 'success' ? (
        <CircleCheck width={16} height={16} aria-hidden="true" />
      ) : (
        <TriangleExclamation width={16} height={16} aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * Progreso global del barrido de Siigo. Es un modal xs con backdrop transparente —no empuja el
 * contenido— y se puede minimizar a una píldora mientras el job sigue corriendo en el servidor.
 */
export function ProductRefreshBanner() {
  const { data: job } = useLatestProductRefreshJob();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [minimizedId, setMinimizedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seenActive = useRef<string | null>(null);
  const active = isRefreshJobActive(job);

  useEffect(() => {
    // Un job que ya terminó antes de abrir la página no reaparece: solo se muestra el resumen de
    // uno que esta sesión vio correr, o el de una recarga hecha mientras seguía activo.
    if (job && isRefreshJobActive(job)) seenActive.current = job.id;
  }, [job]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!job) return null;
  if (dismissedId === job.id) return null;
  if (!active && seenActive.current !== job.id) return null;

  const tone = toneOf(job);
  const percent = progressPercent(job);
  const minimized = minimizedId === job.id;
  const close = () => {
    // Mientras corre, cerrar minimiza a la píldora; al terminar, cierra el resumen definitivamente.
    if (active) setMinimizedId(job.id);
    else setDismissedId(job.id);
  };

  if (minimized) {
    return (
      <button
        type="button"
        className={`product-refresh-pill product-refresh-pill--${tone}`}
        aria-label={titleOf(job)}
        onClick={() => setMinimizedId(null)}
      >
        <StatusIcon tone={tone} />
        <strong>
          {active ? (percent === null ? 'Actualizando' : `${percent} %`) : 'Actualización lista'}
        </strong>
        {active ? (
          <span>
            Página {job.pagesProcessed}
            {job.totalPages !== null ? `/${job.totalPages}` : ''}
          </span>
        ) : (
          <span>Ver resumen</span>
        )}
      </button>
    );
  }

  return (
    <Modal.Backdrop
      isOpen
      onOpenChange={(open) => {
        if (!open) close();
      }}
      variant="transparent"
    >
      <Modal.Container size="xs" placement="center">
        <Modal.Dialog className="product-refresh-modal">
          <Modal.CloseTrigger
            aria-label={
              active
                ? 'Minimizar el progreso; la actualización sigue en segundo plano'
                : 'Cerrar el resumen de la actualización'
            }
          />

          <ProgressBar
            aria-label="Progreso de la actualización desde Siigo"
            value={percent ?? undefined}
            isIndeterminate={percent === null}
            color={progressColor(tone)}
            size="md"
          >
            <Label className="product-refresh-progress-label">{titleOf(job)}</Label>
            <ProgressBar.Output className="product-refresh-progress-output">
              {percent === null ? '—' : `${percent} %`}
            </ProgressBar.Output>
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>

          <div className="product-refresh-pages">
            <span>
              {job.status === 'PENDING'
                ? 'Preparando…'
                : `Páginas ${job.pagesProcessed}${job.totalPages !== null ? `/${job.totalPages}` : ''}`}
            </span>
            <span>{active ? (remainingTime(job, now) ?? '—') : jobDuration(job)}</span>
          </div>

          <Separator className="product-refresh-separator" />

          <section
            className="product-refresh-summary-section"
            aria-label="Resumen de la actualización"
          >
            <h3 className="product-refresh-summary-title">Resumen</h3>
            <dl className="product-refresh-summary">
              {summaryRows(job).map((row) => (
                <div className="product-refresh-summary-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{count(row.value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
