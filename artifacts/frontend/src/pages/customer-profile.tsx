import React, { useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEntityLedger,
  useGetEntity,
  useListRewardProgress,
  useCreateLedgerAdjustment,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  FileText,
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  Paperclip,
  X,
  Loader2,
  ImageIcon,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/use-auth";

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3MB raw — keeps base64 payload within the 10mb API limit

export default function CustomerProfile() {
  const { id } = useParams();
  const entityId = parseInt(id || "0", 10);
  const { toast } = useToast();
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAdjust = hasRole(["admin", "accountant"]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: entityData, isLoading: entityLoading } = useGetEntity(entityId, {
    query: { enabled: !!entityId, queryKey: ['entity', entityId] }
  });

  const { data: ledger, isLoading: ledgerLoading } = useGetEntityLedger(entityId, {
    query: { enabled: !!entityId, queryKey: ['ledger', entityId] }
  });

  const { data: rewards } = useListRewardProgress({ customerId: entityId }, {
    query: { enabled: !!entityId, queryKey: ['rewards', entityId] }
  });

  const createAdjustment = useCreateLedgerAdjustment();

  const outstanding = ledger?.outstandingBalance ?? entityData?.outstandingBalance ?? 0;

  function openDialog(dir: "debit" | "credit") {
    setDirection(dir);
    setAmount("");
    setNotes("");
    setAttachment(null);
    setAttachmentName(null);
    setDialogOpen(true);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please choose an image file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({ title: "Image too large", description: "Please choose an image under 3MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment(reader.result as string);
      setAttachmentName(file.name);
    };
    reader.readAsDataURL(file);
  }

  function clearAttachment() {
    setAttachment(null);
    setAttachmentName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter an amount", description: "Amount must be greater than zero.", variant: "destructive" });
      return;
    }
    try {
      await createAdjustment.mutateAsync({
        id: entityId,
        data: {
          direction,
          amount: amt,
          notes: notes.trim() || null,
          attachmentUrl: attachment,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['ledger', entityId] });
      await queryClient.invalidateQueries({ queryKey: ['entity', entityId] });
      toast({
        title: direction === "debit" ? "Recorded what you gave" : "Recorded what you got",
        description: `₹${amt.toLocaleString()} ${direction === "debit" ? "added to" : "cleared from"} ${entityData?.name}'s khata.`,
      });
      setDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not post the entry.";
      toast({ title: "Failed", description: msg, variant: "destructive" });
    }
  }

  if (entityLoading || ledgerLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading profile...</div>;
  }

  if (!entityData) {
    return <div className="p-8 text-center text-destructive">Entity not found.</div>;
  }

  const isDr = outstanding > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/customers">
          <Button variant="outline" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{entityData.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge className="capitalize">{entityData.type}</Badge>
            <span className="text-muted-foreground text-sm">{entityData.mobile}</span>
            {entityData.gstin && <Badge variant="outline">GST: {entityData.gstin}</Badge>}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className={`rounded-lg border px-5 py-2 ${isDr ? "border-destructive/30 bg-destructive/5" : "border-green-600/30 bg-green-600/5"}`}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Outstanding</div>
            <div className={`text-2xl font-bold leading-tight ${isDr ? "text-destructive" : "text-green-600"}`}>
              ₹{Math.abs(outstanding).toLocaleString()}
              <span className="text-base font-semibold ml-1">{isDr ? "Dr" : "Cr"}</span>
            </div>
          </div>

          {canAdjust && (
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => openDialog("debit")}>
                <ArrowUpRight className="h-4 w-4 mr-1" /> You Gave
              </Button>
              <Button size="sm" variant="outline" className="border-green-600/40 text-green-600 hover:bg-green-600/10" onClick={() => openDialog("credit")}>
                <ArrowDownLeft className="h-4 w-4 mr-1" /> You Got
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Khata Ledger</CardTitle>
            <CardDescription>Transaction history and running balance</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Ref No</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger?.entries?.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{format(new Date(entry.date), "MMM dd, yyyy")}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {entry.type === 'invoice' ? <FileText className="h-3 w-3 text-muted-foreground" /> :
                         entry.type === 'payment' ? <CreditCard className="h-3 w-3 text-muted-foreground" /> : null}
                        <span>{entry.description}</span>
                        {entry.attachmentUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewUrl(entry.attachmentUrl!)}
                            className="inline-flex items-center text-primary hover:underline"
                            title="View attachment"
                          >
                            <Paperclip className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {entry.createdByName && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">by {entry.createdByName}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{entry.referenceNo || '-'}</TableCell>
                    <TableCell className="text-right text-destructive">
                      {entry.debit > 0 ? `₹${entry.debit.toLocaleString()}` : '-'}
                    </TableCell>
                    <TableCell className="text-right text-green-600">
                      {entry.credit > 0 ? `₹${entry.credit.toLocaleString()}` : '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ₹{Math.abs(entry.balance).toLocaleString()} {entry.balance > 0 ? 'Dr' : 'Cr'}
                    </TableCell>
                  </TableRow>
                ))}
                {(!ledger?.entries || ledger.entries.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No transactions found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-y-2">
                <div className="text-muted-foreground">Address</div>
                <div className="text-right">{entityData.address || '-'}</div>

                <div className="text-muted-foreground">City/State</div>
                <div className="text-right">{(entityData.city || entityData.state) ? `${entityData.city}, ${entityData.state}` : '-'}</div>

                <div className="text-muted-foreground">Pricing Tier</div>
                <div className="text-right capitalize">{entityData.pricingTier || '-'}</div>

                <div className="text-muted-foreground">Credit Limit</div>
                <div className="text-right">₹{entityData.creditLimit?.toLocaleString() || 'N/A'}</div>
              </div>
            </CardContent>
          </Card>

          {entityData.type === 'customer' && (
            <Card>
              <CardHeader>
                <CardTitle>Reward Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {rewards?.length ? rewards.map(reward => (
                  <div key={reward.id} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium line-clamp-1">{reward.productName}</span>
                      <span className="text-muted-foreground">{reward.litersAchieved} / {reward.targetLiters}L</span>
                    </div>
                    <Progress value={reward.progressPct || 0} className={reward.isRewardAchieved ? "[&>div]:bg-green-500" : "[&>div]:bg-primary"} />
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Reward: {reward.rewardValue}</span>
                      {reward.isRewardAchieved && !reward.isDisbursed && (
                        <Badge className="bg-green-500 hover:bg-green-600 text-[10px] py-0 px-1 border-transparent text-white">Achieved!</Badge>
                      )}
                      {reward.isDisbursed && (
                        <Badge variant="secondary" className="text-[10px] py-0 px-1 border-transparent">Disbursed</Badge>
                      )}
                    </div>
                  </div>
                )) : (
                  <div className="text-center text-muted-foreground text-sm">No active reward schemes.</div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {direction === "debit" ? "You Gave" : "You Got"}
            </DialogTitle>
            <DialogDescription>
              {direction === "debit"
                ? "Money or goods you gave them — increases what they owe."
                : "Money you received from them — reduces what they owe."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="adj-amount">Amount (₹)</Label>
              <Input
                id="adj-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="adj-notes">Notes</Label>
              <Textarea
                id="adj-notes"
                placeholder="Reason for this adjustment..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Attachment (optional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              {attachment ? (
                <div className="flex items-center gap-3 rounded-md border p-2">
                  <img src={attachment} alt="attachment preview" className="h-12 w-12 rounded object-cover" />
                  <span className="text-sm truncate flex-1">{attachmentName}</span>
                  <Button type="button" variant="ghost" size="icon" onClick={clearAttachment}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()}>
                  <ImageIcon className="h-4 w-4 mr-2" /> Choose image
                </Button>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={createAdjustment.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createAdjustment.isPending}
              className={direction === "credit" ? "bg-green-600 hover:bg-green-700" : ""}
            >
              {createAdjustment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && setPreviewUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attachment</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img src={previewUrl} alt="ledger attachment" className="max-h-[70vh] w-full rounded object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
