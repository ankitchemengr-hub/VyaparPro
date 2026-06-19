import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { MessageCircle, Loader2, X, Eye } from "lucide-react";

interface WaLog {
  id: number;
  customerId: number | null;
  customerName: string | null;
  mobileNumber: string;
  messageType: string;
  messageBody: string;
  referenceId: number | null;
  referenceType: string | null;
  deliveryStatus: string;
  waMessageId: string | null;
  errorText: string | null;
  sentAt: string;
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  invoice_pdf:          "Invoice PDF",
  order_confirmation:   "Order Confirmation",
  payment_reminder:     "Payment Reminder",
  outstanding_reminder: "Outstanding Reminder",
  dispatch_status:      "Dispatch Status",
  vehicle_details:      "Vehicle Details",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  sent:      "secondary",
  delivered: "default",
  failed:    "destructive",
  pending:   "outline",
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function WhatsAppLogsPage() {
  const [from, setFrom]               = useState(firstOfMonth());
  const [to, setTo]                   = useState(todayISO());
  const [messageType, setMessageType] = useState("__all__");
  const [previewLog, setPreviewLog]   = useState<WaLog | null>(null);

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to)   params.set("to", to);
  if (messageType !== "__all__") params.set("messageType", messageType);

  const { data, isLoading, refetch } = useQuery<WaLog[]>({
    queryKey: ["whatsapp-logs", from, to, messageType],
    queryFn: async () => {
      const res = await fetch(`/api/whatsapp/logs?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const logs = data ?? [];
  const sentCount      = logs.filter((l) => l.deliveryStatus === "sent" || l.deliveryStatus === "delivered").length;
  const failedCount    = logs.filter((l) => l.deliveryStatus === "failed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <MessageCircle className="w-7 h-7 text-green-500" /> WhatsApp Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Complete history of all WhatsApp messages sent from this ERP.
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold">{logs.length}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Total Messages</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{sentCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Sent / Delivered</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{failedCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Failed</div>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message Type</Label>
              <Select value={messageType} onValueChange={setMessageType}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Types</SelectItem>
                  {Object.entries(MESSAGE_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(from || to || messageType !== "__all__") && (
              <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setMessageType("__all__"); }}>
                <X className="w-4 h-4 mr-1" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Log table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No messages found for the selected filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Message Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-14"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmt(log.sentAt)}</TableCell>
                    <TableCell className="font-medium">{log.customerName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{log.mobileNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {MESSAGE_TYPE_LABELS[log.messageType] ?? log.messageType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.referenceType && log.referenceId
                        ? `${log.referenceType} #${log.referenceId}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[log.deliveryStatus] ?? "outline"} className="text-xs capitalize">
                        {log.deliveryStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setPreviewLog(log)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Message preview dialog */}
      <Dialog open={!!previewLog} onOpenChange={(v) => { if (!v) setPreviewLog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Message Preview</DialogTitle>
            <DialogDescription>
              {previewLog && `Sent to ${previewLog.mobileNumber} · ${fmt(previewLog.sentAt)}`}
            </DialogDescription>
          </DialogHeader>
          {previewLog && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <Badge variant="outline">{MESSAGE_TYPE_LABELS[previewLog.messageType] ?? previewLog.messageType}</Badge>
                <Badge variant={STATUS_VARIANT[previewLog.deliveryStatus] ?? "outline"} className="capitalize">
                  {previewLog.deliveryStatus}
                </Badge>
              </div>
              {previewLog.errorText && (
                <div className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
                  ⚠️ {previewLog.errorText}
                </div>
              )}
              <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-4 border border-green-200 dark:border-green-800">
                <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{previewLog.messageBody}</pre>
              </div>
              {previewLog.waMessageId && (
                <p className="text-xs text-muted-foreground font-mono">WA ID: {previewLog.waMessageId}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
