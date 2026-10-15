import { useCallback, useEffect, useId, useState } from 'react';
import {
  PRODUCT_TOUR_LABEL,
  TOUR_FINISH_LABEL,
  TOUR_NEXT_LABEL,
  TOUR_PREV_LABEL,
  TOUR_SKIP_LABEL,
  tourStepAnnouncement,
  tourStepCount,
} from './copy';
import { type CardCoords, computePlacement, TOUR_STEPS } from './tourSteps';

export type ProductTourProps = {
  isOpen: boolean;
  onClose: () => void;
  initialStep?: number;
  onStepChange?: (step: number) => void;
};

export function ProductTour({ isOpen, onClose, initialStep = 0, onStepChange }: ProductTourProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(initialStep);
  const totalSteps = TOUR_STEPS.length;
  const currentStep = TOUR_STEPS[currentStepIndex] ?? TOUR_STEPS[0];
  const isLastStep = currentStepIndex === totalSteps - 1;

  const [coords, setCoords] = useState<CardCoords>(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    return computePlacement(currentStep, vw, vh);
  });
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handleReposition = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nextCoords = computePlacement(currentStep, vw, vh);
      setCoords((prev) => {
        if (
          prev.top === nextCoords.top &&
          prev.left === nextCoords.left &&
          prev.targetRect?.top === nextCoords.targetRect?.top &&
          prev.targetRect?.left === nextCoords.targetRect?.left &&
          prev.targetRect?.width === nextCoords.targetRect?.width &&
          prev.targetRect?.height === nextCoords.targetRect?.height
        ) {
          return prev;
        }
        return nextCoords;
      });
    };

    const rafId = requestAnimationFrame(handleReposition);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, currentStep]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onClose();
    } else {
      const nextIndex = currentStepIndex + 1;
      setCurrentStepIndex(nextIndex);
      onStepChange?.(nextIndex);
      if (typeof window !== 'undefined') {
        const nextStep = TOUR_STEPS[nextIndex] ?? currentStep;
        setCoords(computePlacement(nextStep, window.innerWidth, window.innerHeight));
      }
    }
  }, [currentStep, currentStepIndex, isLastStep, onClose, onStepChange]);

  const handlePrev = useCallback(() => {
    if (currentStepIndex > 0) {
      const prevIndex = currentStepIndex - 1;
      setCurrentStepIndex(prevIndex);
      onStepChange?.(prevIndex);
      if (typeof window !== 'undefined') {
        const prevStep = TOUR_STEPS[prevIndex] ?? currentStep;
        setCoords(computePlacement(prevStep, window.innerWidth, window.innerHeight));
      }
    }
  }, [currentStep, currentStepIndex, onStepChange]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Enter') {
        const target = event.target as HTMLElement;
        // If Enter is pressed on a button, the button's onClick will handle it natively.
        // If pressed on the tour container itself, advance step.
        if (target.tagName !== 'BUTTON') {
          event.preventDefault();
          handleNext();
        }
      }
    },
    [handleNext, onClose],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="product-tour-container" data-testid="product-tour-container">
      {coords.targetRect ? (
        <div
          aria-hidden="true"
          className="product-tour__spotlight"
          style={{
            top: coords.targetRect.top - 4,
            left: coords.targetRect.left - 4,
            width: coords.targetRect.width + 8,
            height: coords.targetRect.height + 8,
          }}
        />
      ) : null}

      <section
        aria-label={PRODUCT_TOUR_LABEL}
        aria-labelledby={titleId}
        className="product-tour"
        data-step={currentStepIndex}
        onKeyDown={handleKeyDown}
        role="region"
        style={{
          top: `${coords.top}px`,
          left: `${coords.left}px`,
        }}
        tabIndex={0}
      >
        <div aria-live="polite" className="sr-only" role="status">
          {tourStepAnnouncement(currentStepIndex + 1, totalSteps, currentStep.title)}
        </div>

        <div className="product-tour__header">
          <span className="product-tour__badge">{tourStepCount(currentStepIndex + 1, totalSteps)}</span>
          <button
            aria-label={TOUR_SKIP_LABEL}
            className="btn btn--sm product-tour__skip-btn"
            onClick={onClose}
            type="button"
          >
            {TOUR_SKIP_LABEL}
          </button>
        </div>

        <h2 className="product-tour__title" id={titleId}>
          {currentStep.title}
        </h2>

        <p className="product-tour__body">{currentStep.body}</p>

        <div className="product-tour__actions">
          {currentStepIndex > 0 ? (
            <button aria-label={TOUR_PREV_LABEL} className="btn btn--sm" onClick={handlePrev} type="button">
              {TOUR_PREV_LABEL}
            </button>
          ) : null}

          <button
            aria-label={isLastStep ? TOUR_FINISH_LABEL : TOUR_NEXT_LABEL}
            className="btn btn--sm btn--primary"
            onClick={handleNext}
            type="button"
          >
            {isLastStep ? TOUR_FINISH_LABEL : TOUR_NEXT_LABEL}
          </button>
        </div>
      </section>
    </div>
  );
}
