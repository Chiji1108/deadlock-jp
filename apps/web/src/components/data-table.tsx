import {
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { ColumnDef, RowData, SortingState } from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export const features = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
})
export type DataTableFeatures = typeof features
export function DataTable<T extends RowData>({
  columns,
  data,
  caption,
  sorting = [],
  right = [],
  getRowId,
  onRowClick,
}: {
  columns: ColumnDef<DataTableFeatures, T>[]
  data: T[]
  caption: string
  sorting?: SortingState
  right?: string[]
  getRowId: (row: T) => string
  onRowClick?: (row: T, event: React.MouseEvent) => void
}) {
  const table = useTable({
    features,
    data,
    columns,
    getRowId,
    manualSorting: true,
    manualPagination: true,
    state: { sorting },
  })
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                className={cn(right.includes(header.column.id) && 'text-right')}
                aria-sort={
                  header.column.getIsSorted() === 'desc'
                    ? 'descending'
                    : header.column.getIsSorted() === 'asc'
                      ? 'ascending'
                      : undefined
                }
              >
                {!header.isPlaceholder && <table.FlexRender header={header} />}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            className={cn(
              onRowClick && 'cursor-pointer focus-within:bg-muted/50',
            )}
            onClick={
              onRowClick
                ? (event) => onRowClick(row.original, event)
                : undefined
            }
          >
            {row.getAllCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cn(
                  right.includes(cell.column.id) && 'text-right tabular-nums',
                )}
              >
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
