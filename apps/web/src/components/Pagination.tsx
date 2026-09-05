import {
  Pagination as HeroUIPagination,
  type PaginationProps as HeroUIPaginationProps,
} from '@heroui/react';

export type PaginationProps = Omit<HeroUIPaginationProps, 'size'>;
export type PaginationItem = number | 'ellipsis';

function PaginationRoot(props: PaginationProps) {
  return <HeroUIPagination {...props} size="sm" />;
}

PaginationRoot.displayName = 'SevaleCRM.Pagination';

export const Pagination = Object.assign(PaginationRoot, {
  Content: HeroUIPagination.Content,
  Ellipsis: HeroUIPagination.Ellipsis,
  Item: HeroUIPagination.Item,
  Link: HeroUIPagination.Link,
  Next: HeroUIPagination.Next,
  NextIcon: HeroUIPagination.NextIcon,
  Previous: HeroUIPagination.Previous,
  PreviousIcon: HeroUIPagination.PreviousIcon,
  Root: PaginationRoot,
  Summary: HeroUIPagination.Summary,
});

export function getPaginationItems(current: number, total: number): PaginationItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page > 0 && page <= total).sort((a, b) => a - b);
  const result: PaginationItem[] = [];

  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && page - previous > 1) result.push('ellipsis');
    result.push(page);
  });

  return result;
}
