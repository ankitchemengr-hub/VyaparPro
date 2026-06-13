import React, { useRef, useState } from "react";
import {
  useGetBackupSettings,
  useUpdateBackupSettings,
  useListBackups,
  useRestoreBackup,
  useResetCompanyData,
  getListBackupsQueryKey,
  getGetBackupSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import JSZip from "jszip";
import {
  DatabaseBackup,
  Download,
  FileJson,
  FileArchive,
  CalendarClock,
  HardDriveDownload,
  UploadCloud,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from "lucide-react";

const BACKUP_FORMAT = "shradha-erp-backup";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

async function readBackupFile(file: File): Promise<any> {
  if (file.name.toLowerCase().endsWith(".zip")) {
    const zip = await JSZip.loadAsync(file);
    const entry = Object.values(zip.files).find(
      (f) => !f.dir && f.name.toLowerCase().endsWith(".json"),
    );
    if (!entry) throw new Error("No backup data (.json) was found inside the .zip file.");
    return JSON.parse(await entry.async("string"));
  }
  return JSON.parse(await file.text());
}

export default function BackupRestore() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useGetBackupSettings();
  const historyQuery = useListBackups();
  const updateSettings = useUpdateBackupSettings();
  const restore = useRestoreBackup();
  const resetData = useResetCompanyData();
  const [downloading, setDownloading] = useState<"zip" | "json" | null>(null);

  // Restore state
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [restorePkg, setRestorePkg] = useState<any | null>(null);
  const [restoreFileName, setRestoreFileName] = useState<string>("");
  const [restoreOpen, setRestoreOpen] = useState(false);

  // Reset state
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  const settings = settingsQuery.data;

  const toggle = (key: "dailyEnabled" | "weeklyEnabled" | "monthlyEnabled", value: boolean) => {
    if (!settings) return;
    updateSettings.mutate(
      { data: { [key]: value } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBackupSettingsQueryKey() });
          settingsQuery.refetch();
          toast({ title: "Backup preferences saved" });
        },
        onError: () => {
          toast({ title: "Failed to save preferences", variant: "destructive" });
        },
      },
    );
  };

  const download = async (format: "zip" | "json") => {
    setDownloading(format);
    try {
      const res = await fetch(`/api/system/backup/download?format=${format}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const fileName = match?.[1] ?? `shradha-backup.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded", description: fileName });
      queryClient.invalidateQueries({ queryKey: getListBackupsQueryKey() });
      historyQuery.refetch();
    } catch (err) {
      toast({
        title: "Backup failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setParsing(true);
    try {
      const pkg = await readBackupFile(file);
      if (!pkg || pkg.format !== BACKUP_FORMAT) {
        throw new Error("This is not a valid Shradha ERP backup file.");
      }
      setRestorePkg(pkg);
      setRestoreFileName(file.name);
      setRestoreOpen(true);
    } catch (err) {
      toast({
        title: "Could not read backup",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  };

  const confirmRestore = () => {
    if (!restorePkg) return;
    restore.mutate(
      { data: restorePkg },
      {
        onSuccess: (res: any) => {
          toast({
            title: "Restore complete",
            description: res?.message ?? "Your data has been restored from the backup.",
          });
          setRestoreOpen(false);
          setRestorePkg(null);
          setRestoreFileName("");
          queryClient.invalidateQueries();
          historyQuery.refetch();
          settingsQuery.refetch();
        },
        onError: (err: any) => {
          toast({
            title: "Restore failed",
            description: err?.message ?? "Could not restore the backup. No data was changed.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const confirmReset = () => {
    resetData.mutate(
      { data: { confirm: "RESET" } },
      {
        onSuccess: (res: any) => {
          toast({
            title: "Data reset",
            description: res?.message ?? "Company data has been cleared.",
          });
          setResetOpen(false);
          setResetConfirm("");
          queryClient.invalidateQueries();
          historyQuery.refetch();
        },
        onError: (err: any) => {
          toast({
            title: "Reset failed",
            description: err?.message ?? "Could not reset the data. No data was changed.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const history = historyQuery.data ?? [];
  const restoreTotal = restorePkg?.counts
    ? Object.values(restorePkg.counts as Record<string, number>).reduce(
        (a, b) => a + Number(b || 0),
        0,
      )
    : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <DatabaseBackup className="h-7 w-7 text-primary" /> Backup &amp; Restore
        </h1>
        <p className="text-muted-foreground mt-2">
          Export your data, restore from a backup file, or reset the company to start fresh.
        </p>
      </div>

      <Tabs defaultValue="backup">
        <TabsList>
          <TabsTrigger value="backup" data-testid="tab-backup">
            <HardDriveDownload className="mr-2 h-4 w-4" /> Backup
          </TabsTrigger>
          <TabsTrigger value="restore" data-testid="tab-restore">
            <UploadCloud className="mr-2 h-4 w-4" /> Restore
          </TabsTrigger>
          <TabsTrigger value="reset" data-testid="tab-reset">
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </TabsTrigger>
        </TabsList>

        <TabsContent value="backup" className="space-y-6">
          {/* Manual backup */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                <CardTitle>Manual Backup</CardTitle>
              </div>
              <CardDescription>
                Download a complete backup of all company data — masters, transactions,
                invoices, orders, manufacturing, accounting and settings — to your computer.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                onClick={() => download("zip")}
                disabled={downloading !== null}
                data-testid="button-backup-zip"
              >
                <FileArchive className="mr-2 h-4 w-4" />
                {downloading === "zip" ? "Preparing…" : "Download .zip"}
              </Button>
              <Button
                variant="outline"
                onClick={() => download("json")}
                disabled={downloading !== null}
                data-testid="button-backup-json"
              >
                <FileJson className="mr-2 h-4 w-4" />
                {downloading === "json" ? "Preparing…" : "Download .json"}
              </Button>
            </CardContent>
          </Card>

          {/* Automatic backup preferences */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                <CardTitle>Automatic Backup</CardTitle>
              </div>
              <CardDescription>
                Choose how often the system should automatically back up your data. These
                preferences are saved now; scheduled backups run in a later update.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { key: "dailyEnabled", label: "Daily Backup", desc: "Back up every day" },
                { key: "weeklyEnabled", label: "Weekly Backup", desc: "Back up once a week" },
                { key: "monthlyEnabled", label: "Monthly Backup", desc: "Back up once a month" },
              ].map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="text-sm text-muted-foreground">{row.desc}</div>
                  </div>
                  <Switch
                    checked={Boolean(settings?.[row.key as keyof typeof settings])}
                    disabled={!settings || updateSettings.isPending}
                    onCheckedChange={(v) =>
                      toggle(row.key as "dailyEnabled" | "weeklyEnabled" | "monthlyEnabled", v)
                    }
                    data-testid={`switch-${row.key}`}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Backup history */}
          <Card>
            <CardHeader>
              <CardTitle>Backup History</CardTitle>
              <CardDescription>Recent backups, with date, size and who created them.</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No backups yet. Use Manual Backup above to create one.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Created By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((b) => (
                      <TableRow key={b.id} data-testid={`row-backup-${b.id}`}>
                        <TableCell className="whitespace-nowrap">{formatDate(b.createdAt)}</TableCell>
                        <TableCell className="font-mono text-xs">{b.fileName}</TableCell>
                        <TableCell className="capitalize">{b.type}</TableCell>
                        <TableCell className="text-right">{formatBytes(b.sizeBytes)}</TableCell>
                        <TableCell>{b.createdByName ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* RESTORE */}
        <TabsContent value="restore" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-primary" />
                <CardTitle>Restore from a Backup</CardTitle>
              </div>
              <CardDescription>
                Upload a backup file (.zip or .json) created by this company. Restoring
                <strong> replaces all current data</strong> with the contents of that file.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-muted-foreground">
                  This permanently overwrites every product, party, invoice, payment and
                  ledger entry with the data in the backup. Download a fresh backup first if
                  you are unsure. Only a backup made by this same company can be restored.
                </div>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept=".zip,.json,application/zip,application/json"
                className="hidden"
                onChange={onPickFile}
                data-testid="input-restore-file"
              />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={parsing || restore.isPending}
                data-testid="button-choose-backup"
              >
                {parsing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="mr-2 h-4 w-4" />
                )}
                {parsing ? "Reading file…" : "Choose backup file"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* RESET */}
        <TabsContent value="reset" className="space-y-6">
          <Card className="border-destructive/40">
            <CardHeader>
              <div className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-destructive" />
                <CardTitle>Reset Company Data</CardTitle>
              </div>
              <CardDescription>
                Clear all business data and start fresh. This is useful after testing, before
                going live with real data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4 text-sm">
                  <div className="font-medium text-destructive mb-1">Will be deleted</div>
                  <div className="text-muted-foreground">
                    Products, customers &amp; suppliers, invoices, purchases, orders, payments,
                    stock movements, manufacturing, accounts &amp; cash book, rewards, workers,
                    expenses, number sequences and the audit log.
                  </div>
                </div>
                <div className="rounded-lg border p-4 text-sm">
                  <div className="font-medium mb-1">Will be kept</div>
                  <div className="text-muted-foreground">
                    Your user logins, role permissions and company configuration / print
                    settings — so you can keep signing in and using the system.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-muted-foreground">
                  This cannot be undone. Download a backup first if you might need this data
                  again.
                </div>
              </div>

              <div className="space-y-2 max-w-sm">
                <Label htmlFor="reset-confirm">
                  Type <span className="font-mono font-semibold">RESET</span> to enable the button
                </Label>
                <Input
                  id="reset-confirm"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  placeholder="RESET"
                  autoComplete="off"
                  data-testid="input-reset-confirm"
                />
              </div>

              <Button
                variant="destructive"
                disabled={resetConfirm !== "RESET" || resetData.isPending}
                onClick={() => setResetOpen(true)}
                data-testid="button-reset-data"
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Reset all company data
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Restore confirmation */}
      <AlertDialog open={restoreOpen} onOpenChange={(o) => !restore.isPending && setRestoreOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>
                  All current company data will be permanently replaced with the contents of
                  this backup. This cannot be undone.
                </div>
                <div className="rounded-md border p-3 text-sm text-foreground">
                  <div>
                    <span className="text-muted-foreground">File: </span>
                    <span className="font-mono">{restoreFileName || "—"}</span>
                  </div>
                  {restorePkg?.companyName && (
                    <div>
                      <span className="text-muted-foreground">Company: </span>
                      {restorePkg.companyName}
                    </div>
                  )}
                  {restorePkg?.createdAt && (
                    <div>
                      <span className="text-muted-foreground">Created: </span>
                      {formatDate(restorePkg.createdAt)}
                    </div>
                  )}
                  {restoreTotal != null && (
                    <div>
                      <span className="text-muted-foreground">Rows in backup: </span>
                      {restoreTotal.toLocaleString("en-IN")}
                    </div>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restore.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmRestore();
              }}
              disabled={restore.isPending}
              data-testid="button-confirm-restore"
            >
              {restore.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {restore.isPending ? "Restoring…" : "Restore now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset confirmation */}
      <AlertDialog open={resetOpen} onOpenChange={(o) => !resetData.isPending && setResetOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all company data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes all business data for this company. Your logins and
              settings are kept. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetData.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmReset();
              }}
              disabled={resetData.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-reset"
            >
              {resetData.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {resetData.isPending ? "Resetting…" : "Yes, reset everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
