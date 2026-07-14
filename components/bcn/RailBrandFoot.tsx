type Props = {
  showBcnSolutionLine?: boolean;
  showPoweredBy?: boolean;
};

function FractalsMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 21.5 12 12 21.5 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M12 8 16 12 12 16 8 12Z" fill="currentColor" />
    </svg>
  );
}

function BcnSolutionMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5 20 5.2v6.2c0 5-3.4 8.5-8 10.1-4.6-1.6-8-5.1-8-10.1V5.2L12 2.5Z" />
    </svg>
  );
}

export function RailBrandFoot({
  showBcnSolutionLine = false,
  showPoweredBy = true,
}: Props) {
  if (!showBcnSolutionLine && !showPoweredBy) return null;

  return (
    <div className="railbrand">
      {showBcnSolutionLine ? (
        <div className="rb-line rb-ff" title="an FF solution">
          <span className="rb-mark">
            <BcnSolutionMark />
          </span>
          <span className="ri-t rb-t">an FF solution</span>
        </div>
      ) : null}
      {showPoweredBy ? (
        <div className="rb-line rb-fr" title="powered by Fractals">
          <span className="rb-mark">
            <FractalsMark />
          </span>
          <span className="ri-t rb-t">
            powered by <b>Fractals</b>
          </span>
        </div>
      ) : null}
    </div>
  );
}
