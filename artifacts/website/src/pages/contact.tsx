import { useState } from "react";
import { useCreateDemoRequest } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Phone, Mail, MessageCircle, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

export default function SiteContact() {
  const { toast } = useToast();
  const createDemo = useCreateDemoRequest();
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "", businessName: "", mobile: "", email: "", businessType: "", numUsers: "", message: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.mobile.trim()) {
      toast({ title: "Name and mobile number are required", variant: "destructive" });
      return;
    }
    createDemo.mutate(
      {
        data: {
          name: form.name.trim(),
          businessName: form.businessName.trim() || undefined,
          mobile: form.mobile.trim(),
          email: form.email.trim() || undefined,
          businessType: form.businessType.trim() || undefined,
          numUsers: form.numUsers ? Number(form.numUsers) : undefined,
          message: form.message.trim() || undefined,
        },
      },
      {
        onSuccess: () => setSubmitted(true),
        onError: () => toast({ title: "Could not submit", description: "Please try again.", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <section className="max-w-5xl mx-auto px-4 py-16 grid gap-10 lg:grid-cols-2">
        <div>
          <h1 className="text-3xl font-bold">Book a Demo</h1>
          <p className="mt-2 text-slate-500">See SHRADHA ERP in action — tell us a bit about your business and we'll reach out.</p>

          <div className="mt-8 space-y-4 text-sm">
            <div className="flex items-center gap-3"><Phone className="w-5 h-5 text-blue-600" /> +91 99999 00000</div>
            <div className="flex items-center gap-3"><Mail className="w-5 h-5 text-blue-600" /> support@shradhaerp.com</div>
            <div className="flex items-center gap-3"><MessageCircle className="w-5 h-5 text-teal-600" /> WhatsApp us for a quick response</div>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            {submitted ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 text-teal-600 mx-auto mb-3" />
                <p className="font-semibold text-lg">Thanks — we'll be in touch soon!</p>
                <p className="text-sm text-slate-500 mt-1">Our team usually responds within a few hours.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>Name *</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>Business Name</Label>
                    <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>Mobile *</Label>
                    <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} required />
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>Business Type</Label>
                    <Input value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })} placeholder="e.g. Retail, Manufacturing" />
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>Number of Users</Label>
                    <Input type="number" min="1" value={form.numUsers} onChange={(e) => setForm({ ...form, numUsers: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Message</Label>
                  <Textarea rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={createDemo.isPending}>
                  {createDemo.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Request Demo
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </section>
      <SiteFooter />
    </div>
  );
}
