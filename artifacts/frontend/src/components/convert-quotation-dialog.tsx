import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Receipt } from "lucide-react";

// "Convert to Invoice" on a quotation: pick GST or Non-GST, then the billing
// screen opens pre-filled from the quotation. Saving there makes a NEW invoice
// with its own number (stock and ledger move then); the quotation keeps its
// QTN number and stays in Quotations, marked converted.
export function ConvertQuotationDialog({
  quotation,
  onClose,
}: {
  quotation: { id: number; invoiceNo: string } | null;
  onClose: () => void;
}) {
  const [, setLocation] = useLocation();
  const go = (type: "gst" | "non_gst") => {
    if (!quotation) return;
    onClose();
    setLocation(`/billing?fromQuotation=${quotation.id}&invoiceType=${type}`);
  };

  return (
    <Dialog open={!!quotation} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert {quotation?.invoiceNo} to Invoice</DialogTitle>
          <DialogDescription>
            The invoice gets its own invoice number. You can check items and rates before saving — stock and the
            customer's balance change only when you save. The quotation stays in Quotations.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button className="h-auto flex-col gap-1 py-4" onClick={() => go("gst")} data-testid="button-convert-gst">
            <Receipt className="h-5 w-5" />
            <span className="font-semibold">GST Invoice</span>
            <span className="text-xs font-normal opacity-80">GST added on each item</span>
          </Button>
          <Button variant="outline" className="h-auto flex-col gap-1 py-4" onClick={() => go("non_gst")} data-testid="button-convert-non-gst">
            <FileText className="h-5 w-5" />
            <span className="font-semibold">Non-GST Invoice</span>
            <span className="text-xs font-normal opacity-80">No GST</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
