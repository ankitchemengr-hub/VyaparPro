import { useState } from "react";
import {
  useListBrandMaster, useCreateBrand, useUpdateBrand, useDeleteBrand,
  getListBrandMasterQueryKey,
} from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Tags, Plus, Loader2, Pencil, Trash2 } from "lucide-react";

export default function Brands() {
  const { data: brands, isLoading } = useListBrandMaster();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBrand = useCreateBrand();
  const updateBrand = useUpdateBrand();
  const deleteBrand = useDeleteBrand();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: number; name: string } | null>(null);
  const [name, setName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBrandMasterQueryKey() });

  const openAdd = () => { setEditTarget(null); setName(""); setDialogOpen(true); };
  const openEdit = (b: { id: number; name: string }) => { setEditTarget(b); setName(b.name); setDialogOpen(true); };

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const onError = (err: any) =>
      toast({
        title: "Failed",
        description: err?.response?.data?.error ?? err?.message ?? "Please try again",
        variant: "destructive",
      });
    if (editTarget) {
      updateBrand.mutate(
        { id: editTarget.id, data: { name: trimmed } },
        { onSuccess: () => { invalidate(); setDialogOpen(false); }, onError },
      );
    } else {
      createBrand.mutate(
        { data: { name: trimmed } },
        { onSuccess: () => { invalidate(); setDialogOpen(false); }, onError },
      );
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteBrand.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => { invalidate(); setDeleteTarget(null); toast({ title: `Deleted "${deleteTarget.name}"` }); },
        onError: (err: any) =>
          toast({
            title: "Failed to delete",
            description: err?.response?.data?.error ?? err?.message ?? "Please try again",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brand Master</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage the brand list used when adding products — keeps names consistent.
          </p>
        </div>
        <Button onClick={openAdd} data-testid="button-add-brand">
          <Plus className="h-4 w-4 mr-2" />
          Add Brand
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand Name</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : brands?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                    <Tags className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No brands yet. Add one above.
                  </TableCell>
                </TableRow>
              ) : (
                brands?.map((b) => (
                  <TableRow key={b.id} data-testid={`row-brand-${b.id}`}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(b)} data-testid={`button-edit-brand-${b.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(b)} data-testid={`button-delete-brand-${b.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Rename Brand" : "Add Brand"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Vipro"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              data-testid="input-brand-name"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                onClick={handleSubmit}
                disabled={!name.trim() || createBrand.isPending || updateBrand.isPending}
                data-testid="button-submit-brand"
              >
                {(createBrand.isPending || updateBrand.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editTarget ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes it from the brand list — existing products keep their brand name unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
