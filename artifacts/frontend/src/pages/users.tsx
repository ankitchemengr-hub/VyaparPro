import React, { useState } from "react";
import { useForm } from "react-hook-form";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useListEntities,
  getListUsersQueryKey,
  getListEntitiesQueryKey,
  UserAccount,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { UserPlus, KeyRound, Loader2, ShieldAlert, Pencil, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";

const ROLES = ["admin", "salesman", "store", "manufacturing", "accountant", "customer"] as const;
type Role = typeof ROLES[number];

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  salesman: "Salesman",
  store: "Store",
  manufacturing: "Manufacturing",
  accountant: "Accountant",
  customer: "Customer (B2B portal)",
};

const ROLE_TO_ENTITY_TYPE: Partial<Record<Role, "customer" | "vendor" | "worker" | "salesman">> = {
  salesman: "salesman",
  manufacturing: "worker",
  store: "worker",
  customer: "customer",
};

export default function Users() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null);
  const [editTarget, setEditTarget] = useState<UserAccount | null>(null);
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useListUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  // Block non-admins from even rendering — defence in depth (server also enforces)
  if (me && me.role !== "admin") {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Admin access required</h2>
            <p className="text-sm text-muted-foreground">Only administrators can manage user accounts.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Accounts</h1>
          <p className="text-muted-foreground mt-2">
            Create login credentials for staff — salesmen, store, manufacturing, accountants — and
            customer B2B portal accounts. Each account can be linked to an existing entity for
            ledger and invoice attribution.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} data-testid="button-add-user">
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by username, name or role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading users...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Linked Entity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).filter(u => {
                  const q = search.toLowerCase().trim();
                  if (!q) return true;
                  return (
                    u.username?.toLowerCase().includes(q) ||
                    u.name?.toLowerCase().includes(q) ||
                    u.role?.toLowerCase().includes(q)
                  );
                }).map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isSelf={me?.id === u.id}
                    onEdit={() => setEditTarget(u)}
                    onResetPassword={() => setResetTarget(u)}
                    onToggleActive={(next) =>
                      updateUser.mutate(
                        { id: u.id, data: { isActive: next } },
                        {
                          onSuccess: () => {
                            queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
                            toast({ title: next ? "Account activated" : "Account deactivated" });
                          },
                          onError: (e: any) =>
                            toast({
                              title: "Update failed",
                              description: e?.response?.data?.error ?? String(e),
                              variant: "destructive",
                            }),
                        }
                      )
                    }
                  />
                ))}
                {users !== undefined && (users ?? []).filter(u => {
                  const q = search.toLowerCase().trim();
                  if (!q) return true;
                  return u.username?.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q);
                }).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {search.trim() ? `No users match "${search}"` : "No users yet."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddUserDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setShowAdd(false);
          toast({ title: "User created", description: "They can now log in with their credentials." });
        }}
        createUser={createUser}
      />

      <EditUserDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setEditTarget(null);
          toast({ title: "User updated" });
        }}
      />

      <ResetPasswordDialog
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onDone={() => {
          setResetTarget(null);
          toast({ title: "Password updated" });
        }}
      />
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  onEdit,
  onResetPassword,
  onToggleActive,
}: {
  user: UserAccount;
  isSelf: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onToggleActive: (next: boolean) => void;
}) {
  return (
    <TableRow data-testid={`row-user-${user.id}`}>
      <TableCell className="font-mono text-sm">{user.username}</TableCell>
      <TableCell>{user.name}{isSelf && <span className="text-xs text-muted-foreground ml-2">(you)</span>}</TableCell>
      <TableCell>
        <Badge variant="outline" className="capitalize">{user.role}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {user.entityId ? `#${user.entityId}` : <span className="italic">—</span>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={user.isActive}
            disabled={isSelf}
            onCheckedChange={onToggleActive}
            data-testid={`switch-active-${user.id}`}
          />
          <span className="text-xs text-muted-foreground">
            {user.isActive ? "Active" : "Disabled"}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onEdit} data-testid={`button-edit-${user.id}`}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={onResetPassword} data-testid={`button-reset-${user.id}`}>
            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
            Reset Password
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function EditUserDialog({
  target,
  onClose,
  onDone,
}: {
  target: UserAccount | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const updateUser = useUpdateUser();
  const [role, setRole] = useState<Role>("salesman");
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState("");

  const linkableType = ROLE_TO_ENTITY_TYPE[role];
  const { data: linkableEntities } = useListEntities(
    linkableType ? { type: linkableType } : undefined,
    {
      query: {
        enabled: Boolean(linkableType),
        queryKey: getListEntitiesQueryKey(linkableType ? { type: linkableType } : undefined),
      },
    },
  );

  // Populate form when target changes
  React.useEffect(() => {
    if (target) {
      setRole(target.role as Role);
      setName(target.name ?? "");
      setEntityId(target.entityId ? String(target.entityId) : "");
    }
  }, [target]);

  const submit = () => {
    if (!target) return;
    updateUser.mutate(
      {
        id: target.id,
        data: {
          role,
          name: name.trim() || undefined,
          entityId: entityId ? Number(entityId) : null,
        },
      },
      {
        onSuccess: onDone,
        onError: (e: any) =>
          toast({
            title: "Update failed",
            description: e?.response?.data?.error ?? String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User — <span className="font-mono">{target?.username}</span></DialogTitle>
          <DialogDescription>
            Update role, display name, or the linked entity record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Role</label>
            <Select value={role} onValueChange={(v) => { setRole(v as Role); setEntityId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map(r => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Falls back to entity name if linked"
            />
          </div>

          {linkableType && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Linked {linkableType} entity
              </label>
              <Select
                value={entityId || "__none__"}
                onValueChange={(v) => setEntityId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Not linked —</SelectItem>
                  {linkableEntities?.map(e => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.name}{e.mobile ? ` (${e.mobile})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {role === "customer" && !entityId && (
                <p className="text-xs text-destructive">
                  Customer users need a linked entity to view their statement and ledger.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateUser.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={updateUser.isPending}>
            {updateUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({
  open, onOpenChange, onCreated, createUser,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  createUser: ReturnType<typeof useCreateUser>;
}) {
  const { toast } = useToast();
  const form = useForm({
    defaultValues: {
      username: "",
      password: "",
      name: "",
      role: "salesman" as Role,
      entityId: "" as string,
    },
  });
  const role = form.watch("role");

  // Suggest entities matching the chosen role (salesman→salesman, mfg/store→worker, customer→customer)
  const linkableType = ROLE_TO_ENTITY_TYPE[role];
  const { data: linkableEntities } = useListEntities(
    linkableType ? { type: linkableType } : undefined,
    {
      query: {
        enabled: Boolean(linkableType),
        queryKey: getListEntitiesQueryKey(linkableType ? { type: linkableType } : undefined),
      },
    },
  );

  const onSubmit = form.handleSubmit((values) => {
    const trimmedUser = values.username.trim();
    if (trimmedUser.length < 3) {
      form.setError("username", { message: "Username must be at least 3 characters" });
      return;
    }
    if (values.password.length < 4) {
      form.setError("password", { message: "Password must be at least 4 characters" });
      return;
    }
    const entityId = values.entityId ? Number(values.entityId) : null;
    if (!values.name.trim() && !entityId) {
      form.setError("name", { message: "Name is required when no entity is linked" });
      return;
    }
    createUser.mutate(
      {
        data: {
          username: trimmedUser,
          password: values.password,
          name: values.name.trim() || undefined,
          role: values.role,
          entityId,
        },
      },
      {
        onSuccess: () => {
          form.reset();
          onCreated();
        },
        onError: (e: any) =>
          toast({
            title: "Failed to create user",
            description: e?.response?.data?.error ?? String(e),
            variant: "destructive",
          }),
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add User Account</DialogTitle>
          <DialogDescription>
            Create login credentials. Link the account to an existing salesman, worker or customer
            entity so invoices and ledgers are correctly attributed.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-role"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ROLES.map(r => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. salesman2" autoComplete="off" {...field} data-testid="input-username" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="text" placeholder="At least 4 characters" autoComplete="new-password" {...field} data-testid="input-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {linkableType && linkableEntities && linkableEntities.length > 0 && (
              <FormField
                control={form.control}
                name="entityId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Link to existing {linkableType} (optional)</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                      <FormControl>
                        <SelectTrigger data-testid="select-entity"><SelectValue placeholder="Not linked" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">— Not linked —</SelectItem>
                        {linkableEntities.map(e => (
                          <SelectItem key={e.id} value={String(e.id)}>
                            {e.name} {e.mobile && <span className="text-muted-foreground">({e.mobile})</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Linking auto-fills the name and attributes invoices/ledger entries to this entity.
                    </p>
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name {form.watch("entityId") && <span className="text-xs text-muted-foreground">(optional — falls back to entity name)</span>}</FormLabel>
                  <FormControl>
                    <Input placeholder="Full name" {...field} data-testid="input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={createUser.isPending} data-testid="button-submit-user">
                {createUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Account
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  target, onClose, onDone,
}: {
  target: UserAccount | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateUser = useUpdateUser();
  const [password, setPassword] = useState("");

  const submit = () => {
    if (!target) return;
    if (password.length < 4) {
      toast({ title: "Password must be at least 4 characters", variant: "destructive" });
      return;
    }
    updateUser.mutate(
      { id: target.id, data: { password } },
      {
        onSuccess: () => {
          setPassword("");
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          onDone();
        },
        onError: (e: any) =>
          toast({
            title: "Reset failed",
            description: e?.response?.data?.error ?? String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(v) => { if (!v) { setPassword(""); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            Set a new password for <span className="font-mono">{target?.username}</span>. They will
            need to use the new password on their next login.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">New password</label>
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 4 characters"
            autoComplete="new-password"
            data-testid="input-new-password"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setPassword(""); onClose(); }}>Cancel</Button>
          <Button onClick={submit} disabled={updateUser.isPending} data-testid="button-confirm-reset">
            {updateUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Update Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
