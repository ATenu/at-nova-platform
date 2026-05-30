import { Icon } from './Icon';

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return null;
  }
  return (
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
      <span className="text-sm muted">
        Page {page} of {totalPages}
      </span>
      <button
        className="btn btn-sm btn-icon"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <Icon name="arrowLeft" size={15} />
      </button>
      <button
        className="btn btn-sm btn-icon"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <Icon name="chevronRight" size={15} />
      </button>
    </div>
  );
}
