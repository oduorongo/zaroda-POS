/** Shown on a sales team training shop: everything works, but nothing is real. */
export default function PracticeBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" className="rounded-md border-2 border-dashed border-warning-600 bg-warning-50 p-3 text-sm text-warning-900">
      <strong>Practice shop, for training.</strong> {children ?? "Orders here are pretend: no M-Pesa prompt is sent, no money is taken and no rider comes."}
    </div>
  );
}
